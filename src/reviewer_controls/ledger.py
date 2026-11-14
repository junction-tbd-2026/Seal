"""The trust ledger: Tieto's measures of trust, counted from what people and reviewers did.

Real numbers come from the saved runs, the sign-offs and the spot-check log. Reverts and
incidents after merge cannot happen in a hackathon, so they come only from an example history
that is labelled as synthetic everywhere it is shown.
"""

from __future__ import annotations

import json
import statistics
from pathlib import Path
from typing import Any, Dict, List, Optional

from .exam import build_exam, list_pulls, objective_ids


def _load_example(path: Optional[Path]) -> Optional[Dict[str, Any]]:
    if path is None or not path.is_file():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def build_ledger(results_dir: Path, pulls_file: Path, example_file: Optional[Path], spot_checks: Dict[str, Any]) -> Dict[str, Any]:
    pulls = list_pulls(pulls_file, results_dir)["pull_requests"]
    changes: List[Dict[str, Any]] = []
    routed = total = 0
    seconds: List[float] = []
    findings_real = findings_judged = 0
    for pull in pulls:
        entry: Dict[str, Any] = {"number": pull["number"], "title": pull["title"], "status": pull["status"], "files": pull.get("files")}
        exam = build_exam(results_dir, pull["change_id"]) if pull["status"] not in ("untested", "full_read_rule") else None
        if exam and exam["reviewers"]:
            primary = exam["reviewers"][0]
            wanted = objective_ids(exam, primary)
            proven = [point["id"] for point in primary["points"] if point["proven"] and point["id"] in wanted]
            entry.update(
                {
                    "objectives": len(wanted),
                    "proven": len(proven),
                    "to_human": len(wanted) - len(proven),
                    "approved_by": (exam["approval"] or {}).get("name"),
                    "changed_lines": exam["changed_lines"],
                    "planted_lines": exam["planted_lines"],
                    "reviewers": [
                        {
                            "name": reviewer["name"],
                            "judgement": reviewer["judgement"],
                            "caught": reviewer["counts"]["defects_caught"],
                            "defects": reviewer["counts"]["defects_total"],
                            "alarms": reviewer["counts"]["false_alarms"],
                            "harmless": reviewer["counts"]["harmless_total"],
                        }
                        for reviewer in exam["reviewers"]
                    ],
                }
            )
            routed += len(wanted) - len(proven)
            total += len(wanted)
            for signoff in exam["signoffs"]:
                if signoff.get("seconds") is not None:
                    seconds.append(float(signoff["seconds"]))
                answers = list((signoff.get("findings") or {}).values())
                findings_judged += len(answers)
                findings_real += sum(1 for answer in answers if answer == "real")
            last = exam["signoffs"][-1] if exam["signoffs"] else None
            entry["signed"] = {"name": last["name"], "decision": last["decision"], "seconds": last.get("seconds")} if last else None
        elif pull["status"] == "full_read_rule":
            entry["rule"] = pull.get("rule")
        changes.append(entry)

    return {
        "measures": {
            "routed_to_human": {"routed": routed, "total": total},
            "time_to_sign": {"median_seconds": statistics.median(seconds) if seconds else None, "signoffs": len(seconds)},
            "findings_real": {"real": findings_real, "judged": findings_judged},
            "signer_drill": {"caught": spot_checks.get("caught", 0), "checked": spot_checks.get("checked", 0)},
        },
        "changes": changes,
        "example": _load_example(example_file),
    }
