"""Loads an agent-written change from the sample repository.

Each sample branch is one commit on top of its parent, so the change is the
diff between the branch tip and the commit before it.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import List, Optional

from .models import Change


class ChangeLoadError(RuntimeError):
    pass


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo)] + list(args),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True,
    )
    if result.returncode != 0:
        raise ChangeLoadError("git {} failed: {}".format(" ".join(args), result.stderr.strip()[:300]))
    return result.stdout


def resolve_ref(repo: Path, name: str) -> str:
    """Accept a local branch, a remote branch, or any commit-ish."""
    for candidate in ("origin/" + name, name):
        try:
            git(repo, "rev-parse", "--verify", "--quiet", candidate + "^{commit}")
            return candidate
        except ChangeLoadError:
            continue
    raise ChangeLoadError("'{}' is not a branch or commit in {}".format(name, repo))


def file_at(repo: Path, ref: str, path: str) -> Optional[str]:
    """Content of `path` at `ref`, or None when the file does not exist there."""
    try:
        return git(repo, "show", "{}:{}".format(ref, path))
    except ChangeLoadError:
        return None


def requirement_id_for(change_id: str) -> Optional[str]:
    match = re.search(r"issue-(\d+)", change_id)
    return match.group(1) if match else None


def load_requirement(requirements_dir: Path, requirement_id: str) -> str:
    path = requirements_dir / "{}.md".format(requirement_id)
    if not path.is_file():
        raise ChangeLoadError("no requirement file at {}".format(path))
    return path.read_text()


def load_change(
    repo: Path,
    change_id: str,
    requirements_dir: Path,
    requirement_id: Optional[str] = None,
    exclude: Optional[List[str]] = None,
) -> Change:
    """Build a Change from a branch of the sample repository."""
    if not (repo / ".git").exists():
        raise ChangeLoadError(
            "sample repository not found at {}. Clone it there first (see README).".format(repo)
        )
    head = resolve_ref(repo, change_id)
    base = head + "^"
    requirement_id = requirement_id or requirement_id_for(change_id)
    if not requirement_id:
        raise ChangeLoadError("cannot tell which requirement '{}' implements; pass --requirement".format(change_id))

    diff_args = ["diff", "--no-color", base, head]
    if exclude:
        diff_args += ["--", "."] + [":(exclude){}".format(pattern) for pattern in exclude]
    return Change(
        id=change_id,
        requirement_id=requirement_id,
        requirement_text=load_requirement(requirements_dir, requirement_id),
        base_ref=base,
        head_ref=head,
        diff=git(repo, *diff_args),
    )
