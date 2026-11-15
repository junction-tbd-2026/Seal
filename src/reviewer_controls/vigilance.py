"""Spot-checks the human who signs.

The technique this project uses on AI reviewers was invented for people: airports slip
fake threats into X-ray images to check that screeners are really looking. Here, the
first time a pull request is opened for sign-off, the code shown may be a planted copy
with a defect at one of the spots the page tells the reader to check. Accepting it shows
the spot was not checked. Either way the real change is shown next, and only a sign-off
on the real change is recorded as an approval.

This is meant to run as an announced policy. The page says sign-offs are spot-checked.

The server keeps nothing about people. Each browser keeps its own sign-offs and spot-check
record, and says with each request who it is (a random id it made up) and whether it has
already been spot-checked on that pull request. Many people can use one demo at once.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from .diffs import same_file
from .exam import build_exam, clean_spots, make_signoff, structured_diff

SESSION_SECONDS = 12 * 3600   # an opened review can be signed for this long
MAX_SESSIONS = 50_000         # beyond this the oldest open reviews are dropped


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
    """Hands out review sessions and judges spot-checks. Records nothing about the people signing."""

    def __init__(
        self,
        results_dir: Path,
        enabled: bool = True,
        rate: float = 1.0,
        secret: Optional[bytes] = None,
    ) -> None:
        self.results_dir = results_dir
        self.enabled = enabled
        self.rate = max(0.0, min(1.0, rate))   # share of pull requests whose first sign-off is a spot-check
        self._secret = secret or os.urandom(32)
        self._sessions: Dict[str, Dict[str, Any]] = {}   # open reviews, oldest first

    def open(self, change_id: str, visitor: str = "", checked: bool = False) -> Optional[Dict[str, Any]]:
        """The change to show for sign-off. It carries a session token and never says which kind it is.

        `visitor` is the browser's own random id, `checked` whether that browser has already
        signed this pull request's spot-check.
        """
        exam = build_exam(self.results_dir, change_id)
        if exam is None:
            return None
        token = uuid.uuid4().hex
        session: Dict[str, Any] = {"change_id": change_id, "plant": None, "started": time.time()}

        if self.enabled and not checked and self._picked(visitor, change_id):
            plant = pick_spot_check(exam)
            copy = planted_copy(self.results_dir, change_id, plant) if plant else None
            if plant and copy:
                # Stays a planted copy on every opening until this browser signs it, so a
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

        self._forget_old(session["started"])
        self._sessions[token] = session
        exam["session"] = token
        return exam

    def _picked(self, visitor: str, change_id: str) -> bool:
        """The same answer for one browser and one change on every opening, so a reload cannot
        reveal a spot-check by making it vanish. It differs between browsers, and without the
        server's secret the page cannot work it out."""
        if self.rate >= 1:
            return True
        if self.rate <= 0:
            return False
        message = "{}\0{}".format(visitor[:100], change_id).encode()
        digest = hmac.new(self._secret, message, hashlib.sha256).digest()
        return int.from_bytes(digest[:8], "big") / 2 ** 64 < self.rate

    def _forget_old(self, now: float) -> None:
        """Drop reviews opened too long ago, and the oldest ones when too many are open."""
        for token in list(self._sessions):
            if len(self._sessions) < MAX_SESSIONS and now - self._sessions[token]["started"] < SESSION_SECONDS:
                break
            del self._sessions[token]

    def sign(self, token: str, reviewer: str, name: str, decision: str, spots: Any = None) -> Dict[str, Any]:
        """Judge a decision. The result goes back to the browser that signed, which keeps it."""
        session = self._sessions.pop(token, None)
        if session is None:
            raise KeyError("this review session has ended; reload the pull request")
        seconds = round(time.time() - session["started"], 1)
        plant = session["plant"]
        if plant is None:
            try:
                entry = make_signoff(session["change_id"], reviewer, name, decision, spots)
            except ValueError:
                self._sessions[token] = session    # nothing was decided; keep the session
                raise
            return {"spot_check": False, "signoff": entry}

        name = name.strip()
        if not name:
            self._sessions[token] = session    # nothing was decided; keep the session
            raise ValueError("a sign-off needs a name")
        caught = decision != "accept"
        # Better than refusing the copy: did they mark the planted spot itself as wrong?
        place = session.get("place") or {plant["id"]}
        spotted = any(s["plant_id"] in place and s["verdict"] == "wrong" for s in clean_spots(spots))
        return {
            "spot_check": True,
            "change_id": session["change_id"],
            "caught": caught,
            "spotted": spotted,
            "seconds": seconds,
            "decided_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "plant": {key: plant[key] for key in ("id", "kind", "description", "file", "line_start", "line_end", "patch")},
        }
