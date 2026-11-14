"""Command-line entry point."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from dataclasses import asdict
from pathlib import Path
from typing import List, Optional

from . import __version__
from .card import render_card
from .changes import ChangeLoadError, load_change
from .config import KeysFileInRepoError, MissingKeyError, load_settings, require, reviewer_prefixes, status
from .controls import cited_targets, first_reviews, run_controls, summarise
from .llm import ChatClient, ModelError
from .models import KIND_BUG, PLANT_KINDS, Plant, RequirementPoint
from .planter import PLANT_REPLY_TOKENS, ModelPlanter
from .reviewer import MAX_DIFF_CHARS, MAX_REPLY_TOKENS, ModelReviewer
from .stats import floor_if_all_caught

DEFAULT_REPO = "work/junction26-messagepack-csharp"
PLANTER_SETTINGS = ("PLANTER_BASE_URL", "PLANTER_MODEL", "PLANTER_API_KEY")


def client_for(settings, prefix: str, debug_dir: Optional[str] = None) -> ChatClient:
    """Model client for one role, e.g. PLANTER, REVIEWER or REVIEWER2."""
    return ChatClient(
        require(settings, prefix + "_BASE_URL"),
        require(settings, prefix + "_MODEL"),
        require(settings, prefix + "_API_KEY"),
        timeout=float(whole_number(settings, prefix + "_TIMEOUT_SECONDS", 600)),
        debug_dir=debug_dir,
    )


def save_plants(
    path: Path,
    change_id: str,
    planter: str,
    plants: List[Plant],
    altered_requirement: Optional[str],
    points: Optional[List[RequirementPoint]] = None,
) -> None:
    """Write the planted variants in full, so a later run can test another reviewer on the same ones."""
    path.write_text(
        json.dumps(
            {
                "change_id": change_id,
                "planter": planter,
                "altered_requirement": altered_requirement or "",
                "requirement_points": [asdict(point) for point in (points or [])],
                "plants": [asdict(plant) for plant in plants],
            },
            indent=2,
        )
    )


def load_plants(path: Path, change_id: str):
    """Read planted variants saved by an earlier run of the same change."""
    data = json.loads(path.read_text())
    if data["change_id"] != change_id:
        raise ValueError("it holds variants of {}, not {}".format(data["change_id"], change_id))
    plants = [Plant(**item) for item in data["plants"]]
    if not plants or not all(plant.variant_diff for plant in plants):
        raise ValueError("it holds no complete variants")
    points = [RequirementPoint(**item) for item in data.get("requirement_points", [])]
    return plants, (data.get("altered_requirement") or None), points


def whole_number(settings, name: str, default: int) -> int:
    try:
        return max(1, int(settings.get(name) or default))
    except ValueError:
        return default

STEPS = (
    "Load the change and its requirement",
    "Split the requirement into checkable points",
    "Review the real change, twice, with every reviewer",
    "Plant {plants} variants ({kinds}) inside the lines the reviewers cited",
    "Review every variant blind, each in a fresh session",
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
    parser.add_argument(
        "--plants-from", metavar="FILE",
        help="reuse the planted variants saved by an earlier run (a *__plants__*.json file) instead of planting new ones",
    )
    parser.add_argument("--dry-run", action="store_true", help="print the plan and settings status, then exit")
    parser.add_argument(
        "--debug", action="store_true",
        help="save every prompt and model reply to <out>/debug/ (never the keys)",
    )
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

    prefixes = reviewer_prefixes(settings)
    if args.dry_run:
        names = list(PLANTER_SETTINGS) + [p + suffix for p in prefixes for suffix in ("_BASE_URL", "_MODEL", "_API_KEY")]
        print("Settings: " + ", ".join("{} {}".format(name, status(settings, name)) for name in names))
        return 0

    repo = Path(args.repo or settings.get("SAMPLE_REPO_PATH") or DEFAULT_REPO)
    debug_dir = str(Path(args.out) / "debug") if args.debug else None
    try:
        planter = ModelPlanter(
            client_for(settings, "PLANTER", debug_dir), repo,
            max_tokens=whole_number(settings, "PLANTER_MAX_TOKENS", PLANT_REPLY_TOKENS),
            workers=whole_number(settings, "PLANTER_WORKERS", 3),
        )
        reviewers = [
            (
                ModelReviewer(
                    client_for(settings, prefix, debug_dir),
                    max_diff_chars=whole_number(settings, prefix + "_MAX_DIFF_CHARS", MAX_DIFF_CHARS),
                    max_tokens=whole_number(settings, prefix + "_MAX_TOKENS", MAX_REPLY_TOKENS),
                ),
                whole_number(settings, prefix + "_WORKERS", args.workers),
            )
            for prefix in prefixes
        ]
        change = load_change(repo, args.change, Path(args.requirements_dir), args.requirement)
    except (MissingKeyError, ChangeLoadError) as error:
        print("error: {}".format(error), file=sys.stderr)
        return 2

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Every reviewer is tested on the same planted variants, so the results compare fairly.
    plants = None
    altered = None
    points = None
    if args.plants_from:
        try:
            plants, altered, points = load_plants(Path(args.plants_from), change.id)
        except (OSError, ValueError, KeyError, TypeError) as error:
            print("error: cannot reuse planted variants from {}: {}".format(args.plants_from, error), file=sys.stderr)
            return 2

    started = time.time()

    def stage(message: str) -> None:
        print("[{:>4.0f}s] {}".format(time.time() - started, message))

    # Review the real change with every reviewer first, then plant once, inside the lines
    # any of them cited. Each reviewer is then tested on breaks of what it pointed at.
    # Work that does not depend on other work runs at the same time: the reviewers use
    # different services, and planting does not wait for the altered requirement.
    firsts = {}
    if plants is None:
        stage("Splitting the requirement into points")
        try:
            points = planter.split_requirement(change)
        except ModelError as error:
            points = []
            print("  note: the requirement could not be split into points: {}".format(error))
        stage("First reviews of the real change, all reviewers at once")
        with ThreadPoolExecutor(max_workers=max(1, len(reviewers))) as pool:
            futures = {pool.submit(first_reviews, change, reviewer, points): reviewer.name for reviewer, _ in reviewers}
            for future in as_completed(futures):
                firsts[futures[future]] = future.result()
                stage("  first reviews done: {}".format(futures[future]))
        targets = cited_targets([original for original, _ in firsts.values()])
        stage("Planting {} variants ({}) inside the cited lines, and writing the altered requirement".format(
            args.plants, ", ".join(args.kinds)))
        with ThreadPoolExecutor(max_workers=2) as pool:
            altering = pool.submit(planter.alter_requirement, change) if altered is None else None
            plants = planter.plant(change, args.plants, args.kinds, points, targets)
            if altering is not None:
                try:
                    altered = altering.result()
                except ModelError as error:
                    print("  note: could not write an altered requirement: {}".format(error))
        for problem in planter.problems:
            print("  note: {}".format(problem))
        if not plants:
            print("error: no usable planted variants, so there is nothing to test the reviewers on. Nothing was saved.", file=sys.stderr)
            return 1
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
        plants_path = out_dir / "{}__plants__{}.json".format(slug(change.id), stamp)
        save_plants(plants_path, change.id, planter.name, plants, altered, points)
        stage("Planted variants saved for reuse: {}".format(plants_path))

    def run_one(entry):
        reviewer, workers = entry
        original, repeat = firsts.get(reviewer.name, (None, None))
        return run_controls(
            change, planter, reviewer,
            count=args.plants, kinds=args.kinds, workers=workers,
            progress=lambda message: print("  [{}] {}".format(reviewer.name, message.strip())),
            plants=plants, altered_requirement=altered, points=points,
            original_review=original, repeat_review=repeat,
        )

    # All reviewers at once; each one's results are written the moment it finishes,
    # so a fast reviewer's results do not wait for a slow one.
    stage("Reviewing {} variants with {} reviewers at once".format(len(plants or []), len(reviewers)))
    lines = []
    with ThreadPoolExecutor(max_workers=max(1, len(reviewers))) as pool:
        for future in as_completed([pool.submit(run_one, entry) for entry in reviewers]):
            report = future.result()
            stem = "{}__{}__{}".format(slug(change.id), slug(report.reviewer), report.created_at.replace(":", ""))
            card_path = out_dir / (stem + ".card.md")
            (out_dir / (stem + ".json")).write_text(json.dumps(report.to_dict(), indent=2))
            card_path.write_text(render_card(report))
            counts = summarise(report)
            stage("Results written for {}".format(report.reviewer))
            lines.append(
                "{}: {} of {} planted defects caught, {} of {} harmless edits wrongly flagged, "
                "{} reviews failed. Card: {}".format(
                    report.reviewer, counts["defects_caught"], counts["defects_total"],
                    counts["false_alarms"], counts["harmless_total"], counts["failed_reviews"], card_path,
                )
            )
            for note in report.notes:
                print("  note: {}".format(note))

    stage("Done.")
    for line in lines:
        print("  " + line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
