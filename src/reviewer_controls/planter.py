"""Writes the planted variants of a change.

A planter must be a different model from the reviewer under test, so the
reviewer is not graded on bugs written in its own style.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .changes import file_at
from .diffs import FileDiff, file_diff_text, overlaps_added, replace_file_in_diff, split_diff
from .llm import ChatClient, ModelError, as_int, extract_json
from .models import KIND_BUG, KIND_HARMLESS, KIND_OMISSION, Change, Plant

EXCERPT_CONTEXT_LINES = 30
EXCERPT_MAX_LINES = 500
SPARE_PROPOSALS = 2

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

Reply with JSON only, in this shape:
{"edits": [{"kind": "bug", "difficulty": "easy|medium|hard", "description": "what is wrong and why it matters",
"line_start": 10, "line_end": 12, "original": "exact current text of those lines",
"replacement": "new text for those lines, or an empty string to delete them"}]}"""

ALTER_SYSTEM = """You rewrite a software requirement so that it asks for clearly different behaviour.
You are given a requirement and a code change that implements it.
Rewrite the requirement so that it is still plausible and specific, but the given change no longer satisfies it.
Change what is required, not the wording alone. Keep the same format and roughly the same length.
Reply with the rewritten requirement text only."""


class Planter:
    """Interface every planter implements."""

    name = "planter"

    def plant(self, change: Change, count: int, kinds: Sequence[str] = (KIND_BUG,)) -> List[Plant]:
        """Return up to `count` variants of `change`, one planted edit each."""
        raise NotImplementedError

    def alter_requirement(self, change: Change) -> str:
        """Return a requirement the change should no longer satisfy."""
        raise NotImplementedError


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
    new_lines = lines[:start - 1] + new_block + lines[end:]
    last = start + max(len(new_block), 1) - 1
    return "\n".join(new_lines), start, last


class ModelPlanter(Planter):
    """Asks a model to write the variants."""

    def __init__(self, client: ChatClient, repo: Path, name: Optional[str] = None) -> None:
        self.client = client
        self.repo = repo
        self.name = name or client.model

    def plant(self, change: Change, count: int, kinds: Sequence[str] = (KIND_BUG,)) -> List[Plant]:
        files = candidate_files(change)
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

    def _plant_in_file(self, change: Change, file_diff: FileDiff, kinds: List[str], first_number: int) -> List[Plant]:
        head_text = file_at(self.repo, change.head_ref, file_diff.path)
        if head_text is None:
            return []
        base_text = file_at(self.repo, change.base_ref, file_diff.path)
        counts = {kind: kinds.count(kind) for kind in (KIND_BUG, KIND_OMISSION, KIND_HARMLESS) if kind in kinds}
        request = ", ".join("{} of kind \"{}\"".format(n + SPARE_PROPOSALS, kind) for kind, n in counts.items())
        user = (
            "Requirement:\n{}\n\nFile: {}\n\n{}\n\nPropose {}.".format(
                change.requirement_text.strip(),
                file_diff.path,
                numbered_excerpt(head_text, file_diff.added_ranges),
                request,
            )
        )
        try:
            reply = extract_json(self.client.complete(PLANT_SYSTEM, user, temperature=0.7, max_tokens=6000).text)
        except ModelError:
            return []
        proposals = reply.get("edits") if isinstance(reply, dict) else reply
        if not isinstance(proposals, list):
            return []

        remaining = dict(counts)
        seen_texts = set()
        plants: List[Plant] = []
        for proposal in proposals:
            if not isinstance(proposal, dict):
                continue
            kind = proposal.get("kind")
            if remaining.get(kind, 0) <= 0:
                continue
            applied = apply_edit(file_diff.path, head_text, file_diff.added_ranges, proposal)
            if applied is None:
                continue
            new_text, start, end = applied
            # Every variant is its own copy, so two edits may touch the same line.
            # Only an identical result is a duplicate.
            if new_text in seen_texts:
                continue
            seen_texts.add(new_text)
            remaining[kind] -= 1
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
                    variant_diff=replace_file_in_diff(
                        change.diff, file_diff.path, file_diff_text(file_diff.path, base_text, new_text)
                    ),
                )
            )
        return plants

    def alter_requirement(self, change: Change) -> str:
        user = "Requirement:\n{}\n\nCode change (diff):\n{}".format(
            change.requirement_text.strip(), change.diff[:40000]
        )
        return self.client.complete(ALTER_SYSTEM, user, temperature=0.3, max_tokens=3000).text.strip()
