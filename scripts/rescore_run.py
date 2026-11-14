"""Score saved runs again with the current scoring rules. No model is called.

    PYTHONPATH=src python3 scripts/rescore_run.py results/<change>__<reviewer>__<time>.json [...]

Used when a scoring rule is fixed after a run: the reviews themselves are unchanged, only how
they are counted. Each run gets a note saying when and why it was rescored.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from reviewer_controls.card import render_card  # noqa: E402
from reviewer_controls.controls import rescore  # noqa: E402
from reviewer_controls.models import (  # noqa: E402
    Change, Finding, Plant, PointAssessment, RequirementPoint, ReviewResult, RunReport,
)


def review_from(data):
    if not data:
        return None
    return ReviewResult(
        reviewer=data["reviewer"],
        variant_id=data["variant_id"],
        findings=[Finding(**item) for item in data.get("findings", [])],
        meets_requirement=data.get("meets_requirement"),
        refused_to_decide=data.get("refused_to_decide", []),
        points=[PointAssessment(**item) for item in data.get("points", [])],
        prompt_tokens=data.get("prompt_tokens", 0),
        completion_tokens=data.get("completion_tokens", 0),
        seconds=data.get("seconds", 0.0),
        error=data.get("error", ""),
    )


def report_from(data):
    return RunReport(
        change=Change(**data["change"]),
        reviewer=data["reviewer"],
        planter=data.get("planter", ""),
        created_at=data.get("created_at", ""),
        requirement_points=[RequirementPoint(**item) for item in data.get("requirement_points", [])],
        plants=[Plant(**item) for item in data.get("plants", [])],
        original_review=review_from(data.get("original_review")),
        variant_reviews=[review_from(item) for item in data.get("variant_reviews", [])],
        repeat_review=review_from(data.get("repeat_review")),
        unstable_points=data.get("unstable_points", []),
        altered_requirement=data.get("altered_requirement", ""),
        altered_requirement_review=review_from(data.get("altered_requirement_review")),
        requirement_flip_changed_verdict=data.get("requirement_flip_changed_verdict"),
        build_checked=data.get("build_checked", False),
        prompt_tokens=data.get("prompt_tokens", 0),
        completion_tokens=data.get("completion_tokens", 0),
        wall_seconds=data.get("wall_seconds", 0.0),
        notes=[note for note in data.get("notes", []) if "answered differently on two identical reviews" not in note],
    )


def main(paths):
    for name in paths:
        path = Path(name)
        report = rescore(report_from(json.loads(path.read_text())))
        if report.unstable_points:
            report.notes.append(
                "The reviewer answered differently on two identical reviews for {}; those points are not scored.".format(
                    ", ".join(report.unstable_points)
                )
            )
        report.notes.append(
            "Rescored {} from the saved reviews with the current rules: stability compares the reviewer's own answers, "
            "and an alarm on a harmless edit counts against the point it sits in.".format(
                datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            )
        )
        path.write_text(json.dumps(report.to_dict(), indent=2))
        path.with_suffix("").with_suffix(".card.md").write_text(render_card(report))
        print("rescored {} (unstable: {})".format(path.name, ", ".join(report.unstable_points) or "none"))


if __name__ == "__main__":
    main(sys.argv[1:])
