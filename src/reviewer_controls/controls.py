"""Runs the controls on one change: split the requirement, plant, review blind, score."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from .llm import ModelError
from .diffs import same_file
from .matcher import DEFAULT_TOLERANCE_LINES, finding_hits_plant, score_plant
from .models import KIND_BUG, KIND_HARMLESS, Change, ControlOutcome, Plant, RequirementPoint, ReviewResult, RunReport
from .planter import Planter
from .reviewer import Reviewer

Progress = Optional[Callable[[str], None]]


def _say(progress: Progress, message: str) -> None:
    if progress:
        progress(message)


def point_status(review: ReviewResult, point_id: Optional[str]) -> Optional[str]:
    if not point_id:
        return None
    return next((point.status for point in review.points if point.id == point_id), None)


def sits_in_cited_lines(plant: Plant, original: ReviewResult) -> bool:
    """True when the planted edit is inside the lines the reviewer itself cited for that point."""
    cited = next((point.evidence for point in original.points if point.id == plant.breaks), [])
    return any(
        same_file(ref["file"], plant.file)
        and plant.line_start <= ref["line_end"] + DEFAULT_TOLERANCE_LINES
        and plant.line_end >= ref["line_start"] - DEFAULT_TOLERANCE_LINES
        for ref in cited
    )


def score(
    plant: Plant,
    variant: ReviewResult,
    original: ReviewResult,
    unstable: Sequence[str] = (),
) -> ControlOutcome:
    """Grade one variant.

    A planted defect counts as caught when the reviewer flags the planted spot, or stops
    calling the requirement point it breaks "met". A harmless edit counts as a false alarm
    when the reviewer flags it, or withdraws a "met" it gave the real change.

    Points whose answer changed between two identical reviews are ignored: a change of
    answer there proves nothing. So is a spot the reviewer already flagged in the real change.
    """
    outcome = score_plant(plant, variant.findings, variant.reviewer)
    outcome.point_id = plant.breaks

    if plant.breaks:
        outcome.point_link = "confirmed" if sits_in_cited_lines(plant, original) else "unconfirmed"
        if point_status(original, plant.breaks) == "met" and plant.breaks not in unstable:
            outcome.point_noticed = point_status(variant, plant.breaks) != "met"
            if plant.should_be_flagged and outcome.point_noticed:
                outcome.correct = True

    if not plant.should_be_flagged:
        withdrew = any(
            point.status == "met" and point.id not in unstable and point_status(variant, point.id) != "met"
            for point in original.points
        )
        if withdrew:
            outcome.flagged = True
            outcome.correct = False

    if any(finding_hits_plant(f, plant) for f in original.findings):
        outcome.inconclusive = True
    return outcome


def cited_targets(reviews: Sequence[ReviewResult]) -> Dict[str, List[dict]]:
    """For each requirement point, the lines any of these reviews cited as evidence that it is met."""
    targets: Dict[str, List[dict]] = {}
    for review in reviews:
        for point in review.points:
            if point.status != "met":
                continue
            for ref in point.evidence:
                if ref not in targets.setdefault(point.id, []):
                    targets[point.id].append(ref)
    return targets


def first_reviews(
    change: Change,
    reviewer: Reviewer,
    points: Sequence[RequirementPoint],
    progress: Progress = None,
) -> Tuple[ReviewResult, Optional[ReviewResult]]:
    """Review the real change, and again unchanged as a control for chance. Both run at once."""
    _say(progress, "Reviewing the real change, twice at the same time")
    if not points:
        return reviewer.review(change, points=list(points)), None
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(reviewer.review, change, points=list(points))
        second = pool.submit(reviewer.review, change, variant_id="repeat", points=list(points))
        original, repeat = first.result(), second.result()
    return original, (None if original.error else repeat)


def run_controls(
    change: Change,
    planter: Planter,
    reviewer: Reviewer,
    count: int = 10,
    kinds: Sequence[str] = (KIND_BUG,),
    workers: int = 4,
    progress: Progress = None,
    plants: Optional[List[Plant]] = None,
    altered_requirement: Optional[str] = None,
    points: Optional[List[RequirementPoint]] = None,
    original_review: Optional[ReviewResult] = None,
    repeat_review: Optional[ReviewResult] = None,
) -> RunReport:
    """Run the controls for one reviewer.

    The order matters. The real change is reviewed first, so the planted edits can be aimed
    at the very lines the reviewer cited: "we broke what you pointed at; did you notice?"

    To compare reviewers fairly, review the real change with each (`first_reviews`), plant
    once against all their citations, then pass `plants`, `points`, `original_review` and
    `repeat_review` to this function for each reviewer.
    """
    started = time.time()
    report = RunReport(
        change=change,
        reviewer=reviewer.name,
        planter=planter.name,
        created_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    if planter.name == reviewer.name:
        report.notes.append("Planter and reviewer are the same model, so the reviewer is graded on its own style of bug.")

    if points is None and plants is None:
        _say(progress, "Splitting the requirement into points")
        try:
            points = planter.split_requirement(change)
        except (ModelError, NotImplementedError) as error:
            points = []
            report.notes.append("The requirement could not be split into points: {}".format(error))
    report.requirement_points = points or []

    # When the planted variants are already known, nothing below depends on anything else:
    # the two reviews of the real change, every variant and the altered-requirement review all
    # go out in one round. Planting fresh needs the real change reviewed first, for its citations.
    in_one_round = original_review is None and plants is not None
    if original_review is None and not in_one_round:
        original_review, repeat_review = first_reviews(change, reviewer, report.requirement_points, progress)

    if plants is not None:
        _say(progress, "Reusing {} planted variants".format(len(plants)))
        report.plants = plants
    else:
        _say(progress, "Planting {} variants ({}) inside the lines the reviewer cited".format(count, ", ".join(kinds)))
        report.plants = planter.plant(change, count, kinds, report.requirement_points, cited_targets([original_review]))
        report.notes.extend(getattr(planter, "problems", []))
    if len(report.plants) < count:
        report.notes.append("Asked for {} planted variants; {} were usable.".format(count, len(report.plants)))

    # The altered requirement is only used when the reviewer says the real change meets the
    # requirement. In one round that is not known yet, so it is reviewed anyway and kept only if so.
    may_alter = in_one_round or (original_review is not None and original_review.meets_requirement is True)
    if may_alter and not altered_requirement and not in_one_round:
        try:
            altered_requirement = planter.alter_requirement(change)
        except ModelError as error:
            report.notes.append("Could not write an altered requirement: {}".format(error))

    def review_variant(plant: Plant) -> ReviewResult:
        result = reviewer.review(
            change, variant_id=plant.id, variant_diff=plant.variant_diff, points=report.requirement_points
        )
        _say(progress, "  {} reviewed".format(plant.id))
        return result

    _say(progress, "Reviewing {} variants blind{}".format(
        len(report.plants), ", with the real change and the altered requirement in the same round" if in_one_round else ""))
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        if in_one_round:
            first = pool.submit(reviewer.review, change, points=list(report.requirement_points))
            second = pool.submit(reviewer.review, change, variant_id="repeat", points=list(report.requirement_points)) \
                if report.requirement_points else None
        variants = [pool.submit(review_variant, plant) for plant in report.plants]
        flipped_future = (
            pool.submit(reviewer.review, change, variant_id="altered-requirement", requirement_override=altered_requirement)
            if may_alter and altered_requirement else None
        )
        if in_one_round:
            original_review = first.result()
            repeat_review = second.result() if second is not None and not original_review.error else None
        report.variant_reviews = [future.result() for future in variants]
        flipped = flipped_future.result() if flipped_future is not None else None

    report.original_review = original_review
    report.repeat_review = repeat_review
    if original_review.error:
        report.notes.append("The review of the real change failed: {}".format(original_review.error))

    # Control for chance: a point that gets a different answer with nothing changed
    # cannot be used to judge the planted copies.
    if repeat_review is not None:
        if repeat_review.error:
            report.notes.append("The repeat review failed, so chance changes of answer were not ruled out.")
        else:
            report.unstable_points = [
                point.id
                for point in report.requirement_points
                if point_status(original_review, point.id) != point_status(repeat_review, point.id)
            ]
            if report.unstable_points:
                report.notes.append(
                    "The reviewer answered differently on two identical reviews for {}; those points are not scored.".format(
                        ", ".join(report.unstable_points)
                    )
                )

    for plant, variant in zip(report.plants, report.variant_reviews):
        if variant.error:
            report.notes.append("Review of {} failed and is left out of the score: {}".format(plant.id, variant.error))
            continue
        report.outcomes.append(score(plant, variant, original_review, report.unstable_points))

    if original_review.meets_requirement is not True:
        report.notes.append(
            "Altered-requirement check skipped: the reviewer did not say the real change meets the requirement."
        )
    elif flipped is not None:
        report.altered_requirement = altered_requirement
        report.altered_requirement_review = flipped
        if flipped.error:
            report.notes.append("Altered-requirement review failed: {}".format(flipped.error))
        else:
            report.requirement_flip_changed_verdict = flipped.meets_requirement is not True

    reviews = [original_review] + report.variant_reviews
    if repeat_review:
        reviews.append(repeat_review)
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
