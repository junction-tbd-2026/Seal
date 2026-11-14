"""Writes the planted variants of a change.

A planter must be a different model from the reviewer under test, so the
reviewer is not graded on bugs written in its own style.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .changes import file_at
from .diffs import FileDiff, file_diff_text, overlaps_added, replace_file_in_diff, same_file, split_diff
from .llm import ChatClient, ModelError, as_int, extract_json
from .models import KIND_BUG, KIND_HARMLESS, KIND_OMISSION, Change, Plant, RequirementPoint

EXCERPT_CONTEXT_LINES = 30
EXCERPT_MAX_LINES = 500
SPARE_PROPOSALS = 1
# Room for the reply. Models that think before answering spend part of this on the thinking;
# one planter used 16,000 tokens on thinking alone before it started its answer.
PLANT_REPLY_TOKENS = 32000

PLANT_SYSTEM = """You help test a code review process by writing small, deliberate edits to a source file.
You are given a requirement and a file that was just changed to meet it.
Lines marked with "+" after the line number are the lines the change added or modified.

Propose edits. Each edit replaces one contiguous range of lines and has a kind:
- "bug": introduces a real behavioural defect that a careful reviewer should catch
  (wrong boundary, inverted or weakened condition, missing null or empty check, wrong variable,
  swallowed error, off-by-one). Subtle, not absurd.
- "omission": removes or disables behaviour that the requirement needs, so the requirement is no longer met.
- "harmless": changes the code without changing behaviour at all
  (rename a local, reorder independent statements, an equivalent rewrite).

Rules:
- Edit only lines marked "+" or lines directly next to them.
- The file must still compile.
- Match the surrounding style exactly. Add no comments and no hints that the edit is deliberate.
- Keep each edit small: usually one to five lines.
- Each edit is applied alone to its own copy of the file, so several edits may touch the same line,
  but every edit must be a different defect.
- Work quickly. Pick the edits and write them down; do not deliberate at length or weigh many alternatives.

When requirement points are listed, say which one each edit breaks: "breaks": "R2".
Use null for a harmless edit, or when no single point is broken. Spread the edits across the points.

Reply with JSON only, in this shape:
{"edits": [{"kind": "bug", "difficulty": "easy|medium|hard", "description": "what is wrong and why it matters",
"breaks": "R1", "line_start": 10, "line_end": 12, "original": "exact current text of those lines",
"replacement": "new text for those lines, or an empty string to delete them"}]}"""

POINTS_SYSTEM = """You turn a software requirement into a short checklist a code reviewer can verify.
You are given the requirement only. You have not seen any code written for it, and you must not guess at one.
Write three to five points. Each point is one behaviour that must hold once the requirement is met, stated so
that a reviewer can say met, not met or cannot tell by reading a change. Say what must be true, not how to
build it. No two points may say the same thing in different words: if the same lines of code would settle
both, make them one point. Do not include points about style, tests or documentation.

Reply with JSON only, in this shape:
{"points": [{"id": "R1", "text": "one sentence"}]}"""

ALTER_SYSTEM = """You rewrite a software requirement so that it asks for clearly different behaviour.
You are given a requirement and a code change that implements it.
Rewrite the requirement so that it is still plausible and specific, but the given change no longer satisfies it.
Change what is required, not the wording alone. Keep the same format and roughly the same length.
Reply with the rewritten requirement text only."""


class Planter:
    """Interface every planter implements."""

    name = "planter"

    def split_requirement(self, change: Change) -> List[RequirementPoint]:
        """Return the requirement as a short list of checkable points."""
        raise NotImplementedError

    def plant(
        self,
        change: Change,
        count: int,
        kinds: Sequence[str] = (KIND_BUG,),
        points: Optional[List[RequirementPoint]] = None,
        targets: Optional[Dict[str, List[dict]]] = None,
    ) -> List[Plant]:
        """Return up to `count` variants of `change`, one planted edit each."""
        raise NotImplementedError

    def alter_requirement(self, change: Change) -> str:
        """Return a requirement the change should no longer satisfy."""
        raise NotImplementedError


_FILLER = {"a", "an", "the", "is", "are", "be", "of", "to", "in", "on", "for", "and", "or", "that", "when", "with", "does", "not", "it", "its", "from", "as", "by", "must", "no", "any"}


def _words(text: str) -> set:
    return {word for word in re.findall(r"[a-z0-9]+", text.lower()) if word not in _FILLER}


def merge_similar(texts: Sequence[str], threshold: float = 0.6) -> List[str]:
    """Drop a point that mostly repeats an earlier one, judged by the words they share."""
    kept: List[str] = []
    for text in texts:
        if not text:
            continue
        words = _words(text)
        repeats = any(
            len(words & _words(other)) / max(1, len(words | _words(other))) >= threshold for other in kept
        )
        if not repeats:
            kept.append(text)
    return kept


def is_plantable(file_diff: FileDiff) -> bool:
    path = file_diff.path
    return (
        path.endswith(".cs")
        and not path.endswith(".g.cs")
        and not file_diff.is_deleted
        and bool(file_diff.added_ranges)
    )


def is_test_file(path: str) -> bool:
    lowered = path.lower()
    return "test" in lowered or lowered.startswith("sandbox/")


def candidate_files(change: Change) -> List[FileDiff]:
    """Source files worth planting in; test files only when nothing else changed."""
    plantable = [f for f in split_diff(change.diff) if is_plantable(f)]
    source = [f for f in plantable if not is_test_file(f.path)]
    return sorted(source or plantable, key=lambda f: -f.added_line_count)


def allocate(files: List[FileDiff], count: int) -> List[int]:
    """Share `count` plants across files in proportion to how many lines each added."""
    assigned = [0] * len(files)
    for _ in range(count):
        best = max(range(len(files)), key=lambda i: files[i].added_line_count / (assigned[i] + 1))
        assigned[best] += 1
    return assigned


def numbered_excerpt(text: str, ranges: List[Tuple[int, int]]) -> str:
    """The changed parts of a file with line numbers, '+' marking changed lines."""
    lines = text.split("\n")
    wanted = set()
    for start, end in ranges:
        for number in range(max(1, start - EXCERPT_CONTEXT_LINES), min(len(lines), end + EXCERPT_CONTEXT_LINES) + 1):
            wanted.add(number)
    changed = {n for start, end in ranges for n in range(start, end + 1)}
    out: List[str] = []
    previous = 0
    for number in sorted(wanted)[:EXCERPT_MAX_LINES]:
        if number != previous + 1:
            out.append("    ...")
        out.append("{:>5}{} {}".format(number, "+" if number in changed else " ", lines[number - 1]))
        previous = number
    return "\n".join(out)


def _normalise(block: str) -> List[str]:
    return [line.strip() for line in block.strip("\n").split("\n")]


def locate(lines: List[str], start: int, end: int, original: str) -> Optional[Tuple[int, int]]:
    """Confirm the model's line range against the text it quoted; fix it if the numbers are off."""
    wanted = _normalise(original)
    if not any(wanted):
        return None
    if 1 <= start <= end <= len(lines) and [l.strip() for l in lines[start - 1:end]] == wanted:
        return start, end
    stripped = [l.strip() for l in lines]
    matches = [i for i in range(len(stripped) - len(wanted) + 1) if stripped[i:i + len(wanted)] == wanted]
    if len(matches) == 1:
        return matches[0] + 1, matches[0] + len(wanted)
    return None


def code_only(block: List[str]) -> str:
    """A block with comments and all spacing removed, for comparing what the code does."""
    return "".join(re.sub(r"\s+", "", re.sub(r"//.*$", "", line)) for line in block)


def changes_code(old_block: List[str], new_block: List[str]) -> bool:
    return code_only(old_block) != code_only(new_block)


def apply_edit(
    path: str,
    head_text: str,
    added_ranges: List[Tuple[int, int]],
    proposal: Dict[str, Any],
) -> Optional[Tuple[str, int, int]]:
    """Apply one proposed edit. Returns (new text, first line, last line) or None if it is unusable."""
    lines = head_text.split("\n")
    start, end = as_int(proposal.get("line_start")), as_int(proposal.get("line_end"))
    original = proposal.get("original")
    replacement = proposal.get("replacement")
    if start is None or end is None or not isinstance(original, str) or not isinstance(replacement, str):
        return None
    located = locate(lines, start, end, original)
    if located is None:
        return None
    start, end = located
    if not overlaps_added(added_ranges, start, end, slack=2):
        return None
    new_block = replacement.strip("\n").split("\n") if replacement.strip() else []
    if [l.strip() for l in new_block] == [l.strip() for l in lines[start - 1:end]]:
        return None
    # A bug or omission has to change code. An edit that only touches comments or spacing changes nothing.
    if proposal.get("kind") != KIND_HARMLESS and not changes_code(lines[start - 1:end], new_block):
        return None
    new_lines = lines[:start - 1] + new_block + lines[end:]
    last = start + max(len(new_block), 1) - 1
    return "\n".join(new_lines), start, last


class ModelPlanter(Planter):
    """Asks a model to write the variants."""

    def __init__(
        self,
        client: ChatClient,
        repo: Path,
        name: Optional[str] = None,
        max_tokens: int = PLANT_REPLY_TOKENS,
    ) -> None:
        self.client = client
        self.repo = repo
        self.name = name or client.model
        self.max_tokens = max_tokens
        self._points: List[RequirementPoint] = []
        self._targets: Dict[str, List[dict]] = {}
        self.problems: List[str] = []   # why fewer variants came back than were asked for

    def split_requirement(self, change: Change) -> List[RequirementPoint]:
        # The checklist is written without sight of the change, so it cannot be shaped to fit it.
        user = "Requirement:\n{}".format(change.requirement_text.strip())
        reply = extract_json(
            self.client.complete(POINTS_SYSTEM, user, temperature=0.0, max_tokens=self.max_tokens).text,
            accept=lambda value: isinstance(value, dict) and isinstance(value.get("points"), list),
        )
        texts = [str(item.get("text") or "").strip() for item in reply["points"] if isinstance(item, dict)]
        return [RequirementPoint(id="R{}".format(n), text=text) for n, text in enumerate(merge_similar(texts)[:5], start=1)]

    def plant(
        self,
        change: Change,
        count: int,
        kinds: Sequence[str] = (KIND_BUG,),
        points: Optional[List[RequirementPoint]] = None,
        targets: Optional[Dict[str, List[dict]]] = None,
    ) -> List[Plant]:
        """Write the planted variants.

        `targets` maps a requirement point to the lines a reviewer cited as evidence for it.
        When given, every bug and omission is placed inside the cited lines of one point, so
        the test is: we broke the lines you pointed at, did you still say "met"?
        """
        self._points = points or []
        self._targets = targets or {}
        files = candidate_files(change)
        if self._targets:
            cited = [f for f in files if self._cited_in(f.path)]
            files = cited or files
        if not files:
            return []
        plants: List[Plant] = []
        kind_cycle = [kinds[i % len(kinds)] for i in range(count)]
        next_kind = 0
        for file_diff, share in zip(files, allocate(files, count)):
            if share == 0:
                continue
            wanted_kinds = kind_cycle[next_kind:next_kind + share]
            next_kind += share
            plants.extend(self._plant_in_file(change, file_diff, wanted_kinds, first_number=len(plants) + 1))
        return plants

    def _cited_in(self, path: str) -> Dict[str, List[Tuple[int, int]]]:
        """For one file: each point's cited line ranges."""
        cited: Dict[str, List[Tuple[int, int]]] = {}
        for point_id, refs in self._targets.items():
            ranges = [(ref["line_start"], ref["line_end"]) for ref in refs if same_file(ref["file"], path)]
            if ranges:
                cited[point_id] = ranges
        return cited

    def _plant_in_file(self, change: Change, file_diff: FileDiff, kinds: List[str], first_number: int) -> List[Plant]:
        head_text = file_at(self.repo, change.head_ref, file_diff.path)
        if head_text is None:
            return []
        base_text = file_at(self.repo, change.base_ref, file_diff.path)
        cited = self._cited_in(file_diff.path)
        counts = {kind: kinds.count(kind) for kind in (KIND_BUG, KIND_OMISSION, KIND_HARMLESS) if kind in kinds}
        request = ", ".join("{} of kind \"{}\"".format(n + SPARE_PROPOSALS, kind) for kind, n in counts.items())
        listed = "".join("\n{}: {}".format(point.id, point.text) for point in self._points)
        aim = ""
        if cited:
            aim = (
                "\nLines a reviewer cited as evidence, by requirement point:{}\n"
                "Every bug and omission must change code inside the cited lines of one point and name that point in "
                "\"breaks\". Aim at least one at each point listed here.\n".format(
                    "".join(
                        "\n{}: {}".format(point_id, ", ".join("{}-{}".format(a, b) for a, b in ranges))
                        for point_id, ranges in cited.items()
                    )
                )
            )
        shown_ranges = file_diff.added_ranges + [r for ranges in cited.values() for r in ranges]
        user = (
            "Requirement:\n{}\n{}{}\nFile: {}\n\n{}\n\nPropose {}.".format(
                change.requirement_text.strip(),
                "\nRequirement points:{}\n".format(listed) if listed else "",
                aim,
                file_diff.path,
                numbered_excerpt(head_text, shown_ranges),
                request,
            )
        )
        try:
            reply = extract_json(
                self.client.complete(PLANT_SYSTEM, user, temperature=0.7, max_tokens=self.max_tokens).text,
                accept=lambda value: (isinstance(value, dict) and isinstance(value.get("edits"), list))
                or (isinstance(value, list) and bool(value) and all(isinstance(item, dict) for item in value)),
            )
        except ModelError as error:
            self.problems.append("The planter failed on {}: {}".format(file_diff.path, error))
            return []
        proposals = reply.get("edits") if isinstance(reply, dict) else reply
        if not isinstance(proposals, list):
            self.problems.append("The planter's reply for {} was not a list of edits.".format(file_diff.path))
            return []

        known_points = {point.id for point in self._points}
        usable = []     # (kind, breaks, description, difficulty, new_text, start, end)
        seen_texts = set()
        unusable = 0
        for proposal in proposals:
            kind = proposal.get("kind") if isinstance(proposal, dict) else None
            if kind not in counts:
                unusable += kind is None
                continue
            applied = apply_edit(file_diff.path, head_text, file_diff.added_ranges, proposal)
            if applied is None:
                unusable += 1
                continue
            new_text, start, end = applied
            # Every variant is its own copy, so two edits may touch the same line.
            # Only an identical result is a duplicate.
            if new_text in seen_texts:
                unusable += 1
                continue
            breaks = None
            if kind != KIND_HARMLESS:
                breaks = proposal.get("breaks") if proposal.get("breaks") in known_points else None
                if cited:
                    # The edit must sit inside the cited lines of a point; that point is the one it breaks.
                    inside = [pid for pid, ranges in cited.items() if overlaps_added(ranges, start, end)]
                    if not inside:
                        unusable += 1
                        continue
                    breaks = breaks if breaks in inside else inside[0]
            seen_texts.add(new_text)
            usable.append((kind, breaks, proposal, new_text, start, end))

        # Cover every cited point once before giving any point a second edit, and
        # prefer a new place over a second break of lines that are already broken.
        chosen = []
        remaining = dict(counts)
        covered = set()

        def crowds(item) -> bool:
            harmless = item[0] == KIND_HARMLESS
            return any(
                (other[0] == KIND_HARMLESS) == harmless and item[4] <= other[5] and item[5] >= other[4]
                for other in chosen
            )

        for only_new_points, only_new_lines in ((True, True), (False, True), (False, False)):
            for item in usable:
                kind, breaks = item[0], item[1]
                if item in chosen or remaining.get(kind, 0) <= 0:
                    continue
                if only_new_points and (breaks is None or breaks in covered):
                    continue
                if only_new_lines and crowds(item):
                    continue
                chosen.append(item)
                remaining[kind] -= 1
                if breaks:
                    covered.add(breaks)

        plants: List[Plant] = []
        for kind, breaks, proposal, new_text, start, end in chosen:
            plants.append(
                Plant(
                    id="p{:02d}".format(first_number + len(plants)),
                    kind=kind,
                    description=str(proposal.get("description") or "").strip(),
                    file=file_diff.path,
                    line_start=start,
                    line_end=end,
                    patch=file_diff_text(file_diff.path, head_text, new_text),
                    difficulty=str(proposal.get("difficulty") or "medium"),
                    breaks=breaks,
                    variant_diff=replace_file_in_diff(
                        change.diff, file_diff.path, file_diff_text(file_diff.path, base_text, new_text)
                    ),
                )
            )
        if unusable:
            self.problems.append(
                "{} of {} edits proposed for {} were unusable: the quoted text was not in the file, the edit was "
                "outside the changed or cited lines, it changed nothing, or it repeated another.".format(
                    unusable, len(proposals), file_diff.path
                )
            )
        return plants

    def alter_requirement(self, change: Change) -> str:
        user = "Requirement:\n{}\n\nCode change (diff):\n{}".format(
            change.requirement_text.strip(), change.diff[:40000]
        )
        return self.client.complete(ALTER_SYSTEM, user, temperature=0.3, max_tokens=self.max_tokens).text.strip()
