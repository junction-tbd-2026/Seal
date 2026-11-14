"""Command-line entry point."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import List, Optional

from . import __version__
from .card import render_card
from .changes import ChangeLoadError, load_change
from .config import KeysFileInRepoError, MissingKeyError, load_settings, require, status
from .controls import run_controls, summarise
from .llm import ChatClient
from .models import KIND_BUG, PLANT_KINDS
from .planter import ModelPlanter
from .reviewer import ModelReviewer
from .stats import floor_if_all_caught

DEFAULT_REPO = "work/junction26-messagepack-csharp"
SETTING_NAMES = (
    "PLANTER_BASE_URL", "PLANTER_MODEL", "PLANTER_API_KEY",
    "REVIEWER_BASE_URL", "REVIEWER_MODEL", "REVIEWER_API_KEY",
)

STEPS = (
    "Load the change and its requirement",
    "Plant {plants} variants ({kinds})",
    "Review the real change and every variant blind, each in a fresh session",
    "Match findings to planted locations",
    "Rerun the review with the requirement altered",
    "Write the run report and the sign-off card to {out}/",
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="reviewer-controls",
        description="Test an AI code reviewer on one change by planting known bugs.",
    )
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--change", required=True, help="branch or change id to review, e.g. ju26-issue-2283")
    parser.add_argument("--requirement", help="requirement id (default: taken from the change id)")
    parser.add_argument("--plants", type=int, default=10, help="number of planted variants (default: 10)")
    parser.add_argument(
        "--kinds", nargs="+", default=[KIND_BUG], choices=PLANT_KINDS[:3],
        help="kinds of variant to plant (default: bug)",
    )
    parser.add_argument("--workers", type=int, default=4, help="reviews to run at once (default: 4)")
    parser.add_argument("--repo", help="path to the sample repository (default: {})".format(DEFAULT_REPO))
    parser.add_argument("--requirements-dir", default="requirements", help="folder of requirement files")
    parser.add_argument("--out", default="results", help="folder for the run report and card")
    parser.add_argument("--dry-run", action="store_true", help="print the plan and settings status, then exit")
    return parser


def slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower() or "reviewer"


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.plants < 1:
        print("error: --plants must be at least 1", file=sys.stderr)
        return 2

    try:
        settings = load_settings()
    except KeysFileInRepoError as error:
        print("error: {}".format(error), file=sys.stderr)
        return 2

    print("Change: {}".format(args.change))
    for number, step in enumerate(STEPS, start=1):
        print("  {}. {}".format(number, step.format(plants=args.plants, kinds=", ".join(args.kinds), out=args.out)))
    print(
        "If all {} planted defects are caught, the supported claim is a catch rate of at least {:.0%}.".format(
            args.plants, floor_if_all_caught(args.plants)
        )
    )

    if args.dry_run:
        print("Settings: " + ", ".join("{} {}".format(name, status(settings, name)) for name in SETTING_NAMES))
        return 0

    repo = Path(args.repo or settings.get("SAMPLE_REPO_PATH") or DEFAULT_REPO)
    try:
        planter_client = ChatClient(
            require(settings, "PLANTER_BASE_URL"), require(settings, "PLANTER_MODEL"), require(settings, "PLANTER_API_KEY")
        )
        reviewer_client = ChatClient(
            require(settings, "REVIEWER_BASE_URL"), require(settings, "REVIEWER_MODEL"), require(settings, "REVIEWER_API_KEY")
        )
        change = load_change(repo, args.change, Path(args.requirements_dir), args.requirement)
    except (MissingKeyError, ChangeLoadError) as error:
        print("error: {}".format(error), file=sys.stderr)
        return 2

    report = run_controls(
        change,
        ModelPlanter(planter_client, repo),
        ModelReviewer(reviewer_client),
        count=args.plants,
        kinds=args.kinds,
        workers=args.workers,
        progress=print,
    )

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = "{}__{}__{}".format(slug(change.id), slug(report.reviewer), report.created_at.replace(":", ""))
    report_path = out_dir / (stem + ".json")
    card_path = out_dir / (stem + ".card.md")
    report_path.write_text(json.dumps(report.to_dict(), indent=2))
    card_path.write_text(render_card(report))

    counts = summarise(report)
    print(
        "Done: {} of {} planted defects caught, {} of {} harmless edits wrongly flagged.".format(
            counts["defects_caught"], counts["defects_total"], counts["false_alarms"], counts["harmless_total"]
        )
    )
    print("Report: {}".format(report_path))
    print("Card:   {}".format(card_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
