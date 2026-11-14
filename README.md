# Reviewer controls (working title)

Junction 2026, Tieto challenge "Earned Trust in AI Code".

An AI reviewer that says "looks good" gives a human nothing to sign. This
project tests the reviewer on every change: it plants known bugs in copies of
the change, checks which ones the reviewer catches, and gives the accountable
human a one-page card saying what was checked, what was missed, and which
lines to read personally.

## Status

Skeleton only. The interfaces and two tested helpers exist; the planter,
reviewer and runner are stubs.

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
| `src/reviewer_controls/planter.py` | Writes the planted variants (stub) |
| `src/reviewer_controls/reviewer.py` | Calls the reviewer under test (stub) |
| `src/reviewer_controls/runner.py` | Compiles and tests a variant (stub) |
| `src/reviewer_controls/matcher.py` | Decides whether a finding hit a planted location |
| `src/reviewer_controls/stats.py` | Honest bounds for small sample counts |
| `src/reviewer_controls/pipeline.py` | Command-line entry point |
| `src/reviewer_controls/config.py` | Loads keys from outside the project; never prints them |
| `.githooks/pre-commit` | Blocks commits that contain a key |
| `keys.example.env` | Template for the keys file (no real values) |
| `results/` | Run outputs as plain JSON, read later by the web page |
| `work/` | Local clone of the sample repository (not committed) |

## Run

No dependencies are needed yet.

```bash
PYTHONPATH=src python3 -m reviewer_controls.pipeline --help
```

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
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
