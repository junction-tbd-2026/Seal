"""Loads keys and settings without ever letting them near the repository.

Keys live in one file outside the project (default ~/.junction-keys.env) or in
environment variables. A keys file inside a git repository is refused, so a
key cannot be committed by accident. Values are never printed.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Mapping, Optional

KEYS_FILE_ENV = "JUNCTION_KEYS_FILE"
DEFAULT_KEYS_FILE = Path.home() / ".junction-keys.env"


class KeysFileInRepoError(RuntimeError):
    """The keys file sits inside a git repository."""


class MissingKeyError(RuntimeError):
    """A required key is not set."""


def inside_git_repo(path: Path) -> bool:
    """True when `path` or any parent folder contains a .git entry."""
    resolved = path.resolve()
    return any((parent / ".git").exists() for parent in [resolved, *resolved.parents])


def parse_keys_file(text: str) -> Dict[str, str]:
    values: Dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        value = value.strip().strip('"').strip("'")
        if name.strip() and value:
            values[name.strip()] = value
    return values


def load_settings(environ: Optional[Mapping[str, str]] = None) -> Dict[str, str]:
    """Settings from the keys file, overridden by environment variables."""
    env = os.environ if environ is None else environ
    keys_file = Path(env.get(KEYS_FILE_ENV) or DEFAULT_KEYS_FILE).expanduser()

    settings: Dict[str, str] = {}
    if keys_file.is_file():
        if inside_git_repo(keys_file):
            raise KeysFileInRepoError(
                "{} is inside a git repository. Move it outside the project "
                "(for example to {}) before running.".format(keys_file, DEFAULT_KEYS_FILE)
            )
        settings.update(parse_keys_file(keys_file.read_text()))

    for name in list(settings) + [n for n in env if n.startswith(("PLANTER_", "REVIEWER"))]:
        if env.get(name):
            settings[name] = env[name]
    return settings


def require(settings: Mapping[str, str], name: str) -> str:
    """Return a setting or fail with instructions. Never echoes a value."""
    value = settings.get(name)
    if not value:
        raise MissingKeyError(
            "{} is not set. Add it to {} (outside the project) or export it in your shell.".format(
                name, DEFAULT_KEYS_FILE
            )
        )
    return value


REVIEWER_PREFIXES = ("REVIEWER", "REVIEWER2", "REVIEWER3", "REVIEWER4")


def reviewer_prefixes(settings: Mapping[str, str]) -> list:
    """Which reviewers are configured. The first is always expected; the rest are optional."""
    return [p for p in REVIEWER_PREFIXES if p == "REVIEWER" or settings.get(p + "_MODEL")]


def status(settings: Mapping[str, str], name: str) -> str:
    """'set' or 'missing'. Use this in logs instead of the value."""
    return "set" if settings.get(name) else "missing"
