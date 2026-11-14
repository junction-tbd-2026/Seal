"""Command-line entry point.

Only the plan (`--dry-run`) works so far. The run itself is wired up once the
planter, reviewer and runner exist.
"""

from __future__ import annotations

import argparse
import sys
from typing import List, Optional

from . import __version__
from .models import KIND_BUG, PLANT_KINDS
from .stats import floor_if_all_caught

STEPS = (
    "Load the change and its requirement",
    "Plant {plants} variants ({kinds})",
    "Build each variant and discard any that do not compile",
    "Review the original and every variant blind, each in a fresh session",
    "Match findings to planted locations",
    "Rerun the review with the requirement altered",
    "Write the run report to results/ and the sign-off card",
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="reviewer-controls",
        description="Test an AI code reviewer on one change by planting known bugs.",
    )
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--change", required=True, help="branch or change id to review, e.g. ju26-issue-2283")
    parser.add_argument("--requirement", help="requirement id the change claims to meet")
    parser.add_argument("--plants", type=int, default=10, help="number of planted variants (default: 10)")
    parser.add_argument(
        "--kinds",
        nargs="+",
        default=[KIND_BUG],
        choices=PLANT_KINDS,
        help="kinds of variant to plant (default: bug)",
    )
    parser.add_argument("--dry-run", action="store_true", help="print the plan and exit")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.plants < 1:
        print("error: --plants must be at least 1", file=sys.stderr)
        return 2

    print("Change: {}".format(args.change))
    for number, step in enumerate(STEPS, start=1):
        print("  {}. {}".format(number, step.format(plants=args.plants, kinds=", ".join(args.kinds))))
    print(
        "If all {} planted bugs are caught, the supported claim is a catch rate of at least {:.0%}.".format(
            args.plants, floor_if_all_caught(args.plants)
        )
    )

    if args.dry_run:
        return 0

    print("error: the run is not built yet; use --dry-run", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
