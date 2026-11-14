"""Web backend: serves saved runs to the page and records sign-offs.

    PYTHONPATH=src .venv/bin/uvicorn reviewer_controls.server:app --port 8000

It reads result files only. It never loads the keys file and never calls a model.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .exam import build_exam, list_changes, record_signoff

ROOT = Path(__file__).resolve().parents[2]
RESULTS_DIR = Path(os.environ.get("RESULTS_DIR") or ROOT / "results")
WEB_DIST = ROOT / "web" / "dist"

app = FastAPI(title="Reviewer Controls", docs_url="/api/docs", openapi_url="/api/openapi.json")


class SignOff(BaseModel):
    change_id: str
    reviewer: str
    name: str
    decision: str


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/changes")
def changes() -> list:
    return list_changes(RESULTS_DIR)


@app.get("/api/exam/{change_id}")
def exam(change_id: str) -> dict:
    result = build_exam(RESULTS_DIR, change_id)
    if result is None:
        raise HTTPException(status_code=404, detail="no saved run for {}".format(change_id))
    return result


@app.post("/api/signoff")
def signoff(body: SignOff) -> dict:
    if build_exam(RESULTS_DIR, body.change_id) is None:
        raise HTTPException(status_code=404, detail="no saved run for {}".format(body.change_id))
    try:
        return record_signoff(RESULTS_DIR, body.change_id, body.reviewer, body.name, body.decision)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))


# The built page, when it exists. While developing, Vite serves the page and proxies /api here.
if WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(WEB_DIST), html=True), name="web")
