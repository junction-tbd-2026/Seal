"""Calls the AI reviewer under test.

Rules this module keeps, or the test is invalid:
- every variant is reviewed in a fresh session, as a complete change;
- the reviewer is never shown the original next to a variant;
- the prompt is the one used for a normal review, with no hint of a test.
"""

from __future__ import annotations

from typing import Any, List, Optional

from .diffs import line_sets, render_numbered, same_file, split_diff
from .llm import ChatClient, ModelError, as_int, extract_json
from .models import Change, Finding, PointAssessment, RequirementPoint, ReviewResult

MAX_DIFF_CHARS = 120000
# Room for the reply. Models that think before answering spend part of this on the thinking.
MAX_REPLY_TOKENS = 16000

REVIEW_SYSTEM = """You are a senior engineer reviewing a pull request against its requirement.
Report real problems only: defects, behaviour the requirement needs that is missing or wrong, regressions,
and unsafe handling of edge cases. Do not report style, naming or formatting.

The change is shown file by file. The number at the start of each line is its line number in the new
version of the file; use those numbers. Lines marked "+" were added, lines marked "-" were removed.

Decide whether the change meets the requirement. If you cannot decide something from what you are shown,
say so instead of guessing.

When requirement points are listed, judge each one separately: "met", "not_met" or "cannot_tell".
For every point you call met, cite the lines in the change that make it so. A point with no lines to
show for it is "cannot_tell", not "met".

Reply with JSON only, in this shape:
{"meets_requirement": true, "findings": [{"file": "path/to/file", "line_start": 10, "line_end": 12,
"severity": "critical|major|minor", "message": "what is wrong and what it causes"}],
"points": [{"id": "R1", "status": "met", "evidence": [{"file": "path/to/file", "line_start": 10, "line_end": 12}],
"reason": "one sentence"}],
"refused_to_decide": ["a question you could not settle, and why"]}
Use "meets_requirement": null when you cannot tell. Use an empty list when there are no findings."""


class Reviewer:
    """Interface every reviewer implements."""

    name = "reviewer"

    def review(
        self,
        change: Change,
        variant_id: str = "original",
        variant_diff: Optional[str] = None,
        requirement_override: Optional[str] = None,
        points: Optional[List[RequirementPoint]] = None,
    ) -> ReviewResult:
        raise NotImplementedError


def fit_diff(diff: str, limit: int = MAX_DIFF_CHARS) -> str:
    """Numbered view of a diff, dropping whole files from the end when it is too long to send."""
    shown = render_numbered(diff)
    if len(shown) <= limit:
        return shown
    kept: List[str] = []
    dropped: List[str] = []
    size = 0
    for file_diff in split_diff(diff):
        part = render_numbered(file_diff.text)
        if size + len(part) <= limit:
            kept.append(part)
            size += len(part)
        else:
            dropped.append(file_diff.path)
    note = "\n=== Not shown ({} files, too large to include): {}\n".format(len(dropped), ", ".join(dropped[:40]))
    return "\n".join(kept) + note


def parse_findings(raw: Any) -> List[Finding]:
    findings: List[Finding] = []
    if not isinstance(raw, list):
        return findings
    for item in raw:
        if not isinstance(item, dict) or not item.get("file"):
            continue
        start = as_int(item.get("line_start"))
        if start is None:
            continue
        end = as_int(item.get("line_end"), start)
        findings.append(
            Finding(
                file=str(item["file"]),
                line_start=start,
                line_end=max(start, end if end is not None else start),
                message=str(item.get("message") or "").strip(),
                severity=str(item.get("severity") or "unknown"),
            )
        )
    return findings


def parse_points(raw: Any, points: List[RequirementPoint]) -> List[PointAssessment]:
    """One assessment per known point, in order. A point the reviewer skipped is "cannot_tell"."""
    given = {}
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict) and item.get("id"):
                given[str(item["id"]).strip().upper()] = item
    assessments: List[PointAssessment] = []
    for point in points:
        item = given.get(point.id, {})
        status = str(item.get("status") or "cannot_tell").strip().lower().replace(" ", "_")
        evidence = []
        for entry in item.get("evidence") or []:
            if not isinstance(entry, dict) or not entry.get("file"):
                continue
            start = as_int(entry.get("line_start"))
            if start is None:
                continue
            end = as_int(entry.get("line_end"), start) or start
            evidence.append({"file": str(entry["file"]), "line_start": start, "line_end": max(start, end)})
        if status not in ("met", "not_met", "cannot_tell"):
            status = "cannot_tell"
        if status == "met" and not evidence:
            status = "cannot_tell"   # a claim with nothing to show for it is not evidence
        assessments.append(
            PointAssessment(id=point.id, status=status, evidence=evidence, reason=str(item.get("reason") or "").strip())
        )
    return assessments


def check_evidence(points: List[PointAssessment], diff: str) -> List[PointAssessment]:
    """Keep only citations that point at lines this change actually shows.

    A reviewer can cite lines that do not exist or have nothing to do with the change. Such a
    citation is dropped, and a point left with no citation is no longer counted as met.
    """
    files = line_sets(diff)
    for point in points:
        kept = []
        for ref in point.evidence:
            path = next((p for p in files if same_file(p, ref["file"])), None)
            lines = set(range(ref["line_start"], ref["line_end"] + 1))
            if path is None or not (lines & files[path]["shown"]):
                continue
            kept.append(dict(ref, file=path, in_change=bool(lines & files[path]["added"])))
        point.dropped_evidence = len(point.evidence) - len(kept)
        point.evidence = kept
        if point.status == "met" and not kept:
            point.status = "cannot_tell"
            point.reason = (point.reason + " The lines it cited are not part of this change.").strip()
    return points


class ModelReviewer(Reviewer):
    """A reviewer reachable through an OpenAI-compatible chat endpoint."""

    def __init__(
        self,
        client: ChatClient,
        name: Optional[str] = None,
        max_diff_chars: int = MAX_DIFF_CHARS,
        max_tokens: int = MAX_REPLY_TOKENS,
    ) -> None:
        self.client = client
        self.name = name or client.model
        self.max_diff_chars = max_diff_chars
        self.max_tokens = max_tokens

    def review(
        self,
        change: Change,
        variant_id: str = "original",
        variant_diff: Optional[str] = None,
        requirement_override: Optional[str] = None,
        points: Optional[List[RequirementPoint]] = None,
    ) -> ReviewResult:
        requirement = requirement_override if requirement_override is not None else change.requirement_text
        diff = variant_diff if variant_diff is not None else change.diff
        # Points describe the original requirement, so they are left out when the requirement is altered.
        listed = "" if requirement_override is not None else "".join(
            "\n{}: {}".format(point.id, point.text) for point in (points or [])
        )
        user = "Requirement:\n{}\n{}\nChange:\n{}".format(
            requirement.strip(),
            "\nRequirement points:{}\n".format(listed) if listed else "",
            fit_diff(diff, self.max_diff_chars),
        )
        result = ReviewResult(reviewer=self.name, variant_id=variant_id)
        try:
            response = self.client.complete(REVIEW_SYSTEM, user, temperature=0.0, max_tokens=self.max_tokens)
            result.prompt_tokens = response.prompt_tokens
            result.completion_tokens = response.completion_tokens
            result.seconds = response.seconds
            reply = extract_json(
                response.text,
                accept=lambda value: isinstance(value, dict) and ("findings" in value or "meets_requirement" in value),
            )
        except ModelError as error:
            result.error = str(error)
            return result
        if not isinstance(reply, dict):
            result.error = "the reviewer did not reply with a JSON object"
            return result
        verdict = reply.get("meets_requirement")
        result.meets_requirement = verdict if isinstance(verdict, bool) else None
        result.findings = parse_findings(reply.get("findings"))
        result.points = check_evidence(parse_points(reply.get("points"), points or []), diff)
        refused = reply.get("refused_to_decide")
        if isinstance(refused, list):
            result.refused_to_decide = [str(item).strip() for item in refused if str(item).strip()]
        return result
