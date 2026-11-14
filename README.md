# Seal

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

**Every claim points at evidence, and every approval is tested: the AI's and
the human's.**

An AI reviewer that says "looks good" gives a human nothing to sign. We do
not ask the human to trust the reviewer. We test the reviewer on the exact
change in front of it, show where it proved blind, and send the human to
those lines.

## What we built

A working prototype with two parts.

**1. A pipeline that tests an AI reviewer on one pull request.**

1. The requirement (the issue text) is split into three to five checkable
   points, written without sight of the code.
2. The AI reviewer judges each point on the real change: met, not met or
   cannot tell. It must cite the lines that show it. Citations are checked:
   lines that are not in the change, or more than 25 lines, do not count.
3. A second model breaks the very lines the reviewer cited, one break per
   copy of the change: bugs, removed code, and harmless rewrites.
4. The reviewer reviews every copy blind, in a fresh session, not knowing it
   is a test. If it still says "met" after we broke its own evidence, its
   "met" is worth nothing there.
5. Controls: the unchanged change is reviewed twice to rule out chance, and
   once with the requirement altered to see whether the reviewer reads it.

**2. A web page where the accountable person signs.**

- A landing page lists the pull requests in the middle of the screen. One
  that is ready opens as an audit of its AI review, in steps: first how the
  AI reviewer did on our test, then one step per review objective, then the
  sign-off. (A review objective is one of the checkable points the
  requirement, the issue, was split into.) A menu at the top switches
  between pull requests during an audit.
- The list has three parts. At the top, the pull requests the AI has
  checked and a person can audit, and below them any whose AI check is
  still running (a spinner; they cannot be opened yet). Then what needs
  follow-up: a rejected pull request goes back to the AI agent to be fixed
  and checked again, and one sent for a full human read links to GitHub. At
  the bottom, an archive of the accepted ones, with who signed and when.
- After the sign-off the page goes back to the list and the signed pull
  request moves to its part. A signed pull request cannot be opened again.
- Each objective step states three things in the side bar: what the AI
  reviewer claims, how that claim did on our test, and what the person must
  do. The panel shows the change file by file: the lines the AI reviewer
  cites as evidence and the blind spots open as cards, every other changed
  line folded to one row. One click shows the same lines in the full change.
- The person rules on one explicit question per objective: does the cited
  code prove that the change meets the objective? Where the AI reviewer
  missed a planted mistake, the person first judges the real code at that
  line ("looks right" or "looks wrong").
- The page shows one task at a time. The question of the step floats at
  the bottom (the Y and N keys answer it), and finishing a step opens the
  next one. Background detail stays folded until asked for. A step bar at
  the top shows every step and opens any of them. The pull requests are
  listed in the side bar and in a menu at the top.
- The checks are saved in the browser, so an audit can be paused and
  continued later. They are thrown away if the code shown changes.
- A sign-off with the person's name. Accept unlocks only when every
  objective, blind spot and reported problem is judged and nothing is marked
  wrong. The first step, the test of the AI reviewer, is a briefing, not a
  check: it counts as seen once the person moves on from it. Reject and full
  read are always open.
- A spot-check of the person: for a share of pull requests the code first
  shown is a copy with a planted bug. Accepting it is recorded and nothing
  is approved.

We run it on Tieto's four sample changes with two reviewers on identical
planted breaks: NVIDIA Nemotron and Google Gemini 4 Hydrogen (until Saturday
evening the second reviewer was Google Gemma 4 31B). A third model writes the
breaks, so no reviewer is graded on bugs in its own style.

An example from the first sample change: the reviewer cited one line as its
proof that a crash was fixed. We removed the fix on that line in a copy. It
still said "met".

More detail: [docs/concept-card.md](docs/concept-card.md) (the concept),
[docs/lessons-log.md](docs/lessons-log.md) (decisions and failures),
[docs/results.md](docs/results.md) (numbers).

## Status (Saturday 14 November, evening)

- The pipeline, the page and the tests work. The concept card and lessons
  log are up to date.
- **Results are partial.** The pipeline changed this morning, so the sample
  changes are being rerun, and the reruns were stopped before they finished.
  In `results/` now: pull requests #1 and #2 with both reviewers, and pull
  request #3 with Nemotron only. In these saved runs the second reviewer is
  still Gemma; reruns use Gemini and replace them. Missing: pull request #3
  with the second reviewer, and pull request #4, which shows as "AI check
  running" on the page.
- To finish them (needs keys, see below), run the pipeline for
  `ju26-issue-2129` and `ju26-issue-2297`, then regenerate the summary with
  `scripts/summarise_results.py` and commit `results/` and `docs/results.md`.
  Work that does not depend on other work now runs at the same time: both
  reviews of the real change, all reviewers, the planting requests and the
  altered requirement. When the planted copies are reused, every review of a
  reviewer goes out in one round. Use the settings listed in
  `keys.example.env`. Measured on pull request #1 with its 10 planted copies
  reused: the whole run took about 2 minutes (it took about 5.5 before the
  one-round change), Nemotron's part about 75 seconds. Planting new copies
  adds the planter's time on top.
- Not started: running the planted copies (Modal), the video, the public
  repository.

## Next steps

1. **Run the planted copies.** Build each copy and run the project's tests in
   the cloud (Modal). This proves a planted bug really breaks behaviour and a
   harmless edit really is harmless. It is the biggest gap in our evidence.
2. **Finish the reruns** on all four sample changes with the current version
   and regenerate the results summary.
3. **Start a check from the pull request.** Today a check is started from
   the command line. It should start on a server when a pull request opens
   and post its status back to it. Until then the page cannot tell a check
   that is running from one that never started: every pull request without
   results shows as "AI check running", and the list asks again every few
   seconds so it opens once results arrive.
4. **Keep a track record.** Pool results per reviewer, per code area and per
   kind of defect, so the amount of human review follows measured trust.
5. **Submission.** Product name, two-minute video, public repository, and
   the texts for the technology challenges (Nemotron, Gemini API, Modal).

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
   PYTHONPATH=src .venv/bin/python -m reviewer_controls.pipeline --change ju26-issue-2283 --plants 10 --kinds bug omission harmless
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
| `REVIEWER2_BASE_URL`, `REVIEWER2_MODEL`, `REVIEWER2_API_KEY` | Reviewer 2 (Google Gemini 4 Hydrogen), optional |
| `REVIEWER_MAX_TOKENS`, `REVIEWER_MAX_DIFF_CHARS`, `REVIEWER_WORKERS`, `REVIEWER_TIMEOUT_SECONDS` | Optional limits per reviewer, same for `REVIEWER2_`; `_WORKERS` is how many reviews run at once. The values we use are in `keys.example.env` |
| `PLANTER_WORKERS` | Optional: planting requests sent at once (default 3) |

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
| `src/reviewer_controls/server.py` | Web backend (FastAPI): serves saved runs, records sign-offs |
| `web/` | The page (React, TypeScript, Vite, Tailwind, Motion) |
| `requirements/` | The requirement each sample change claims to meet |
| `pull_requests.json` | The four sample pull requests the page lists |
| `results/` | Saved runs as plain JSON, read by the page |
| `docs/` | Concept card, lessons log, results summary |
| `scripts/setup.sh` | One-time setup for a new clone |
| `scripts/probe_models.py` | Checks the model endpoints answer; never prints keys |
| `scripts/probe_concurrency.py` | Measures how many requests at once a model service accepts, to set `_WORKERS` |
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
