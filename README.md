# Reviewer Controls (working title)

Junction 2026 · Tieto challenge **"Earned Trust in AI Code"**

> **Keys warning.** The model API keys for this project must never be
> committed, pasted or shown anywhere. They are not in this repository and
> must stay that way. Read ["Keys"](#keys-read-this-before-you-touch-anything)
> before you run anything that needs them. You do **not** need keys to run
> the page.

## The challenge

**Company:** Tieto. **Challenge:** Earned Trust in AI Code.

**Their question:** *How can AI review the code made by AI so that humans can
trust it?*

AI agents now write whole pull requests. Tieto gives every team the same
material: a copy of a real C# library (MessagePack-CSharp) and four changes
written by an AI agent, each claiming to solve one issue. The task is a
concept for how AI review and human sign-off should work together, with a way
to measure trust and evidence that it works. Tieto weights the concept above
the implementation.

| Judged on | Weight |
|---|---|
| Clarity of the concept | 30 |
| Practicality in a real team | 25 |
| Measurement of trust | 25 |
| Evidence | 20 |

## Our answer in one sentence

**Confidence is measured, not stated.** Don't ask the AI reviewer how sure it
is: test it on the change in front of it, and let a named person sign only
what the test could not prove.

Every pull request answers three questions, each with an owner:

1. **What does done mean?** A model drafts the objectives from the
   requirement; the owner of the requirement (for example the product owner)
   approves them: keeps or strikes each one, marks risky ones, adds missing
   ones.
2. **Can the AI be believed on this change?** The AI reviewer judges each
   objective and cites lines. We break those lines in copies, make harmless
   edits to the same lines, and see whether it can tell them apart. An
   objective is **Proven** when it took back "met" on every break (at least
   two) and never on a harmless edit there.
3. **What is left for a person?** Proven objectives need no reading.
   Everything else goes to the engineer, who signs a receipt.

## What we built

**1. A pipeline that tests an AI reviewer on one pull request** (`src/`).

1. Objectives: drafted from the requirement without sight of the code, or
   taken from the owner's approval.
2. The AI reviewer judges each objective on the real change, twice: met, not
   met or cannot tell, with cited lines. Citations outside the change or over
   25 lines do not count.
3. Paired planting (`--per-point 2`): per objective, two breaks and two
   harmless edits inside its cited lines, three each for risky objectives,
   plus two breaks in lines nobody cited.
4. The reviewer reviews every copy blind, in a fresh session. Scoring uses
   only its own answers. A finding counts when it points at the edit or names
   what the edit removed.
5. Controls: a repeat review of the unchanged change, and one with the
   requirement altered.

**2. A web page for the owner and the engineer** (`web/`).

- **What does done mean?** The owner approves the objectives with a name.
- **Can the AI be believed?** The reviewer's verdict, the breaks it noticed
  and the harmless edits it alarmed on, one word (sharp, jumpy, blind,
  mixed), and the other reviewer on the same copies.
- **What is left?** Proven objectives in one step that needs no reading;
  every other objective, blind spot and AI finding one at a time, with
  "met", "not met" or "can't tell: needs a run".
- **Sign the receipt:** proven, checked by you, nobody could decide, and
  what nothing checked. The server refuses an accept that skipped anything.
- **Trust ledger:** Tieto's four measures, from what reviewers and people
  did, with a labelled synthetic history of how trust is earned and lost.
- **Spot-check drill:** now and then the code shown is a planted copy; only
  finding the planted spot counts.
- Changes over 100 files go to a full human read by rule.

Two reviewers sit the same planted copies: NVIDIA Nemotron and Google Gemma.
A third model, DeepSeek, writes the edits.

What the data already shows: the same reviewer was sharp on pull request #3
(noticed 6 of 7 breaks, no false alarms) and jumpy on #1 (noticed 5 of 7 but
alarmed on 2 of 3 harmless edits). Gemma noticed 0 of 7 on #1 while saying
the change meets the requirement. A reviewer's trustworthiness changes from
one change to the next, so it has to be tested on each change.

More detail: [docs/concept-card.md](docs/concept-card.md),
[docs/lessons-log.md](docs/lessons-log.md), [docs/results.md](docs/results.md).

## Status (Saturday 14 November, evening)

- Pull request #1 is rerun with paired planting and the new scoring.
- **Pull requests #2 and #3 still have results from the older pipeline**
  (no harmless edits next to the breaks), so none of their objectives can be
  Proven yet. To rerun them with keys:
  `PYTHONPATH=src .venv/bin/python -m reviewer_controls.pipeline --change ju26-issue-2234 --points-from <its plants file> --per-point 2 --silence 2`
  and the same for `ju26-issue-2129`.
- Pull request #4 goes to a full human read by rule; it is not run.
- Not built: running the planted copies (Modal), repository context for the
  reviewer, starting a check from the pull request itself.

## Run the page (no keys needed)

The results of our runs are saved in `results/` and committed. The page reads
those files only. It never loads keys and never calls a model.

You need Python 3.9 or newer, Node 20 or newer, and git.

```bash
git clone <this repository's address> junction-2026-tieto
```

```bash
cd junction-2026-tieto
```

```bash
bash scripts/setup.sh
```

The setup script turns on the commit checks that block keys, creates the
Python environment, and installs the page's packages. It does not touch or
create any keys.

Then start the backend and the page in two terminals:

```bash
SPOT_CHECK_RATE=1 .venv/bin/uvicorn reviewer_controls.server:app --app-dir src --port 8000 --reload --reload-dir src
```

```bash
npm --prefix web run dev
```

Open http://localhost:5173.

`SPOT_CHECK_RATE=1` makes the first sign-off on every pull request a
spot-check, which is what you want for a demo. The default is 0.5.

Run the tests (no keys needed):

```bash
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests
```

```bash
npm --prefix web run build
```

## Run a new test of a reviewer (needs keys)

Only do this if you need new results. It calls paid model endpoints and takes
ten minutes or more per pull request.

1. Set up your keys file as described under "Keys" below.
2. Clone the sample repository into `work/` (the folder is never committed):

   ```bash
   git clone --filter=blob:none https://github.com/te-industry-tech-office/junction26-messagepack-csharp.git work/junction26-messagepack-csharp
   ```

3. Check that the settings are seen. This prints which settings are present,
   never their values:

   ```bash
   PYTHONPATH=src .venv/bin/python -m reviewer_controls.pipeline --change ju26-issue-2283 --dry-run
   ```

4. Run:

   ```bash
   PYTHONPATH=src .venv/bin/python -m reviewer_controls.pipeline --change ju26-issue-2283 --per-point 2 --silence 2
   ```

The run writes a report (`.json`), a sign-off card (`.card.md`) and the
planted copies to `results/`. The page shows the newest run of each change.
The four sample changes are `ju26-issue-2283`, `ju26-issue-2234`,
`ju26-issue-2129` and `ju26-issue-2297`.

Add `--debug` to save raw prompts and replies to `results/debug/` (never
committed).

## Keys: read this before you touch anything

**A leaked key ends our hackathon.** The keys were issued to the team for the
event. If one appears in a commit, a chat, a screenshot or the video, we lose
the models we depend on. This repository will be made public for submission,
and git history is permanent: a key committed once stays in the history even
after it is deleted.

**Most of you do not need the keys.** The page, the tests and all the
front-end work run without them. Only ask for keys if you must produce new
results.

The rules:

1. **Keys live in one file outside this folder:** `~/.junction-keys.env`.
   Never inside the project, not even for a minute. The code refuses to run
   with a keys file that sits inside a git repository.

   ```bash
   cp keys.example.env ~/.junction-keys.env
   ```

   ```bash
   chmod 600 ~/.junction-keys.env
   ```

   Then open `~/.junction-keys.env` in an editor and fill in the values.
   `keys.example.env` in this folder is a template and must stay empty.

2. **Get the values privately, from one person to one person.** Ask Timo.
   Use a direct message that can be deleted or a password manager. Never a
   group chat, an issue, a pull request, a document, an email thread or
   this repository.

3. **Keep the commit checks on.** `scripts/setup.sh` turns them on. They
   block a commit or a push that contains a keys file, a value from your
   keys file, or a string shaped like a key. Check that they are on:

   ```bash
   git config core.hooksPath
   ```

   It must print `.githooks`. Never commit or push with `--no-verify`.

4. **Never paste a key** into code, a notebook, a terminal command, a chat
   with an AI assistant, a screenshot, a log, a slide or the video. Do not
   screen-share with the keys file open.

5. **Never commit `results/debug/`, `.env` files or anything from `work/`.**
   They are ignored by git on purpose. Do not use `git add -f`.

6. **If you think a key was exposed anywhere, say so at once.** Tell Timo
   immediately, so the key can be revoked and replaced. Deleting the file or
   the message is not enough. Nobody will be blamed for reporting fast.

What the keys file holds (names only):

| Setting | What it is |
|---|---|
| `PLANTER_BASE_URL`, `PLANTER_MODEL`, `PLANTER_API_KEY` | The model that writes the planted breaks |
| `REVIEWER_BASE_URL`, `REVIEWER_MODEL`, `REVIEWER_API_KEY` | Reviewer 1 (NVIDIA Nemotron) |
| `REVIEWER2_BASE_URL`, `REVIEWER2_MODEL`, `REVIEWER2_API_KEY` | Reviewer 2 (Google Gemma), optional |
| `REVIEWER_MAX_TOKENS`, `REVIEWER_MAX_DIFF_CHARS`, `REVIEWER_WORKERS` | Optional limits per reviewer |

## Working together

- Pull before you start and commit small. Work on a branch and open a pull
  request into `main`, or agree in the team chat who is editing what.
- All code must be written at the event (Junction rule). Licence: MIT.
- The page is in `web/src/`. The pipeline is in `src/reviewer_controls/`.
  The concept, lessons and results are in `docs/`.

## Layout

| Path | What it holds |
|---|---|
| `src/reviewer_controls/pipeline.py` | Command-line entry point for a run |
| `src/reviewer_controls/controls.py` | The order of a run, and the scoring |
| `src/reviewer_controls/planter.py` | Splits the requirement, writes the planted breaks |
| `src/reviewer_controls/reviewer.py` | Calls the reviewer under test, checks its citations |
| `src/reviewer_controls/changes.py`, `diffs.py` | Load a change and read its diff |
| `src/reviewer_controls/llm.py` | Client for OpenAI-compatible model endpoints |
| `src/reviewer_controls/config.py` | Loads keys from outside the project; never prints them |
| `src/reviewer_controls/matcher.py`, `stats.py` | Matching findings to planted spots; honest ranges for small counts |
| `src/reviewer_controls/card.py` | Writes the sign-off card |
| `src/reviewer_controls/exam.py` | Shapes saved runs into what the page shows |
| `src/reviewer_controls/vigilance.py` | The spot-check of the person signing |
| `src/reviewer_controls/objectives.py` | The owner's approval of the objectives |
| `src/reviewer_controls/ledger.py` | The trust ledger's measures |
| `ledger_history.json` | The ledger's example history (synthetic, labelled as such) |
| `src/reviewer_controls/server.py` | Web backend (FastAPI): serves saved runs, records sign-offs |
| `web/` | The page (React, TypeScript, Vite, Tailwind, Motion) |
| `requirements/` | The requirement each sample change claims to meet |
| `pull_requests.json` | The four sample pull requests the page lists |
| `results/` | Saved runs as plain JSON, read by the page |
| `docs/` | Concept card, lessons log, results summary |
| `scripts/setup.sh` | One-time setup for a new clone |
| `scripts/probe_models.py` | Checks the model endpoints answer; never prints keys |
| `scripts/summarise_results.py` | Regenerates `docs/results.md` |
| `.githooks/` | Commit and push checks that block keys |
| `keys.example.env` | Template for the keys file (no real values) |
| `work/` | Local clone of the sample repository (not committed) |

## Known limits

- Planted copies are not yet built or run, so some planted bugs may change
  nothing and some "harmless" edits may not be harmless.
- Planted bugs are usually easier to catch than real ones, so results lean
  optimistic.
- A handful of planted breaks per change gives a wide range. Treat a
  per-change result as a gate, not a grade.
- Design-level mistakes are out of reach; those go to a human by rule.
