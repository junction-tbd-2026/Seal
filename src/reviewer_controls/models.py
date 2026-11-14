"""Data shapes shared by every step of the pipeline.

Everything here serialises to plain JSON so runs can be saved to `results/`
and read by the web page without importing this package.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import List, Optional

# Kinds of planted variant.
KIND_BUG = "bug"                # a wrong line the reviewer should flag
KIND_OMISSION = "omission"      # required behaviour removed from the change
KIND_HARMLESS = "harmless"      # behaviour-preserving edit; reviewer should stay quiet
KIND_HISTORICAL = "historical"  # a real past bug from the project's history, re-introduced

PLANT_KINDS = (KIND_BUG, KIND_OMISSION, KIND_HARMLESS, KIND_HISTORICAL)


@dataclass
class Change:
    """One agent-written change under review, with the requirement it claims to meet."""

    id: str
    requirement_id: str
    requirement_text: str
    base_ref: str
    head_ref: str
    diff: str = ""


@dataclass
class Plant:
    """One planted variant of a change: where it is and what it should provoke."""

    id: str
    kind: str
    description: str
    file: str
    line_start: int
    line_end: int
    patch: str = ""
    difficulty: str = "medium"       # easy | medium | hard
    proven: Optional[bool] = None    # True once a test distinguishes it from the original

    @property
    def should_be_flagged(self) -> bool:
        return self.kind != KIND_HARMLESS


@dataclass
class Finding:
    """One problem reported by the reviewer."""

    file: str
    line_start: int
    line_end: int
    message: str
    severity: str = "unknown"


@dataclass
class ReviewResult:
    """What the reviewer said about one variant (or the original)."""

    reviewer: str
    variant_id: str                  # "original" or a Plant.id
    findings: List[Finding] = field(default_factory=list)
    meets_requirement: Optional[bool] = None
    refused_to_decide: List[str] = field(default_factory=list)
    cost_usd: float = 0.0
    seconds: float = 0.0


@dataclass
class ControlOutcome:
    """Whether the reviewer behaved correctly on one planted variant."""

    plant_id: str
    kind: str
    reviewer: str
    flagged: bool                    # did any finding hit the planted location
    correct: bool                    # flagged for bugs/omissions, quiet for harmless edits


@dataclass
class RunReport:
    """Everything one run produced, ready to save and to turn into a sign-off card."""

    change: Change
    reviewer: str
    plants: List[Plant] = field(default_factory=list)
    original_review: Optional[ReviewResult] = None
    outcomes: List[ControlOutcome] = field(default_factory=list)
    requirement_flip_changed_verdict: Optional[bool] = None
    total_cost_usd: float = 0.0
    total_seconds: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)
