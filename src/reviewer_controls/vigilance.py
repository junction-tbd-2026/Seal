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

from .diffs import same_file
from .exam import acceptance_problems, build_exam, clean_spots, record_signoff, structured_diff

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


def pick_spot_check(exam: Dict[str, Any], rng: Callable[[], float] = random.random) -> Optional[Dict[str, Any]]:
    """A planted defect at a spot the page marks for the reader: one every reviewer missed, if there is one.

    Picked at random among them, so the same spot is not the test every time.
    """
    reviewers = exam["reviewers"]
    if not reviewers:
        return None
    missed_by_all = set(reviewers[0]["read_yourself"])
    for reviewer in reviewers[1:]:
        missed_by_all &= set(reviewer["read_yourself"])
    wanted = missed_by_all or set(reviewers[0]["read_yourself"])
    candidates = [plant for plant in exam["plants"] if plant["id"] in wanted]
    if not candidates:
        return None
    return candidates[int(rng() * len(candidates)) % len(candidates)]


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
        self._spot: Dict[str, Optional[Dict[str, Any]]] = {}   # the planted edit chosen per change; fixed once chosen

    def open(self, change_id: str) -> Optional[Dict[str, Any]]:
        """The change to show for sign-off. It carries a session token and never says which kind it is."""
        full = build_exam(self.results_dir, change_id)
        if full is None:
            return None
        # The page never gets the text of a planted edit at a spot it asks the reader to judge.
        exam = build_exam(self.results_dir, change_id, hide_missed=True)
        token = uuid.uuid4().hex
        session: Dict[str, Any] = {"change_id": change_id, "plant": None, "started": time.time()}

        if self.enabled and change_id not in self._checked and self._picked(change_id):
            if change_id not in self._spot:
                self._spot[change_id] = pick_spot_check(full, self._rng)
            plant = self._spot[change_id]
            copy = planted_copy(self.results_dir, change_id, plant) if plant else None
            if plant and copy:
                # Stays a planted copy on every opening until someone signs it, so a
                # reload or a second request cannot use the spot-check up unseen.
                exam["change"]["files"] = structured_diff(copy)
                session["plant"] = plant
                # A reader may mark another planted edit that sits on the same lines; that is the same place.
                session["place"] = {
                    other["id"]
                    for other in exam.get("plants", [])
                    if same_file(other["file"], plant["file"])
                    and other["line_start"] <= plant["line_end"]
                    and other["line_end"] >= plant["line_start"]
                } | {plant["id"]}

        self._sessions[token] = session
        exam["session"] = token
        return exam

    def _picked(self, change_id: str) -> bool:
        """Decide once per change, so a reload cannot reveal a spot-check by making it vanish."""
        if change_id not in self._chosen:
            self._chosen[change_id] = self._rng() < self.rate
        return self._chosen[change_id]

    def sign(
        self,
        token: str,
        reviewer: str,
        name: str,
        decision: str,
        spots: Any = None,
        points: Any = None,
        findings: Any = None,
    ) -> Dict[str, Any]:
        session = self._sessions.pop(token, None)
        if session is None:
            raise KeyError("this review session has ended; reload the pull request")
        seconds = round(time.time() - session["started"], 1)
        plant = session["plant"]
        if plant is None:
            if decision == "accept":
                exam = build_exam(self.results_dir, session["change_id"])
                problems = acceptance_problems(exam, reviewer, spots, points, findings) if exam else ["no saved run"]
                if problems:
                    self._sessions[token] = session    # nothing was decided; keep the session
                    raise ValueError("cannot accept yet: " + "; ".join(problems))
            try:
                entry = record_signoff(
                    self.results_dir, session["change_id"], reviewer, name, decision, spots, points, findings, seconds
                )
            except ValueError:
                self._sessions[token] = session
                raise
            return {"spot_check": False, "signoff": entry}

        name = name.strip()
        if not name:
            self._sessions[token] = session    # nothing was decided; keep the session
            raise ValueError("a sign-off needs a name")
        refused = decision != "accept"
        # Caught means the person marked the planted spot itself as wrong. Refusing the whole
        # change without finding it, or asking for a full read every time, is not catching it.
        place = session.get("place") or {plant["id"]}
        spotted = any(s["plant_id"] in place and s["verdict"] == "wrong" for s in clean_spots(spots))
        caught = spotted
        self._checked.add(session["change_id"])
        self._spot.pop(session["change_id"], None)
        record = {
            "change_id": session["change_id"],
            "name": name[:120],
            "plant_id": plant["id"],
            "decision": decision,
            "refused": refused,
            "caught": caught,
            "spotted": spotted,
            "seconds": seconds,
            "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        self.results_dir.mkdir(parents=True, exist_ok=True)
        with (self.results_dir / LOG_FILE).open("a") as handle:
            handle.write(json.dumps(record) + "\n")
        return {
            "spot_check": True,
            "caught": caught,
            "refused": refused,
            "spotted": spotted,
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
        self._spot.clear()
        self._sessions.clear()
