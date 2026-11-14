# Reviewer controls (working title)

Junction 2026, Tieto challenge "Earned Trust in AI Code".

An AI reviewer that says "looks good" gives a human nothing to sign. This
project tests the reviewer on every change: it plants known bugs in copies of
the change, checks which ones the reviewer catches, and gives the accountable
human a one-page card saying what was checked, what was missed, and which
lines to read personally.

## Status

The pipeline is written and tested end to end with a scripted stand-in for
the models. It has not yet been run against real models. The step that
compiles each planted variant is not built, so planted bugs are not yet
proven to be real defects.

## How it works

1. Take one agent-written change and its requirement.
2. Make copies of the change, each with one planted bug, omission, or harmless edit.
3. Review the original and every copy blind, each in a fresh session.
4. Match the reviewer's findings to the planted locations.
5. Rerun the review with the requirement altered; the verdict should change.
6. Write a sign-off card for the named human.

## Layout

| Path | What it holds |
|---|---|
| `src/reviewer_controls/models.py` | Data shapes shared by every step |
| `src/reviewer_controls/changes.py` | Loads a change and its requirement from the sample repository |
| `src/reviewer_controls/diffs.py` | Reads diffs and shows them with line numbers |
| `src/reviewer_controls/llm.py` | Client for OpenAI-compatible model endpoints |
| `src/reviewer_controls/planter.py` | Writes the planted variants and the altered requirement |
| `src/reviewer_controls/reviewer.py` | Calls the reviewer under test |
| `src/reviewer_controls/controls.py` | Runs the whole check and scores it |
| `src/reviewer_controls/card.py` | Writes the sign-off card |
| `src/reviewer_controls/runner.py` | Compiles and tests a variant (stub) |
| `requirements/` | The requirement each sample change claims to meet |
| `src/reviewer_controls/matcher.py` | Decides whether a finding hit a planted location |
| `src/reviewer_controls/stats.py` | Honest bounds for small sample counts |
| `src/reviewer_controls/pipeline.py` | Command-line entry point |
| `src/reviewer_controls/config.py` | Loads keys from outside the project; never prints them |
| `.githooks/pre-commit` | Blocks commits that contain a key |
| `keys.example.env` | Template for the keys file (no real values) |
| `src/reviewer_controls/exam.py` | Shapes saved runs into what the page shows |
| `src/reviewer_controls/server.py` | Web backend (FastAPI): serves saved runs, records sign-offs |
| `web/` | The page (React, TypeScript, Vite, Tailwind, Motion) |
| `results/` | Run outputs as plain JSON, read by the web page |
| `work/` | Local clone of the sample repository (not committed) |

## Set up

Python 3.9 or newer; no packages to install.

Clone the sample repository into `work/` (the folder is not committed):

```bash
git clone --filter=blob:none https://github.com/te-industry-tech-office/junction26-messagepack-csharp.git work/junction26-messagepack-csharp
```

Put your keys in `~/.junction-keys.env` (see "Keys" below), then check they are seen:

```bash
PYTHONPATH=src python3 -m reviewer_controls.pipeline --change ju26-issue-2283 --dry-run
```

## Run

```bash
PYTHONPATH=src python3 -m reviewer_controls.pipeline --change ju26-issue-2283 --plants 10 --kinds bug omission harmless
```

The run writes a report (`.json`) and a sign-off card (`.card.md`) to `results/`.

## The web page

Two installs, once:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
npm --prefix web install
```

Then start the backend and the page in two terminals and open http://localhost:5173:

```bash
.venv/bin/uvicorn reviewer_controls.server:app --app-dir src --port 8000
```

```bash
npm --prefix web run dev
```

The page shows the newest saved run of each change. The backend reads result
files only; it never loads the keys file and never calls a model.

Tests need no keys:

```bash
PYTHONPATH=src python3 -m unittest discover -s tests
```

## Keys: three rules

This repository is public. A leaked key ends the project.

1. **Keys live outside this folder.** Copy `keys.example.env` to
   `~/.junction-keys.env` and fill it in there. The code refuses a keys file
   that sits inside a git repository.
2. **Turn on the commit check once per clone.** It blocks any commit that
   contains a key from your keys file or a string shaped like one.

   ```bash
   git config core.hooksPath .githooks
   ```

3. **Never paste a key into code, a chat, a screenshot, a log or the pitch
   video.** If one is exposed anywhere, revoke it and create a new one.

## Rules we work under

- All code is written at the event and licensed MIT.

## Known limits

- Planted bugs are usually easier to catch than real ones, so results lean optimistic.
- Design-level mistakes are out of reach; those changes go to a human by rule.
- A small number of planted bugs gives a wide margin; see `stats.py`.
