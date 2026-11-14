"""Spot-checks the human who signs.

The technique this project uses on AI reviewers was invented for people: airports slip
fake threats into X-ray images to check that screeners are really looking. Here, the
first time a pull request is opened for sign-off, the code shown may be a planted copy
with a defect at one of the spots the page tells the reader to check. Accepting it shows
the spot was not checked. Either way the real change is shown next, and only a sign-off
on the real change is recorded as an approval.

This is meant to run as an announced policy. The page says sign-offs are spot-checked.
"""

from __future__ import annotations

import json
import random
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set

from .exam import build_exam, record_signoff, structured_diff

LOG_FILE = "vigilance.jsonl"


def planted_copy(results_dir: Path, change_id: str, plant: Dict[str, Any]) -> Optional[str]:
    """The whole change with one planted edit applied, from the saved plants file of that run."""
    for path in sorted(results_dir.glob("*__plants__*.json"), reverse=True):
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if data.get("change_id") != change_id:
            continue
        for saved in data.get("plants", []):
            if saved.get("id") == plant["id"] and saved.get("description") == plant["description"] and saved.get("variant_diff"):
                return saved["variant_diff"]
    return None


def pick_spot_check(exam: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """A planted defect at a spot the page marks for the reader: one every reviewer missed, if there is one."""
    reviewers = exam["reviewers"]
    if not reviewers:
        return None
    missed_by_all = set(reviewers[0]["read_yourself"])
    for reviewer in reviewers[1:]:
        missed_by_all &= set(reviewer["read_yourself"])
    wanted = missed_by_all or set(reviewers[0]["read_yourself"])
    return next((plant for plant in exam["plants"] if plant["id"] in wanted), None)


class Vigilance:
    """Hands out review sessions and records how the human did on spot-checks."""

    def __init__(
        self,
        results_dir: Path,
        enabled: bool = True,
        rate: float = 1.0,
        rng: Callable[[], float] = random.random,
    ) -> None:
        self.results_dir = results_dir
        self.enabled = enabled
        self.rate = max(0.0, min(1.0, rate))   # share of pull requests whose first sign-off is a spot-check
        self._rng = rng
        self._chosen: Dict[str, bool] = {}     # whether each change was picked; fixed once decided
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._checked: Set[str] = set()    # changes whose spot-check has been signed since the server started

    def open(self, change_id: str) -> Optional[Dict[str, Any]]:
        """The change to show for sign-off. It carries a session token and never says which kind it is."""
        exam = build_exam(self.results_dir, change_id)
        if exam is None:
            return None
        token = uuid.uuid4().hex
        session: Dict[str, Any] = {"change_id": change_id, "plant": None, "started": time.time()}

        if self.enabled and change_id not in self._checked and self._picked(change_id):
            plant = pick_spot_check(exam)
            copy = planted_copy(self.results_dir, change_id, plant) if plant else None
            if plant and copy:
                # Stays a planted copy on every opening until someone signs it, so a
                # reload or a second request cannot use the spot-check up unseen.
                exam["change"]["files"] = structured_diff(copy)
                session["plant"] = plant

        self._sessions[token] = session
        exam["session"] = token
        return exam

    def _picked(self, change_id: str) -> bool:
        """Decide once per change, so a reload cannot reveal a spot-check by making it vanish."""
        if change_id not in self._chosen:
            self._chosen[change_id] = self._rng() < self.rate
        return self._chosen[change_id]

    def sign(self, token: str, reviewer: str, name: str, decision: str) -> Dict[str, Any]:
        session = self._sessions.pop(token, None)
        if session is None:
            raise KeyError("this review session has ended; reload the pull request")
        seconds = round(time.time() - session["started"], 1)
        plant = session["plant"]
        if plant is None:
            entry = record_signoff(self.results_dir, session["change_id"], reviewer, name, decision)
            return {"spot_check": False, "signoff": entry}

        name = name.strip()
        if not name:
            self._sessions[token] = session    # nothing was decided; keep the session
            raise ValueError("a sign-off needs a name")
        caught = decision != "accept"
        self._checked.add(session["change_id"])
        record = {
            "change_id": session["change_id"],
            "name": name[:120],
            "plant_id": plant["id"],
            "decision": decision,
            "caught": caught,
            "seconds": seconds,
            "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        self.results_dir.mkdir(parents=True, exist_ok=True)
        with (self.results_dir / LOG_FILE).open("a") as handle:
            handle.write(json.dumps(record) + "\n")
        return {
            "spot_check": True,
            "caught": caught,
            "seconds": seconds,
            "plant": {key: plant[key] for key in ("id", "kind", "description", "file", "line_start", "line_end", "patch")},
            "record": self.record(),
        }

    def record(self) -> Dict[str, Any]:
        """How people have done on spot-checks so far."""
        entries: List[Dict[str, Any]] = []
        path = self.results_dir / LOG_FILE
        if path.is_file():
            for line in path.read_text().splitlines():
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if isinstance(entry, dict) and "caught" in entry:
                    entries.append(entry)
        return {
            "enabled": self.enabled,
            "rate": self.rate,
            "checked": len(entries),
            "caught": sum(1 for entry in entries if entry["caught"]),
            "latest": entries[-3:],
        }

    def reset(self) -> None:
        """Forget which changes were spot-checked, so the next opening may be a planted copy again."""
        self._checked.clear()
        self._chosen.clear()
        self._sessions.clear()
