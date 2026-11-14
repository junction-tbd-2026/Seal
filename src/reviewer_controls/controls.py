"""Runs the controls on one change: plant, review blind, score, alter the requirement."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional, Sequence

from .llm import ModelError
from .matcher import finding_hits_plant, score_plant
from .models import KIND_BUG, KIND_HARMLESS, Change, ControlOutcome, Plant, ReviewResult, RunReport
from .planter import Planter
from .reviewer import Reviewer

Progress = Optional[Callable[[str], None]]


def _say(progress: Progress, message: str) -> None:
    if progress:
        progress(message)


def score(plant: Plant, variant: ReviewResult, original: ReviewResult) -> ControlOutcome:
    """Grade one variant. A spot the reviewer already flagged in the real change proves nothing."""
    outcome = score_plant(plant, variant.findings, variant.reviewer)
    if any(finding_hits_plant(f, plant) for f in original.findings):
        outcome.inconclusive = True
    return outcome


def run_controls(
    change: Change,
    planter: Planter,
    reviewer: Reviewer,
    count: int = 10,
    kinds: Sequence[str] = (KIND_BUG,),
    workers: int = 4,
    progress: Progress = None,
) -> RunReport:
    started = time.time()
    report = RunReport(
        change=change,
        reviewer=reviewer.name,
        planter=planter.name,
        created_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    if planter.name == reviewer.name:
        report.notes.append("Planter and reviewer are the same model, so the reviewer is graded on its own style of bug.")

    _say(progress, "Planting {} variants ({})".format(count, ", ".join(kinds)))
    report.plants = planter.plant(change, count, kinds)
    if len(report.plants) < count:
        report.notes.append("Asked for {} planted variants; {} were usable.".format(count, len(report.plants)))

    _say(progress, "Reviewing the real change")
    report.original_review = reviewer.review(change)
    if report.original_review.error:
        report.notes.append("The review of the real change failed: {}".format(report.original_review.error))

    _say(progress, "Reviewing {} variants blind".format(len(report.plants)))

    def review_variant(plant: Plant) -> ReviewResult:
        result = reviewer.review(change, variant_id=plant.id, variant_diff=plant.variant_diff)
        _say(progress, "  {} reviewed".format(plant.id))
        return result

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        report.variant_reviews = list(pool.map(review_variant, report.plants))

    for plant, variant in zip(report.plants, report.variant_reviews):
        if variant.error:
            report.notes.append("Review of {} failed and is left out of the score: {}".format(plant.id, variant.error))
            continue
        report.outcomes.append(score(plant, variant, report.original_review))

    _say(progress, "Rerunning the review with the requirement altered")
    if report.original_review.meets_requirement is not True:
        report.notes.append(
            "Altered-requirement check skipped: the reviewer did not say the real change meets the requirement."
        )
    else:
        try:
            report.altered_requirement = planter.alter_requirement(change)
        except ModelError as error:
            report.notes.append("Could not write an altered requirement: {}".format(error))
        if report.altered_requirement:
            flipped = reviewer.review(
                change, variant_id="altered-requirement", requirement_override=report.altered_requirement
            )
            report.altered_requirement_review = flipped
            if flipped.error:
                report.notes.append("Altered-requirement review failed: {}".format(flipped.error))
            else:
                report.requirement_flip_changed_verdict = flipped.meets_requirement is not True

    reviews = [report.original_review] + report.variant_reviews
    if report.altered_requirement_review:
        reviews.append(report.altered_requirement_review)
    report.prompt_tokens = sum(r.prompt_tokens for r in reviews)
    report.completion_tokens = sum(r.completion_tokens for r in reviews)
    report.wall_seconds = time.time() - started
    return report


def summarise(report: RunReport) -> Dict[str, int]:
    """Counts behind the sign-off card. Inconclusive and failed variants are left out of the rates."""
    scored: List[ControlOutcome] = [o for o in report.outcomes if not o.inconclusive]
    defects = [o for o in scored if o.kind != KIND_HARMLESS]
    harmless = [o for o in scored if o.kind == KIND_HARMLESS]
    return {
        "planted": len(report.plants),
        "defects_total": len(defects),
        "defects_caught": sum(1 for o in defects if o.correct),
        "harmless_total": len(harmless),
        "false_alarms": sum(1 for o in harmless if not o.correct),
        "inconclusive": sum(1 for o in report.outcomes if o.inconclusive),
        "failed_reviews": sum(1 for r in report.variant_reviews if r.error),
    }
