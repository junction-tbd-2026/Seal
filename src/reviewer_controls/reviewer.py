"""Calls the AI reviewer under test.

Rules this module keeps, or the test is invalid:
- every variant is reviewed in a fresh session, as a complete change;
- the reviewer is never shown the original next to a variant;
- the prompt is the one used for a normal review, with no hint of a test.
"""

from __future__ import annotations

from typing import Any, List, Optional

from .diffs import render_numbered, split_diff
from .llm import ChatClient, ModelError, as_int, extract_json
from .models import Change, Finding, ReviewResult

MAX_DIFF_CHARS = 120000

REVIEW_SYSTEM = """You are a senior engineer reviewing a pull request against its requirement.
Report real problems only: defects, behaviour the requirement needs that is missing or wrong, regressions,
and unsafe handling of edge cases. Do not report style, naming or formatting.

The change is shown file by file. The number at the start of each line is its line number in the new
version of the file; use those numbers. Lines marked "+" were added, lines marked "-" were removed.

Decide whether the change meets the requirement. If you cannot decide something from what you are shown,
say so instead of guessing.

Reply with JSON only, in this shape:
{"meets_requirement": true, "findings": [{"file": "path/to/file", "line_start": 10, "line_end": 12,
"severity": "critical|major|minor", "message": "what is wrong and what it causes"}],
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


class ModelReviewer(Reviewer):
    """A reviewer reachable through an OpenAI-compatible chat endpoint."""

    def __init__(self, client: ChatClient, name: Optional[str] = None) -> None:
        self.client = client
        self.name = name or client.model

    def review(
        self,
        change: Change,
        variant_id: str = "original",
        variant_diff: Optional[str] = None,
        requirement_override: Optional[str] = None,
    ) -> ReviewResult:
        requirement = requirement_override if requirement_override is not None else change.requirement_text
        diff = variant_diff if variant_diff is not None else change.diff
        user = "Requirement:\n{}\n\nChange:\n{}".format(requirement.strip(), fit_diff(diff))
        result = ReviewResult(reviewer=self.name, variant_id=variant_id)
        try:
            response = self.client.complete(REVIEW_SYSTEM, user, temperature=0.0, max_tokens=4000)
            result.prompt_tokens = response.prompt_tokens
            result.completion_tokens = response.completion_tokens
            result.seconds = response.seconds
            reply = extract_json(response.text)
        except ModelError as error:
            result.error = str(error)
            return result
        if not isinstance(reply, dict):
            result.error = "the reviewer did not reply with a JSON object"
            return result
        verdict = reply.get("meets_requirement")
        result.meets_requirement = verdict if isinstance(verdict, bool) else None
        result.findings = parse_findings(reply.get("findings"))
        refused = reply.get("refused_to_decide")
        if isinstance(refused, list):
            result.refused_to_decide = [str(item).strip() for item in refused if str(item).strip()]
        return result
