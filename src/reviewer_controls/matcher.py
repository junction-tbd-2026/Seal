"""Decides whether the reviewer's findings hit a planted location."""

from __future__ import annotations

from typing import Iterable, List

from .models import ControlOutcome, Finding, Plant

# A finding a few lines off the planted edit still counts: reviewers often
# point at the statement around the bug, not the exact line.
DEFAULT_TOLERANCE_LINES = 3


def _same_file(a: str, b: str) -> bool:
    a, b = a.replace("\\", "/").lstrip("./"), b.replace("\\", "/").lstrip("./")
    return a == b or a.endswith("/" + b) or b.endswith("/" + a)


def finding_hits_plant(finding: Finding, plant: Plant, tolerance: int = DEFAULT_TOLERANCE_LINES) -> bool:
    """True when the finding is in the plant's file and overlaps its lines, within tolerance."""
    if not _same_file(finding.file, plant.file):
        return False
    return finding.line_start <= plant.line_end + tolerance and finding.line_end >= plant.line_start - tolerance


def score_plant(
    plant: Plant,
    findings: Iterable[Finding],
    reviewer: str,
    tolerance: int = DEFAULT_TOLERANCE_LINES,
) -> ControlOutcome:
    """Grade the reviewer on one planted variant.

    Correct means: it flagged a bug or omission, or it stayed quiet on a harmless edit.
    """
    flagged = any(finding_hits_plant(f, plant, tolerance) for f in findings)
    return ControlOutcome(
        plant_id=plant.id,
        kind=plant.kind,
        reviewer=reviewer,
        flagged=flagged,
        correct=(flagged == plant.should_be_flagged),
    )


def missed_regions(plants: Iterable[Plant], outcomes: Iterable[ControlOutcome]) -> List[Plant]:
    """Planted bugs and omissions the reviewer did not flag: the lines a human should read."""
    wrong = {o.plant_id for o in outcomes if not o.correct}
    return [p for p in plants if p.id in wrong and p.should_be_flagged]
