"""The objectives a change is reviewed against, and the owner who approved them.

A model writes the first draft of the objectives from the requirement. That draft decides
what every later step measures, so a named owner (for example the product owner) approves it
before anyone signs the code: keeps or strikes each objective, marks the risky ones, and adds
what is missing. Approvals are appended, never edited; the newest one for a change counts.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .models import RequirementPoint

APPROVAL_FILE = "objectives.jsonl"
DECISIONS = ("keep", "strike")
RISKS = ("normal", "high")
MAX_TEXT = 400


def clean_objectives(proposed: Sequence[Dict[str, Any]], given: Any) -> List[Dict[str, Any]]:
    """One entry per proposed objective, in order. Unknown ids are ignored; missing ones are kept as written."""
    by_id = {}
    for item in given or []:
        if isinstance(item, dict) and item.get("id"):
            by_id[str(item["id"])] = item
    cleaned = []
    for point in proposed:
        item = by_id.get(point["id"], {})
        decision = item.get("decision") if item.get("decision") in DECISIONS else "keep"
        risk = item.get("risk") if item.get("risk") in RISKS else "normal"
        note = str(item.get("note") or "").strip()[:MAX_TEXT]
        cleaned.append({"id": point["id"], "text": point["text"], "decision": decision, "risk": risk, "note": note})
    return cleaned


def clean_added(added: Any, first_number: int) -> List[Dict[str, Any]]:
    """Objectives the owner added. They get ids after the proposed ones (R5, R6, ...)."""
    cleaned = []
    for item in added or []:
        text = str(item.get("text") if isinstance(item, dict) else item or "").strip()[:MAX_TEXT]
        if not text:
            continue
        risk = item.get("risk") if isinstance(item, dict) and item.get("risk") in RISKS else "normal"
        cleaned.append({"id": "R{}".format(first_number + len(cleaned)), "text": text, "decision": "keep", "risk": risk, "added": True})
    return cleaned


def record_approval(
    results_dir: Path,
    change_id: str,
    proposed: Sequence[Dict[str, Any]],
    name: str,
    objectives: Any,
    added: Any = None,
) -> Dict[str, Any]:
    """Append an owner's approval of the objectives for a change."""
    name = str(name or "").strip()
    if not name:
        raise ValueError("an approval needs a name")
    if not proposed:
        raise ValueError("there are no objectives to approve for this change")
    kept = clean_objectives(proposed, objectives)
    extra = clean_added(added, first_number=len(proposed) + 1)
    if not any(item["decision"] == "keep" for item in kept) and not extra:
        raise ValueError("at least one objective must be kept")
    entry = {
        "change_id": change_id,
        "name": name[:120],
        "objectives": kept + extra,
        "approved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    results_dir.mkdir(parents=True, exist_ok=True)
    with (results_dir / APPROVAL_FILE).open("a") as handle:
        handle.write(json.dumps(entry) + "\n")
    return entry


def latest_approval(results_dir: Path, change_id: str) -> Optional[Dict[str, Any]]:
    path = results_dir / APPROVAL_FILE
    if not path.is_file():
        return None
    latest = None
    for line in path.read_text().splitlines():
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if isinstance(entry, dict) and entry.get("change_id") == change_id:
            latest = entry
    return latest


def approved_points(approval: Dict[str, Any]) -> Tuple[List[RequirementPoint], List[str]]:
    """The objectives a run should test, and the ids the owner marked risky."""
    kept = [item for item in approval.get("objectives", []) if item.get("decision") == "keep"]
    points = [RequirementPoint(id=item["id"], text=item["text"]) for item in kept]
    risky = [item["id"] for item in kept if item.get("risk") == "high"]
    return points, risky
