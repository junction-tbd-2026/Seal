# Context: where the project stands

A briefing for a teammate picking this up. Written on Sunday 15 November 2026,
early morning. It sums up the repository and what was done in the last
sessions. For any detail, the files it points to are the source.

**Do not touch the model keys** without reading "Keys" below first. You do not
need them for anything except new pipeline runs.

## In one paragraph

We are doing Tieto's challenge "Earned Trust in AI Code" at Junction 2026. Our
product is called **seal**. Its idea: an AI reviewer that says "looks good"
gives the human who signs nothing to sign. So we **test the reviewer on the
exact change in front of it**: it must cite the lines that prove each point of
the requirement, a different model then breaks exactly those lines in copies
of the change, and the reviewer judges each copy blind. Where it did not
notice the break, its "met" is worth nothing, and those lines go to the human.
**The human who signs is tested too**: some sign-offs show a copy with a
planted bug. Slogan: **"Test the reviewer. Then sign."**

## The challenge

Tieto asks: *How can AI review the code made by AI so that humans can trust
it?* Every team gets a copy of the C# library MessagePack-CSharp and four
changes written by an AI agent, each claiming to fix one GitHub issue.

| Our name | Branch | Issue | Files |
|---|---|---|---|
| Pull request #1 | `ju26-issue-2283` | Crash on a closed generic struct from a referenced assembly | 4 |
| Pull request #2 | `ju26-issue-2234` | Analyzer does not run when SuppressSourceGeneration is true | 4 |
| Pull request #3 | `ju26-issue-2129` | Generate a formatter for a type in a referenced assembly | 28 |
| Pull request #4 | `ju26-issue-2297` | Add ExcludeFromCodeCoverage to generated code | 237 |

Source repository: `te-industry-tech-office/junction26-messagepack-csharp`.
Our copy, which the page links to: `timozo/junction26-messagepack-csharp`
(see `pull_requests.json`). The requirement texts are in `requirements/`.

What Tieto wants delivered: a concept card (recommendation, principles,
trade-offs, limits), a live walkthrough of where the trust comes from, a
lessons log, and a demo video or presentation. They weigh the concept above
the implementation. Out of scope: a finished product, model training, vendor
choice.

| Judged on | Weight |
|---|---|
| Clarity of the concept | 30 |
| Practicality in a real team | 25 |
| Measurement of trust | 25 |
| Evidence | 20 |

The partner's line to us: *"Convince us that we cannot go around your
solution."* The questions judges will ask: *What would make you not trust your
own output? Who owns the decision? How would this scale?*

Team: Niek Adams, Elin Lucia Dobrostal, Timo Gültzow, Stepan Konoplianko.
Timo holds the model keys.

## The concept

Full text: [docs/concept-card.md](docs/concept-card.md).

1. **Split the requirement** into three to five checkable points (we call
   them review objectives, O1 to O4 on the page). They are written from the
   requirement alone, without sight of the code.
2. **The AI reviewer judges each point** on the real change: met, not met or
   cannot tell, and must **cite the lines** that show it. Citations are
   checked: lines not in the change, or more than 25 lines, do not count. A
   point with nothing cited is "cannot tell".
3. **A planter model breaks the cited lines**, one break per copy: bugs,
   omissions (removed code) and harmless rewrites (to measure false alarms).
   Every point gets one break before any gets a second.
4. **The reviewer judges every copy blind**, in a fresh session, with the
   normal prompt, not told it is a test. A break counts as caught when the
   reviewer flags the spot or stops calling that point met.
5. **Controls:** the real change is reviewed twice (a point that changes
   answer by chance is not scored), and once with the requirement altered (if
   the verdict does not move, the reviewer was not reading the requirement).
6. **The result is not a score but a to-do list**: the lines where a planted
   defect went unseen. The named owner reads those, gives a verdict on each,
   and signs: accept, reject, or send for a full human read.
7. **The signer is spot-checked**: for a share of pull requests, the code
   first shown for sign-off is a planted copy. Accepting it is recorded and
   nothing is approved. This is an announced policy, like airports testing
   their X-ray screeners.
8. **Depth follows risk**: low-risk changes get 3 to 5 planted edits and the
   owner signs the card; ordinary code about 10 and the owner reads the marked
   lines; high-risk code about 30 and a full read. New dependencies, public
   interface changes and design questions always go to a human.
9. **Trust becomes a track record**: every planted edit is a labelled test,
   so catch rates and false-alarm rates build up per reviewer, per code area
   and per kind of defect. Trust is withdrawn after a real defect escapes.

Principles in short: trust comes from evidence about this change, not
confidence. A named human owns every decision. Measure both misses and false
alarms. Report ranges, never one number. Silence has to be earned. The
reviewer must not know it is tested. Refusing to decide is a valid answer. An
approval nobody tested is a rubber stamp.

## The story we tell (the "proof")

On pull request #1, Nemotron said the analyzer crash (objective O2) was fixed
and cited **`TypeCollector.cs` line 239** as its proof. We made a copy and
removed the fix on exactly that line. Same reviewer, fresh session, not told it
was a test: **it still said "met"**. This is the opening of the deck and the
video.

On pull request #1 Nemotron saw 10 planted copies: 4 bugs, 3 omissions,
3 harmless. It caught 4 of 7 defects and raised 1 false alarm. All three misses
were at line 239. Gemini caught 6 of 7, no false alarms; it missed one of the
line-239 bugs.

## Results

Generated by `scripts/summarise_results.py` into [docs/results.md](docs/results.md).
Planter: DeepSeek-V4.1-Flash. Reviewers: NVIDIA Nemotron 3.5 Super VL and
Google Gemini 4 Hydrogen (before Saturday evening the second reviewer was
Gemma 4 31B), on identical planted copies.

| Pull request | Gemini 4 Hydrogen | Nemotron 3.5 Super VL |
|---|---|---|
| #1 | 6 of 7 caught, 0 of 3 false alarms | 4 of 7 caught, 1 of 3 false alarms |
| #2 | 5 of 7 caught, 0 of 3 | nothing scored (said "does not meet") |
| #3 | 6 of 6 caught, 0 of 3 (said "meets requirement") | 2 of 6 caught, 0 of 3 (also said "meets requirement") |
| #4 | not tested yet | not tested yet |
| **Pooled** | **17 of 20, 64% to 95%** | **6 of 13, 23% to 71%** |

Ranges are 95% intervals. Ten caught out of ten supports "at least 74%",
thirty out of thirty "at least 90%". The headline for the evidence slide: on
#3 both reviewers said "meets the requirement", one caught 6 of 6 planted
breaks, the other 2.

## What is built

### 1. The pipeline (Python, `src/reviewer_controls/`)

| File | What it does |
|---|---|
| `pipeline.py` | Command-line entry point for a run |
| `controls.py` | The order of a run, and the scoring |
| `planter.py` | Splits the requirement, writes the planted breaks |
| `reviewer.py` | Calls the reviewer under test, checks its citations |
| `changes.py`, `diffs.py` | Load a change and read its diff |
| `llm.py` | Client for OpenAI-compatible endpoints (every model goes through one) |
| `config.py` | Loads keys from outside the project, never prints them |
| `matcher.py`, `stats.py` | Match findings to planted spots; ranges for small counts |
| `card.py` | Writes the sign-off card (`.card.md`) |
| `exam.py` | Shapes saved runs into what the page shows |
| `vigilance.py` | The spot-check of the signer |
| `server.py` | FastAPI backend: serves saved runs, checks sign-offs |

A run writes a report (`.json`), a card (`.card.md`) and the planted copies
(`__plants__*.json`) to `results/`. The page reads only those files; it never
calls a model. A run of #1 with its 10 planted copies reused takes about two
minutes.

### 2. The page (`web/`: React 19, TypeScript, Vite 6, Tailwind 4, Motion)

- A **board** with columns Pending, Ready for your audit, Full review
  required, Accepted. #4 shows as "Check running" (it has no results).
- An **audit** per pull request, in steps: Test (how the reviewer did on our
  test, with one square per planted copy), O1 to O4 (one per objective), Sign.
  A menu at the top switches the AI reviewer under audit (Gemini is the
  default; Nemotron tells the better story).
- Each objective step shows the cited code file by file. **Blind spots** (a
  planted defect the reviewer missed) open as red cards with the question "Is
  the real code at line 239 correct?" and "Looks right" / "Looks wrong". The
  floating question at the bottom ("Does the cited code prove that the change
  meets O2?") is answered with Y and N.
- **Accept stays locked** until every objective and blind spot has a verdict
  and none is "wrong". Reject and full read are always open.
- The sign-off takes a name. With a spot-check, accepting shows **"That was a
  spot-check. You just approved a planted bug."** with what was planted, then
  "Show me the real change".
- Progress, sign-offs and spot-check results are kept **in each visitor's
  browser** (localStorage), not on the server, so a whole audience can use
  one demo at once. Clearing site data starts over.

Colours on the page carry meaning: purple is the AI reviewer, red a blind
spot, green what held up in our test, amber a reported problem.

### Run it (no keys needed)

```bash
bash scripts/setup.sh
```

```bash
SPOT_CHECK_RATE=1 .venv/bin/uvicorn reviewer_controls.server:app --app-dir src --port 8000 --reload --reload-dir src
```

```bash
npm --prefix web run dev
```

Open http://localhost:5173. `SPOT_CHECK_RATE=1` makes the first sign-off on
every pull request a spot-check (default 0.5). Tests:
`PYTHONPATH=src .venv/bin/python -m unittest discover -s tests` and
`npm --prefix web run build`. CI is in `.github/workflows/ci.yml`.

The page asks for the Inter font and falls back to a system font. On a fresh
Linux browser it looks slightly different; that is fine.

## The pitch deck (`presentation/`)

Nine slides for a three-minute pitch, plain HTML, no build:
open `presentation/index.html`. Keys: arrows or Space, F fullscreen,
N speaker notes with time budget, T three-minute timer, P print.
`bash presentation/export-pdf.sh` writes `reviewer-controls-pitch.pdf`.

Slides: title, problem, proof (line 239), answer, how it works (cite, break,
re-review), the sign-off (product screenshots), evidence, measuring trust,
close. Speaker notes are in the HTML.

The projector cuts off the top 15% and bottom 20% of the picture, so all
content sits in the band between (`--cut-top`, `--cut-bottom` in `deck.css`).

**Style, shared by the deck and the video:** ink `#0b0b0c`, paper `#ffffff`,
one accent blue `#2b50ff` (lighter `#7088ff` on dark). Fonts: Bricolage
Grotesque for headings, JetBrains Mono for small labels, both bundled in
`presentation/fonts/`. Logo: `presentation/img/seal.svg` (a seal in a blue
rosette). Partner logos in `presentation/img/logos/`.

## The two-minute video (`video/`)

Committed in "Add pitching video." on branch `niek/video`.

- **The finished video with voice is `video/edits/video-with-sound.mp4`.**
  The voice clips per scene are `video/edits/audio 1.mp3` to `audio 8.mp3`.
- The picture is a web page: `video/index.html`, eight animated scenes,
  1920 by 1080, exactly 2:00, same style as the deck. Open it in Chrome and
  press Space. `C` shows the spoken lines as subtitles, `1` to `8` jump to a
  scene.
- `node tools/render.mjs` (in `video/`, after `npm install`) renders it frame
  by frame to `video/out/seal-video.mp4` without sound; `--captions` burns in
  subtitles. `out/` is not committed.
- Scene 6 is made of real screenshots of the page in `video/shots/`, taken
  by `node tools/capture-shots.mjs` with the page running. That script audits
  #1 against Nemotron in a throwaway browser, accepts the spot-check copy on
  purpose to film the message, then signs the real change as "Niek Adams"
  (change with `SIGNER=`).
- [video/SCRIPT.md](video/SCRIPT.md): spoken text with times, the voice,
  what to cut if long, where real footage could go, and the source of every
  number. [video/ELEVENLABS.md](video/ELEVENLABS.md): paste-ready input for
  ElevenLabs Eleven v4. [video/README.md](video/README.md): how to play,
  render and edit.

| Time | Scene |
|---|---|
| 0:00 | Hook: AI writes, AI says "looks good", you sign |
| 0:12 | Problem: a "LOOKS GOOD" rubber stamp |
| 0:18 | Proof: line 239 broken, still "met" |
| 0:40 | Answer: the logo, "Test the reviewer. Then sign." |
| 0:48 | How: cite, break, re-review on the real #1 run |
| 1:09 | Product: blind spot, locked sign-off, name, accepted, then the spot-check |
| 1:35 | Evidence: 6 of 6 against 2 of 6, ranges, risk tiers |
| 1:50 | Close: three rules, title, team, partner logos |

When adding motion to the video page: keyframe animations only, never CSS
transitions, never start an animation by changing a class. `player.js` sets
the time of every animation itself; that is what makes scrubbing and
rendering exact.

## Repository housekeeping

- Branch `niek/video`; `main` is the base for pull requests. The video is not
  merged into `main` yet.
- The last commit included Windows `:Zone.Identifier` files next to the
  audio and video in `video/edits/`. They are deleted in the working tree but
  the deletion is not committed yet.
- `video/edits/video-with-sound.mp4` is 64 MB, in git. Consider Git LFS or
  hosting it elsewhere before the repository goes public.
- `README.md` "Status" is from Saturday evening and is partly out of date: it
  says the second reviewer runs are Gemma and pending, but `results/` and
  `docs/results.md` now hold Gemini runs for #1 to #3, and the video now
  exists.
- `work/` (the local clone of the sample repository) and `results/debug/`
  are never committed.

## Keys: read before doing anything with models

The repository is, or will be, public. A leaked key ends our access to the
models.

- Keys live only in `~/.junction-keys.env`, outside the project.
  `keys.example.env` is an empty template and must stay empty. The code
  refuses a keys file inside a git repository.
- Get values from Timo, one to one, never in a group chat, issue, document or
  AI chat.
- `scripts/setup.sh` turns on commit hooks (`git config core.hooksPath` must
  print `.githooks`) that block keys. Never commit with `--no-verify`.
- If you think a key leaked anywhere, tell Timo at once so it can be revoked.

Settings names: `PLANTER_*`, `REVIEWER_*` (Nemotron), `REVIEWER2_*`
(Gemini), each `_BASE_URL`, `_MODEL`, `_API_KEY`, plus optional limits
(`_MAX_TOKENS`, `_MAX_DIFF_CHARS`, `_WORKERS`, `_TIMEOUT_SECONDS`). Values we
use are in `keys.example.env`.

A new run (needs keys and `work/junction26-messagepack-csharp` cloned):

```bash
PYTHONPATH=src .venv/bin/python -m reviewer_controls.pipeline --change ju26-issue-2283 --plants 10 --kinds bug omission harmless
```

Add `--dry-run` first to check the settings are seen. Then
`scripts/summarise_results.py` and commit `results/` and `docs/results.md`.

## What is not done

1. **Planted copies are not built or run.** Some planted bugs may change
   nothing, some "harmless" edits may not be harmless. Planned on Modal. This
   is the biggest gap in our evidence.
2. **Pull request #4 is not tested** (237 files).
3. **The check starts from the command line**, not from the pull request. So
   the page cannot tell a running check from one never started.
4. **No pooled track record** per code area yet; only per reviewer.
5. **Submission:** public repository, texts for the technology challenges
   (Nemotron, Gemini API, Modal).

## What we would not trust in our own output

Have these ready for "What would make you not trust your own output?"

- Whether a planted bug is a real bug: copies are not compiled or run.
- Any per-change percentage: three to twelve planted defects give wide ranges.
- Silence about design: a well-written change with the wrong design passes.
- Shared blind spots: if planter and reviewer cannot imagine a class of bug,
  it is never planted and never missed.
- Planted bugs are usually easier than real ones, so results lean optimistic.
- The requirement points are written by a model; a missing point goes
  unnoticed unless the owner reads the requirement.
- Spot-checking people only works as an agreed practice. Done covertly it
  costs more trust than it earns.

Answers to the other two: **who owns the decision?** The named person who
signs, always; the AI review is advice with evidence, never the approval.
**How would it scale?** Each planted copy is one more review (ten copies,
eleven reviews), so the number of copies follows risk, and the pooled
track record decides how much human reading a change needs.

## Where to read more

| File | What |
|---|---|
| [README.md](README.md) | Setup, keys rules, layout, known limits |
| [docs/concept-card.md](docs/concept-card.md) | The concept: recommendation, principles, what the owner signs, trade-offs, limits |
| [docs/lessons-log.md](docs/lessons-log.md) | 26 decisions and 9 failures, with what changed |
| [docs/results.md](docs/results.md) | Numbers per pull request and pooled |
| [presentation/README.md](presentation/README.md) | Presenting and exporting the deck |
| [video/README.md](video/README.md), [video/SCRIPT.md](video/SCRIPT.md) | The video |
