"""Shapes saved runs into what the web page shows: one change, its planted variants,
and how each reviewer did on exactly the same variants.

Nothing here depends on the web framework, so it can be tested on its own.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .card import supported_claim
from .diffs import _HUNK_HEADER, same_file, split_diff
from .matcher import finding_hits_plant
from .models import KIND_HARMLESS, Finding, Plant
from .objectives import latest_approval
from .planter import is_test_file

SIGNOFF_FILE = "signoffs.jsonl"
# A change this large goes to a full human read by rule; the AI test is not run on it.
FULL_READ_FILES = 100
# A point counts as proven only after at least this many breaks in its cited lines.
PROVEN_MIN_BREAKS = 2


def structured_diff(diff: str) -> List[Dict[str, Any]]:
    """A diff as rows the page can draw: line number, kind (add, del, ctx, gap) and text."""
    files = []
    for file_diff in split_diff(diff):
        rows: List[Dict[str, Any]] = []
        new_line = 0
        in_hunk = False
        for line in file_diff.text.splitlines():
            header = _HUNK_HEADER.match(line)
            if header:
                if rows:
                    rows.append({"n": None, "kind": "gap", "text": ""})
                new_line = int(header.group(3))
                in_hunk = True
                continue
            if not in_hunk or line.startswith("\\"):
                continue
            if line.startswith("-"):
                rows.append({"n": None, "kind": "del", "text": line[1:]})
            elif line.startswith("+"):
                rows.append({"n": new_line, "kind": "add", "text": line[1:]})
                new_line += 1
            else:
                rows.append({"n": new_line, "kind": "ctx", "text": line[1:]})
                new_line += 1
        files.append(
            {
                "path": file_diff.path,
                "status": "new" if file_diff.is_new else "deleted" if file_diff.is_deleted else "modified",
                "added": file_diff.added_line_count,
                "removed": sum(1 for row in rows if row["kind"] == "del"),
                "rows": rows,
            }
        )
    return files


def requirement_title(text: str, fallback: str) -> str:
    first = text.strip().splitlines()[0] if text.strip() else ""
    match = re.match(r"#\s*Requirement\s*#?\S*:\s*(.+)", first)
    return match.group(1).strip() if match else (first.lstrip("# ").strip() or fallback)


def load_runs(results_dir: Path) -> List[Dict[str, Any]]:
    """Every saved run report, newest first. Plant files and unreadable files are skipped."""
    runs = []
    for path in results_dir.glob("*.json"):
        if "__plants__" in path.name:
            continue
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict) or "change" not in data or "plants" not in data:
            continue
        data["_file"] = path.name
        runs.append(data)
    return sorted(runs, key=lambda run: run.get("created_at", ""), reverse=True)


def _signature(run: Dict[str, Any]) -> Tuple:
    """Two runs sat the same exam when their planted variants are identical."""
    return tuple((p["id"], p["file"], p["line_start"], p["line_end"], p["description"]) for p in run["plants"])


def _result(plant: Dict[str, Any], review: Optional[Dict[str, Any]], outcome: Optional[Dict[str, Any]]) -> str:
    if review is None or review.get("error"):
        return "failed"
    if outcome is None:
        return "failed"
    if outcome.get("inconclusive"):
        return "inconclusive"
    if plant["kind"] == KIND_HARMLESS:
        return "false_alarm" if outcome["flagged"] else "left_alone"
    return "caught" if outcome.get("correct", outcome["flagged"]) else "missed"


def distinct_places(plants: List[dict]) -> List[str]:
    """Ids of these planted edits, keeping one per place: two misses on the same lines are one spot to read."""
    kept: List[dict] = []
    for plant in plants:
        if not any(
            same_file(plant["file"], other["file"])
            and plant["line_start"] <= other["line_end"]
            and plant["line_end"] >= other["line_start"]
            for other in kept
        ):
            kept.append(plant)
    return [plant["id"] for plant in kept]


def judgement(caught: int, defects: int, alarms: int, harmless: int) -> str:
    """One word for how the reviewer behaved as a detector on this change.

    sharp: notices breaks and stays quiet on harmless edits; jumpy: reacts to everything;
    blind: reacts to almost nothing; mixed: anything else. Too few samples gives "untested".
    """
    if defects < 3 or harmless < 2:
        return "untested"
    catch, alarm = caught / defects, alarms / harmless
    if catch >= 0.7 and alarm <= 0.25:
        return "sharp"
    if catch >= 0.5 and alarm >= 0.5:
        return "jumpy"
    if catch <= 0.25 and alarm <= 0.25:
        return "blind"
    return "mixed"


def _reviewer_view(run: Dict[str, Any]) -> Dict[str, Any]:
    plants = run["plants"]
    reviews = {r["variant_id"]: r for r in run.get("variant_reviews", [])}
    outcomes = {o["plant_id"]: o for o in run.get("outcomes", [])}
    results = {p["id"]: _result(p, reviews.get(p["id"]), outcomes.get(p["id"])) for p in plants}

    defects = [p for p in plants if p["kind"] != KIND_HARMLESS and results[p["id"]] in ("caught", "missed")]
    harmless = [p for p in plants if p["kind"] == KIND_HARMLESS and results[p["id"]] in ("left_alone", "false_alarm")]
    caught = sum(1 for p in defects if results[p["id"]] == "caught")

    # What the reviewer said at the planted spot, so the page can quote it.
    said: Dict[str, str] = {}
    for plant in plants:
        review = reviews.get(plant["id"]) or {}
        located = Plant(id=plant["id"], kind=plant["kind"], description="", file=plant["file"],
                        line_start=plant["line_start"], line_end=plant["line_end"])
        for raw in review.get("findings", []):
            finding = Finding(file=raw["file"], line_start=raw["line_start"], line_end=raw["line_end"],
                              message=raw.get("message", ""), severity=raw.get("severity", "unknown"))
            if finding_hits_plant(finding, located):
                said[plant["id"]] = finding.message
                break

    original = run.get("original_review") or {}

    # The requirement, point by point: what the reviewer claims, the lines it cites,
    # and whether it noticed when we broke that point in a planted copy.
    assessed = {p["id"]: p for p in original.get("points", [])}
    points = []
    for point in run.get("requirement_points", []):
        claim = assessed.get(point["id"], {})
        aimed = [p for p in plants if p.get("breaks") == point["id"] and results[p["id"]] in ("caught", "missed")]
        # Only edits placed inside the lines the reviewer itself cited for this point are counted here:
        # for those there is no arguing about whether the edit really touched the point.
        broken = [p for p in aimed if outcomes.get(p["id"], {}).get("point_link") == "confirmed"]
        noticed = sum(1 for p in broken if results[p["id"]] == "caught")
        # Noticing a break means taking back "met", not only pointing at the line.
        withdrew = sum(1 for p in broken if outcomes.get(p["id"], {}).get("point_noticed") is True)
        near = [
            p for p in plants
            if p["kind"] == KIND_HARMLESS and p.get("near") == point["id"] and results[p["id"]] in ("left_alone", "false_alarm")
        ]
        near_alarms = sum(1 for p in near if outcomes.get(p["id"], {}).get("near_alarm") is True)
        unstable = point["id"] in run.get("unstable_points", [])
        tests_only = bool(claim.get("evidence")) and all(is_test_file(ref["file"]) for ref in claim["evidence"])
        proven = (
            claim.get("status") == "met"
            and not unstable
            and not tests_only
            and len(broken) >= PROVEN_MIN_BREAKS
            and withdrew == len(broken)
            and len(near) >= 1
            and near_alarms == 0
        )
        points.append(
            {
                "id": point["id"],
                "text": point["text"],
                "status": claim.get("status", "cannot_tell"),
                "evidence": claim.get("evidence", []),
                "reason": claim.get("reason", ""),
                "broken_total": len(broken),
                "broken_noticed": noticed,
                "broken_withdrew": withdrew,
                "harmless_near": len(near),
                "harmless_near_alarms": near_alarms,
                "proven": proven,
                "aimed_elsewhere": len(aimed) - len(broken),
                "dropped_evidence": claim.get("dropped_evidence", 0),
                "broad_evidence": claim.get("broad_evidence", 0),
                # Proof that is only a test counts for little here: the tests were not run.
                "tests_only": tests_only,
                "noticed": "unstable" if unstable
                else "untested" if not broken
                else "yes" if noticed == len(broken)
                else "no" if noticed == 0
                else "partly",
                "missed_plants": [p["id"] for p in broken if results[p["id"]] == "missed"],
            }
        )

    false_alarms = sum(1 for p in harmless if results[p["id"]] == "false_alarm")
    return {
        "name": run["reviewer"],
        "judgement": judgement(caught, len(defects), false_alarms, len(harmless)),
        "points": points,
        "run_file": run["_file"],
        "created_at": run.get("created_at", ""),
        "verdict": original.get("meets_requirement"),
        "review_failed": bool(original.get("error")),
        "findings": original.get("findings", []),
        "refused_to_decide": original.get("refused_to_decide", []),
        "results": results,
        "said": said,
        "counts": {
            "defects_total": len(defects),
            "defects_caught": caught,
            "harmless_total": len(harmless),
            "false_alarms": false_alarms,
            "failed": sum(1 for value in results.values() if value == "failed"),
            "inconclusive": sum(1 for value in results.values() if value == "inconclusive"),
        },
        "claim": supported_claim(caught, len(defects)),
        "requirement_flip_changed_verdict": run.get("requirement_flip_changed_verdict"),
        "read_yourself": distinct_places([p for p in defects if results[p["id"]] == "missed"]),
        "tokens_in": run.get("prompt_tokens", 0),
        "tokens_out": run.get("completion_tokens", 0),
        "seconds": run.get("wall_seconds", 0.0),
        "reviews": 1 + len(run.get("variant_reviews", [])) + (1 if run.get("altered_requirement_review") else 0),
        "notes": run.get("notes", []),
    }


def list_changes(results_dir: Path) -> List[Dict[str, Any]]:
    """Changes that have at least one saved run, newest run first."""
    seen: Dict[str, Dict[str, Any]] = {}
    for run in load_runs(results_dir):
        change = run["change"]
        entry = seen.setdefault(
            change["id"],
            {
                "id": change["id"],
                "requirement_id": change["requirement_id"],
                "title": requirement_title(change.get("requirement_text", ""), change["id"]),
                "latest_run": run.get("created_at", ""),
                "reviewers": [],
            },
        )
        if run["reviewer"] not in entry["reviewers"]:
            entry["reviewers"].append(run["reviewer"])
    return list(seen.values())


def build_exam(results_dir: Path, change_id: str, hide_missed: bool = False) -> Optional[Dict[str, Any]]:
    """The newest set of planted variants for a change, with every reviewer that was tested on it.

    With `hide_missed`, the text of every planted edit some reviewer missed is left out. Those are
    the spots the signer is asked to judge, and one of them may be the spot-check copy on screen:
    showing what was planted there would give the test away.
    """
    runs = [run for run in load_runs(results_dir) if run["change"]["id"] == change_id]
    if not runs:
        return None
    newest = runs[0]
    signature = _signature(newest)
    by_reviewer: Dict[str, Dict[str, Any]] = {}
    for run in runs:  # newest first, so the first run seen per reviewer wins
        if _signature(run) == signature and run["reviewer"] not in by_reviewer:
            by_reviewer[run["reviewer"]] = run

    change = newest["change"]
    reviewers = [_reviewer_view(run) for run in sorted(by_reviewer.values(), key=lambda r: r.get("created_at", ""))]
    missed = {plant_id for reviewer in reviewers for plant_id in reviewer["read_yourself"]}
    missed |= {p["id"] for reviewer in reviewers for p in newest["plants"] if reviewer["results"].get(p["id"]) == "missed"}
    hidden = missed if hide_missed else set()
    return {
        "change": {
            "id": change["id"],
            "requirement_id": change["requirement_id"],
            "requirement_title": requirement_title(change.get("requirement_text", ""), change["id"]),
            "requirement_text": change.get("requirement_text", ""),
            "files": structured_diff(change.get("diff", "")),
        },
        "planter": newest.get("planter", ""),
        "requirement_points": newest.get("requirement_points", []),
        "created_at": newest.get("created_at", ""),
        "build_checked": bool(newest.get("build_checked")),
        "altered_requirement": newest.get("altered_requirement", ""),
        "plants": [
            {
                "id": p["id"],
                "kind": p["kind"],
                "difficulty": p.get("difficulty", "medium"),
                "description": "" if p["id"] in hidden else p["description"],
                "file": p["file"],
                "line_start": p["line_start"],
                "line_end": p["line_end"],
                "breaks": p.get("breaks"),
                "near": p.get("near"),
                "hidden": p["id"] in hidden,
                "patch": [] if p["id"] in hidden else structured_diff(p.get("patch", "")),
            }
            for p in newest["plants"]
        ],
        "reviewers": reviewers,
        "approval": latest_approval(results_dir, change_id),
        "changed_lines": sum(f.added_line_count for f in split_diff(change.get("diff", ""))),
        "planted_lines": len({(p["file"], n) for p in newest["plants"] for n in range(p["line_start"], p["line_end"] + 1)}),
        "signoffs": signoffs_for(results_dir, change_id),
    }


def list_pulls(pulls_file: Path, results_dir: Path) -> Dict[str, Any]:
    """The connected repository's pull requests, each with where its sign-off stands."""
    data = json.loads(pulls_file.read_text()) if pulls_file.is_file() else {"pull_requests": []}
    pulls = []
    for pull in data.get("pull_requests", []):
        exam = build_exam(results_dir, pull["change_id"])
        entry = dict(pull)
        entry["url"] = "{}/pull/{}".format(data.get("repository_url", "").rstrip("/"), pull["number"])
        if int(pull.get("files") or 0) > FULL_READ_FILES:
            entry.update(
                {
                    "status": "full_read_rule",
                    "rule": "More than {} files changed: too large for the AI test, a person reads all of it.".format(FULL_READ_FILES),
                    "lines_to_read": 0, "reviewers": [], "signed": None,
                }
            )
        elif exam is None or not exam["reviewers"]:
            entry.update({"status": "untested", "lines_to_read": 0, "reviewers": [], "signed": None})
        else:
            primary = exam["reviewers"][0]
            signed = exam["signoffs"][-1] if exam["signoffs"] else None
            to_read = len(primary["read_yourself"])
            entry.update(
                {
                    "status": "signed" if signed else "needs_you" if to_read else "clear",
                    "lines_to_read": to_read,
                    "reviewers": [r["name"] for r in exam["reviewers"]],
                    "caught": primary["counts"]["defects_caught"],
                    "planted_defects": primary["counts"]["defects_total"],
                    "approved": exam["approval"] is not None,
                    "signed": signed,
                }
            )
        pulls.append(entry)
    return {
        "repository": data.get("repository", ""),
        "repository_url": data.get("repository_url", ""),
        "base_branch": data.get("base_branch", ""),
        "pull_requests": pulls,
    }


def clean_answers(answers: Any, allowed: Tuple[str, ...]) -> Dict[str, str]:
    """The signer's answers by id, keeping only allowed values."""
    if not isinstance(answers, dict):
        return {}
    return {str(key)[:40]: value for key, value in answers.items() if value in allowed}


def clean_spots(spots: Any) -> List[Dict[str, str]]:
    """The signer's verdict on each marked spot: "right" or "wrong". Anything else is dropped."""
    cleaned = []
    for spot in spots or []:
        if isinstance(spot, dict) and spot.get("plant_id") and spot.get("verdict") in ("right", "wrong"):
            cleaned.append({"plant_id": str(spot["plant_id"]), "verdict": spot["verdict"]})
    return cleaned


def record_signoff(
    results_dir: Path,
    change_id: str,
    reviewer: str,
    name: str,
    decision: str,
    spots: Any = None,
    points: Any = None,
    findings: Any = None,
    seconds: Optional[float] = None,
) -> Dict[str, Any]:
    """Append a named human's decision. A sign-off is never edited, only added to.

    It keeps everything the person said on the way: a verdict per marked spot, an answer per
    objective (met, not met, or cannot tell) and per reported finding (real or not), and how
    long the review took. That is what the trust ledger counts.
    """
    name = name.strip()
    if not name:
        raise ValueError("a sign-off needs a name")
    if decision not in ("accept", "reject", "full_read"):
        raise ValueError("decision must be accept, reject or full_read")
    entry = {
        "change_id": change_id,
        "reviewer": reviewer,
        "name": name[:120],
        "decision": decision,
        "spots": clean_spots(spots),
        "points": clean_answers(points, ("met", "not_met", "cannot_tell")),
        "findings": clean_answers(findings, ("real", "not_real")),
        "seconds": round(float(seconds), 1) if seconds is not None else None,
        "signed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    results_dir.mkdir(parents=True, exist_ok=True)
    with (results_dir / SIGNOFF_FILE).open("a") as handle:
        handle.write(json.dumps(entry) + "\n")
    return entry


def objective_ids(exam: Dict[str, Any], reviewer: Dict[str, Any]) -> List[str]:
    """The objectives a sign-off answers: the owner's approved ones, or else the reviewer's points."""
    approval = exam.get("approval")
    if approval:
        return [item["id"] for item in approval.get("objectives", []) if item.get("decision") == "keep"]
    return [point["id"] for point in reviewer["points"]]


def acceptance_problems(exam: Dict[str, Any], reviewer_name: str, spots: Any, points: Any, findings: Any) -> List[str]:
    """Why an accept cannot be recorded yet. Empty when it can.

    The page enforces the same rules; they are checked here too, because an approval that only
    the browser checked is not an approval anyone can rely on.
    """
    reviewer = next((item for item in exam["reviewers"] if item["name"] == reviewer_name), None)
    if reviewer is None:
        return ["unknown reviewer {}".format(reviewer_name)]
    problems = []
    if not exam.get("approval"):
        problems.append("the objectives have not been approved by an owner")
    verdicts = {spot["plant_id"]: spot["verdict"] for spot in clean_spots(spots)}
    open_spots = [plant_id for plant_id in reviewer["read_yourself"] if plant_id not in verdicts]
    if open_spots:
        problems.append("{} marked spot(s) have no verdict".format(len(open_spots)))
    if any(verdict == "wrong" for verdict in verdicts.values()):
        problems.append("a marked spot was judged wrong")
    answers = clean_answers(points, ("met", "not_met", "cannot_tell"))
    wanted = objective_ids(exam, reviewer)
    if any(point_id not in answers for point_id in wanted):
        problems.append("not every objective has an answer")
    if any(answers.get(point_id) == "not_met" for point_id in wanted):
        problems.append("an objective was judged not met")
    judged = clean_answers(findings, ("real", "not_real"))
    if any(str(index) not in judged for index in range(len(reviewer["findings"]))):
        problems.append("not every reported finding has an answer")
    if any(value == "real" for value in judged.values()):
        problems.append("a reported finding was judged real")
    return problems


def signoffs_for(results_dir: Path, change_id: str) -> List[Dict[str, Any]]:
    path = results_dir / SIGNOFF_FILE
    if not path.is_file():
        return []
    entries = []
    for line in path.read_text().splitlines():
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if isinstance(entry, dict) and entry.get("change_id") == change_id:
            entries.append(entry)
    return entries
