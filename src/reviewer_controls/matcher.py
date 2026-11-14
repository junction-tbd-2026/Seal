"""Decides whether the reviewer's findings hit a planted location."""

from __future__ import annotations

import re
from typing import Iterable, List, Set

from .models import ControlOutcome, Finding, Plant

# A finding a few lines off the planted edit still counts: reviewers often
# point at the statement around the bug, not the exact line.
DEFAULT_TOLERANCE_LINES = 3
# A finding that spans more lines than this points at nothing in particular, so its
# location alone does not count as hitting a planted edit inside it.
MAX_FINDING_LINES = 25

_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _same_file(a: str, b: str) -> bool:
    a, b = a.replace("\\", "/").lstrip("./"), b.replace("\\", "/").lstrip("./")
    return a == b or a.endswith("/" + b) or b.endswith("/" + a)


def finding_hits_plant(finding: Finding, plant: Plant, tolerance: int = DEFAULT_TOLERANCE_LINES) -> bool:
    """True when the finding is in the plant's file and overlaps its lines, within tolerance."""
    if not _same_file(finding.file, plant.file):
        return False
    return finding.line_start <= plant.line_end + tolerance and finding.line_end >= plant.line_start - tolerance


def changed_symbols(patch: str) -> Set[str]:
    """Names the planted edit took out of the code: in a removed line and in no added line.

    Only long, specific names count (eight or more characters, with a capital letter or an
    underscore inside), so a common word in a finding cannot be mistaken for one.
    """
    removed: Set[str] = set()
    added: Set[str] = set()
    for line in patch.splitlines():
        if line.startswith("---") or line.startswith("+++"):
            continue
        if line.startswith("-"):
            removed.update(_IDENTIFIER.findall(line[1:]))
        elif line.startswith("+"):
            added.update(_IDENTIFIER.findall(line[1:]))
    return {
        name for name in removed - added
        if len(name) >= 8 and (any(ch.isupper() for ch in name[1:]) or "_" in name.strip("_"))
    }


def finding_names_plant(finding: Finding, plant: Plant) -> bool:
    """True when a finding in the plant's file names something the planted edit removed.

    A reviewer that writes "ReportIfLocatedInCompilation is defined but never called" has
    noticed the removed call, even if it points at the method's definition instead.
    """
    if not plant.patch or not _same_file(finding.file, plant.file):
        return False
    return any(re.search(r"\b{}\b".format(re.escape(name)), finding.message) for name in changed_symbols(plant.patch))


def finding_notices_plant(finding: Finding, plant: Plant, tolerance: int = DEFAULT_TOLERANCE_LINES) -> bool:
    """The finding is about the planted edit: it points at it narrowly, or it names what the edit removed."""
    narrow = finding.line_end - finding.line_start + 1 <= MAX_FINDING_LINES
    return (narrow and finding_hits_plant(finding, plant, tolerance)) or finding_names_plant(finding, plant)


def score_plant(
    plant: Plant,
    findings: Iterable[Finding],
    reviewer: str,
    tolerance: int = DEFAULT_TOLERANCE_LINES,
) -> ControlOutcome:
    """Grade the reviewer on one planted variant.

    Correct means: it flagged a bug or omission, or it stayed quiet on a harmless edit.
    """
    flagged = any(finding_notices_plant(f, plant, tolerance) for f in findings)
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
