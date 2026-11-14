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
class RequirementPoint:
    """One checkable statement taken from the requirement."""

    id: str                          # R1, R2, ...
    text: str


@dataclass
class PointAssessment:
    """What the reviewer says about one requirement point, and the lines it cites."""

    id: str
    status: str = "cannot_tell"      # met | not_met | cannot_tell
    evidence: List[dict] = field(default_factory=list)   # [{"file", "line_start", "line_end", "in_change"}]
    reason: str = ""
    dropped_evidence: int = 0        # citations thrown out, for any reason
    broad_evidence: int = 0          # of those, the ones that covered too many lines to count
    # What the reviewer itself answered, before our citation check could lower "met" to "cannot_tell".
    # Scoring uses this, so a change made by our check is never counted as the reviewer noticing something.
    claimed_status: str = ""


@dataclass
class Plant:
    """One planted variant of a change: where it is and what it should provoke."""

    id: str
    kind: str
    description: str
    file: str
    line_start: int                  # line numbers in the planted version of the file
    line_end: int
    patch: str = ""                  # the planted edit alone, against the real change
    difficulty: str = "medium"       # easy | medium | hard
    proven: Optional[bool] = None    # True once a test distinguishes it from the original
    breaks: Optional[str] = None     # the requirement point this edit breaks, if any
    near: Optional[str] = None       # for a harmless edit: the point whose cited lines it sits in
    variant_diff: str = ""           # the whole change with the edit applied; not saved

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
    variant_id: str                  # "original", "altered-requirement" or a Plant.id
    findings: List[Finding] = field(default_factory=list)
    meets_requirement: Optional[bool] = None
    refused_to_decide: List[str] = field(default_factory=list)
    points: List[PointAssessment] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    seconds: float = 0.0
    error: str = ""                  # set when the review could not be completed


@dataclass
class ControlOutcome:
    """Whether the reviewer behaved correctly on one planted variant."""

    plant_id: str
    kind: str
    reviewer: str
    flagged: bool                    # did any finding hit the planted location
    correct: bool                    # flagged for bugs/omissions, quiet for harmless edits
    inconclusive: bool = False       # the reviewer already flagged this spot in the real change
    point_id: Optional[str] = None   # the requirement point the planted edit breaks
    point_noticed: Optional[bool] = None   # did the reviewer stop calling that point met
    point_link: Optional[str] = None  # "confirmed" when the edit sits in lines the reviewer cited for that point
    near_point: Optional[str] = None  # for a harmless edit: the point whose cited lines it sits in
    near_alarm: Optional[bool] = None  # for a harmless edit: did the reviewer withdraw "met" on that point


@dataclass
class RunReport:
    """Everything one run produced, ready to save and to turn into a sign-off card."""

    change: Change
    reviewer: str
    planter: str = ""
    created_at: str = ""
    requirement_points: List[RequirementPoint] = field(default_factory=list)
    plants: List[Plant] = field(default_factory=list)
    original_review: Optional[ReviewResult] = None
    variant_reviews: List[ReviewResult] = field(default_factory=list)
    outcomes: List[ControlOutcome] = field(default_factory=list)
    repeat_review: Optional[ReviewResult] = None      # the real change reviewed a second time, unchanged
    unstable_points: List[str] = field(default_factory=list)   # points whose answer differed between the two
    altered_requirement: str = ""
    altered_requirement_review: Optional[ReviewResult] = None
    requirement_flip_changed_verdict: Optional[bool] = None
    build_checked: bool = False
    prompt_tokens: int = 0
    completion_tokens: int = 0
    wall_seconds: float = 0.0
    notes: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        data = asdict(self)
        for plant in data["plants"]:
            plant.pop("variant_diff", None)
        return data
