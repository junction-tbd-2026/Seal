"""Writes docs/results.md from the saved runs, so the numbers in the docs are never typed by hand.

    PYTHONPATH=src python3 scripts/summarise_results.py
"""

import json
import sys
from pathlib import Path

from reviewer_controls.exam import build_exam

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
PULLS = ROOT / "pull_requests.json"
OUT = ROOT / "docs" / "results.md"


def pretty(model):
    return model.split("/")[-1]


def main():
    pulls = json.loads(PULLS.read_text())["pull_requests"]
    lines = [
        "# Results on Tieto's sample changes",
        "",
        "Generated from the saved runs by `scripts/summarise_results.py`. Do not edit by hand.",
        "",
        "Each reviewer saw exactly the same planted copies of a change. Planted copies were not",
        "compiled or run, so some planted defects may not be real defects. Counts are small;",
        "read the ranges, not the fractions.",
        "",
    ]
    pooled = {}
    for pull in pulls:
        exam = build_exam(RESULTS, pull["change_id"])
        lines.append("## Pull request #{}: {}".format(pull["number"], pull["title"]))
        lines.append("")
        if exam is None:
            lines += ["Not tested yet.", ""]
            continue
        kinds = {}
        for plant in exam["plants"]:
            kinds[plant["kind"]] = kinds.get(plant["kind"], 0) + 1
        lines.append(
            "{} files. {} planted edits ({}), written by {}.".format(
                pull["files"],
                len(exam["plants"]),
                ", ".join("{} {}".format(count, kind) for kind, count in sorted(kinds.items())),
                pretty(exam["planter"]),
            )
        )
        lines += [
            "",
            "| Reviewer | Verdict on the real change | Planted defects caught | Supported claim | False alarms | Verdict moved when requirement altered | No answer |",
            "|---|---|---|---|---|---|---|",
        ]
        for reviewer in exam["reviewers"]:
            counts = reviewer["counts"]
            verdict = (
                "no usable answer" if reviewer["review_failed"]
                else {True: "meets requirement", False: "does not meet", None: "could not tell"}[reviewer["verdict"]]
            )
            flip = {True: "yes", False: "no", None: "not tested"}[reviewer["requirement_flip_changed_verdict"]]
            lines.append(
                "| {} | {} | {} of {} | {} | {} of {} | {} | {} |".format(
                    pretty(reviewer["name"]), verdict, counts["defects_caught"], counts["defects_total"],
                    reviewer["claim"].split(". ", 1)[-1] if counts["defects_total"] else "nothing scored",
                    counts["false_alarms"], counts["harmless_total"], flip, counts["failed"],
                )
            )
            total = pooled.setdefault(reviewer["name"], {"caught": 0, "defects": 0, "alarms": 0, "harmless": 0, "failed": 0})
            total["caught"] += counts["defects_caught"]
            total["defects"] += counts["defects_total"]
            total["alarms"] += counts["false_alarms"]
            total["harmless"] += counts["harmless_total"]
            total["failed"] += counts["failed"]

            by_kind = {}
            plants = {plant["id"]: plant for plant in exam["plants"]}
            for plant_id, result in reviewer["results"].items():
                if result in ("caught", "missed"):
                    slot = by_kind.setdefault(plants[plant_id]["kind"], [0, 0])
                    slot[1] += 1
                    slot[0] += result == "caught"
            for kind, (caught, total_kind) in by_kind.items():
                slot = pooled[reviewer["name"]].setdefault("kind:" + kind, [0, 0])
                slot[0] += caught
                slot[1] += total_kind
        lines.append("")

    if pooled:
        from reviewer_controls.stats import wilson_interval

        lines += [
            "## Pooled across all tested changes",
            "",
            "| Reviewer | Planted defects caught | 95% interval | Bugs caught | Omissions caught | False alarms | No answer |",
            "|---|---|---|---|---|---|---|",
        ]
        for name, total in pooled.items():
            if total["defects"]:
                low, high = wilson_interval(total["caught"], total["defects"])
                interval = "{:.0%} to {:.0%}".format(low, high)
            else:
                interval = "nothing scored"
            bugs = total.get("kind:bug", [0, 0])
            omissions = total.get("kind:omission", [0, 0])
            lines.append(
                "| {} | {} of {} | {} | {} of {} | {} of {} | {} of {} | {} |".format(
                    pretty(name), total["caught"], total["defects"], interval, bugs[0], bugs[1],
                    omissions[0], omissions[1], total["alarms"], total["harmless"], total["failed"],
                )
            )
        lines.append("")

    OUT.write_text("\n".join(lines))
    print("wrote {}".format(OUT.relative_to(ROOT)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
