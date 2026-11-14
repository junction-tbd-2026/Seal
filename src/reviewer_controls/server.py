"""Web backend: serves saved runs to the page, records sign-offs and spot-checks the signer.

    .venv/bin/uvicorn reviewer_controls.server:app --app-dir src --port 8000

It reads result files only. It never loads the keys file and never calls a model.
"""

from __future__ import annotations

import os
from pathlib import Path

from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .exam import build_exam, list_changes, list_pulls
from .ledger import build_ledger
from .objectives import latest_approval, record_approval
from .vigilance import Vigilance

ROOT = Path(__file__).resolve().parents[2]
RESULTS_DIR = Path(os.environ.get("RESULTS_DIR") or ROOT / "results")
PULLS_FILE = Path(os.environ.get("PULLS_FILE") or ROOT / "pull_requests.json")
LEDGER_EXAMPLE = Path(os.environ.get("LEDGER_EXAMPLE") or ROOT / "ledger_history.json")
WEB_DIST = ROOT / "web" / "dist"

app = FastAPI(title="Reviewer Controls", docs_url="/api/docs", openapi_url="/api/openapi.json")
# SPOT_CHECK_RATE is the share of pull requests whose first sign-off is a spot-check. Set it to 1 for a demo.
vigilance = Vigilance(
    RESULTS_DIR,
    enabled=os.environ.get("SPOT_CHECKS", "on") != "off",
    rate=float(os.environ.get("SPOT_CHECK_RATE", "0.5")),
)


class Spot(BaseModel):
    plant_id: str
    verdict: str


class SignOff(BaseModel):
    session: str
    reviewer: str
    name: str
    decision: str
    spots: List[Spot] = []
    points: Dict[str, str] = {}
    findings: Dict[str, str] = {}


class Objective(BaseModel):
    id: str
    decision: str = "keep"
    risk: str = "normal"
    note: str = ""


class Added(BaseModel):
    text: str
    risk: str = "normal"


class Approval(BaseModel):
    name: str
    objectives: List[Objective] = []
    added: List[Added] = []


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/changes")
def changes() -> list:
    return list_changes(RESULTS_DIR)


@app.get("/api/pulls")
def pulls() -> dict:
    listed = list_pulls(PULLS_FILE, RESULTS_DIR)
    listed["spot_checks"] = vigilance.record()
    return listed


@app.get("/api/exam/{change_id}")
def exam(change_id: str) -> dict:
    """The saved results for a change. Not used for sign-off; planted text at marked spots stays hidden."""
    result = build_exam(RESULTS_DIR, change_id, hide_missed=True)
    if result is None:
        raise HTTPException(status_code=404, detail="no saved run for {}".format(change_id))
    return result


@app.get("/api/review/{change_id}")
def review(change_id: str) -> dict:
    """The change to show for sign-off, with a session token."""
    result = vigilance.open(change_id)
    if result is None:
        raise HTTPException(status_code=404, detail="no saved run for {}".format(change_id))
    return result


@app.get("/api/objectives/{change_id}")
def objectives(change_id: str) -> dict:
    """The objectives drafted from the requirement, and the owner's latest approval of them."""
    result = build_exam(RESULTS_DIR, change_id)
    if result is None:
        raise HTTPException(status_code=404, detail="no saved run for {}".format(change_id))
    return {"proposed": result["requirement_points"], "approval": latest_approval(RESULTS_DIR, change_id)}


@app.post("/api/objectives/{change_id}")
def approve_objectives(change_id: str, body: Approval) -> dict:
    result = build_exam(RESULTS_DIR, change_id)
    if result is None:
        raise HTTPException(status_code=404, detail="no saved run for {}".format(change_id))
    try:
        return record_approval(
            RESULTS_DIR, change_id, result["requirement_points"], body.name,
            [item.model_dump() for item in body.objectives], [item.model_dump() for item in body.added],
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))


@app.get("/api/ledger")
def ledger() -> dict:
    return build_ledger(RESULTS_DIR, PULLS_FILE, LEDGER_EXAMPLE, vigilance.record())


@app.post("/api/signoff")
def signoff(body: SignOff) -> dict:
    try:
        spots = [{"plant_id": spot.plant_id, "verdict": spot.verdict} for spot in body.spots]
        return vigilance.sign(body.session, body.reviewer, body.name, body.decision, spots, body.points, body.findings)
    except KeyError as error:
        raise HTTPException(status_code=409, detail=str(error.args[0]))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))


@app.post("/api/spot-checks/reset")
def reset_spot_checks() -> dict:
    """For demonstrations: let the next opening of each pull request be spot-checked again."""
    vigilance.reset()
    return vigilance.record()


# The built page, when it exists. While developing, Vite serves the page and proxies /api here.
if WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(WEB_DIST), html=True), name="web")
