"""Turns a run report into the one-page sign-off card a named human signs."""

from __future__ import annotations

from typing import List

from .controls import summarise
from .matcher import missed_regions
from .models import RunReport
from .stats import floor_if_all_caught, wilson_interval


def _supported_claim(caught: int, total: int) -> str:
    if total == 0:
        return "No planted defects were scored, so nothing can be claimed about the reviewer."
    if caught == total:
        return "All {} caught. This supports a catch rate of at least {:.0%} (95% confidence).".format(
            total, floor_if_all_caught(total)
        )
    low, high = wilson_interval(caught, total)
    return "{} of {} caught. The true catch rate is between {:.0%} and {:.0%} (95% interval).".format(
        caught, total, low, high
    )


def render_card(report: RunReport) -> str:
    counts = summarise(report)
    original = report.original_review
    lines: List[str] = []
    add = lines.append

    add("# Sign-off card: {}".format(report.change.id))
    add("")
    add("- Requirement: #{}".format(report.change.requirement_id))
    add("- Reviewer under test: {}".format(report.reviewer))
    add("- Planted by: {}".format(report.planter))
    add("- Run: {}".format(report.created_at))
    add("")

    add("## What the reviewer found in the real change")
    add("")
    if original is None or original.error:
        add("The review of the real change did not complete. Read the change yourself.")
    else:
        verdict = {True: "meets the requirement", False: "does NOT meet the requirement", None: "could not tell"}
        add("Verdict: the reviewer says the change **{}**.".format(verdict[original.meets_requirement]))
        add("")
        if original.findings:
            for finding in original.findings:
                add("- `{}` lines {}-{} ({}): {}".format(
                    finding.file, finding.line_start, finding.line_end, finding.severity, finding.message
                ))
        else:
            add("No findings.")
    add("")

    add("## How far to trust that review")
    add("")
    add("- Planted defects: {}".format(_supported_claim(counts["defects_caught"], counts["defects_total"])))
    if counts["harmless_total"]:
        add("- Harmless edits: {} of {} wrongly flagged (false alarms).".format(
            counts["false_alarms"], counts["harmless_total"]
        ))
    else:
        add("- Harmless edits: none planted, so false alarms were not measured.")
    if report.requirement_flip_changed_verdict is True:
        add("- Altered requirement: the verdict changed, so the reviewer did check against the requirement.")
    elif report.requirement_flip_changed_verdict is False:
        add("- Altered requirement: the verdict did NOT change. Its requirement check is not reliable here.")
    else:
        add("- Altered requirement: not tested.")
    if counts["inconclusive"]:
        add("- {} planted variant(s) were left out: the reviewer had already flagged that spot in the real change.".format(
            counts["inconclusive"]
        ))
    add("")

    add("## Read these lines yourself")
    add("")
    missed = missed_regions(report.plants, [o for o in report.outcomes if not o.inconclusive])
    if missed:
        add("The reviewer did not see a defect planted here, so its silence on these lines means little:")
        add("")
        for plant in missed:
            add("- `{}` around lines {}-{} ({}, {}): {}".format(
                plant.file, plant.line_start, plant.line_end, plant.kind, plant.difficulty, plant.description
            ))
    elif counts["defects_total"]:
        add("None singled out: every scored planted defect was caught.")
    else:
        add("No planted defects were scored. Treat the whole change as unreviewed.")
    add("")

    add("## What the reviewer refused to decide")
    add("")
    refused = original.refused_to_decide if original and not original.error else []
    if refused:
        for item in refused:
            add("- {}".format(item))
    else:
        add("Nothing stated.")
    add("")

    add("## Not checked")
    add("")
    if not report.build_checked:
        add("- Planted variants were not compiled or run, so some may not be real defects.")
    add("- Design-level mistakes and anything outside this diff.")
    add("- Planted defects are usually easier to catch than real ones, so the figures lean optimistic.")
    for note in report.notes:
        add("- {}".format(note))
    add("")

    add("## Cost")
    add("")
    add("- {} reviews, {:,} tokens in and {:,} out, {:.0f} seconds.".format(
        1 + len(report.variant_reviews) + (1 if report.altered_requirement_review else 0),
        report.prompt_tokens,
        report.completion_tokens,
        report.wall_seconds,
    ))
    add("")

    add("## Sign-off")
    add("")
    add("I have read the findings and the lines listed above, and I accept the remaining risk.")
    add("")
    add("- Name: ______________________")
    add("- Decision: accept / reject / needs full read")
    add("- Date: ______________________")
    add("")
    return "\n".join(lines)
