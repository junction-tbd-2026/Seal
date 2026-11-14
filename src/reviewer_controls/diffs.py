"""Reads unified diffs: which lines a change added, and how to show them with line numbers."""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

_FILE_HEADER = re.compile(r"^diff --git a/(.+?) b/(.+)$")
_HUNK_HEADER = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


@dataclass
class FileDiff:
    """The part of a diff that concerns one file."""

    path: str
    text: str
    added_ranges: List[Tuple[int, int]] = field(default_factory=list)  # new-file line numbers, inclusive
    is_new: bool = False
    is_deleted: bool = False

    @property
    def added_line_count(self) -> int:
        return sum(end - start + 1 for start, end in self.added_ranges)


def _added_ranges(section_lines: List[str]) -> List[Tuple[int, int]]:
    ranges: List[Tuple[int, int]] = []
    new_line = 0
    in_hunk = False
    for line in section_lines:
        header = _HUNK_HEADER.match(line)
        if header:
            new_line = int(header.group(3))
            in_hunk = True
            continue
        if not in_hunk:
            continue
        if line.startswith("+"):
            if ranges and ranges[-1][1] == new_line - 1:
                ranges[-1] = (ranges[-1][0], new_line)
            else:
                ranges.append((new_line, new_line))
            new_line += 1
        elif line.startswith("-") or line.startswith("\\"):
            continue
        else:
            new_line += 1
    return ranges


def split_diff(diff: str) -> List[FileDiff]:
    """Split a multi-file unified diff into one FileDiff per file."""
    files: List[FileDiff] = []
    current: Optional[List[str]] = None
    path = ""

    def close() -> None:
        if current is None:
            return
        files.append(
            FileDiff(
                path=path,
                text="\n".join(current) + "\n",
                added_ranges=_added_ranges(current),
                is_new=any(line.startswith("new file mode") for line in current[:6]),
                is_deleted=any(line.startswith("deleted file mode") for line in current[:6]),
            )
        )

    for line in diff.splitlines():
        header = _FILE_HEADER.match(line)
        if header:
            close()
            current = [line]
            path = header.group(2)
        elif current is not None:
            current.append(line)
    close()
    return files


def render_numbered(diff: str) -> str:
    """Show a diff with the new-file line number in front of every line.

    Reviewers cite line numbers far more reliably when the numbers are printed
    than when they have to count from hunk headers.
    """
    out: List[str] = []
    for file_diff in split_diff(diff):
        label = "new file" if file_diff.is_new else "deleted file" if file_diff.is_deleted else "modified"
        out.append("=== File: {} ({})".format(file_diff.path, label))
        new_line = 0
        in_hunk = False
        for line in file_diff.text.splitlines():
            header = _HUNK_HEADER.match(line)
            if header:
                new_line = int(header.group(3))
                in_hunk = True
                out.append("    ...")
                continue
            if not in_hunk or line.startswith("\\"):
                continue
            if line.startswith("-"):
                out.append("      - {}".format(line[1:]))
            elif line.startswith("+"):
                out.append("{:>5} + {}".format(new_line, line[1:]))
                new_line += 1
            else:
                out.append("{:>5}   {}".format(new_line, line[1:]))
                new_line += 1
        out.append("")
    return "\n".join(out)


def file_diff_text(path: str, base_text: Optional[str], new_text: str, context: int = 3) -> str:
    """Unified diff for one file from its base content (None if the file is new)."""
    old_lines = [] if base_text is None else base_text.splitlines()
    new_lines = new_text.splitlines()
    body = list(
        difflib.unified_diff(
            old_lines,
            new_lines,
            fromfile="/dev/null" if base_text is None else "a/" + path,
            tofile="b/" + path,
            lineterm="",
            n=context,
        )
    )
    header = ["diff --git a/{0} b/{0}".format(path)]
    if base_text is None:
        header.append("new file mode 100644")
    return "\n".join(header + body) + "\n"


def replace_file_in_diff(diff: str, path: str, new_file_diff: str) -> str:
    """Return `diff` with the section for `path` replaced by `new_file_diff`."""
    parts = []
    replaced = False
    for file_diff in split_diff(diff):
        if file_diff.path == path:
            parts.append(new_file_diff)
            replaced = True
        else:
            parts.append(file_diff.text)
    if not replaced:
        parts.append(new_file_diff)
    return "".join(parts)


def overlaps_added(ranges: List[Tuple[int, int]], start: int, end: int, slack: int = 0) -> bool:
    """True when lines start..end touch any added range, within `slack` lines."""
    return any(start <= r_end + slack and end >= r_start - slack for r_start, r_end in ranges)


def line_sets(diff: str) -> dict:
    """For each file in a diff: the new-file line numbers it shows, and the ones it adds."""
    result = {}
    for file_diff in split_diff(diff):
        shown, added = set(), set()
        new_line = 0
        in_hunk = False
        for line in file_diff.text.splitlines():
            header = _HUNK_HEADER.match(line)
            if header:
                new_line = int(header.group(3))
                in_hunk = True
                continue
            if not in_hunk or line.startswith("\\") or line.startswith("-"):
                continue
            shown.add(new_line)
            if line.startswith("+"):
                added.add(new_line)
            new_line += 1
        result[file_diff.path] = {"shown": shown, "added": added}
    return result


def same_file(a: str, b: str) -> bool:
    a, b = a.replace("\\", "/").lstrip("./"), b.replace("\\", "/").lstrip("./")
    return a == b or a.endswith("/" + b) or b.endswith("/" + a)
