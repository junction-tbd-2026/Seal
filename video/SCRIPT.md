# Script for the two-minute video

The spoken text for `video/index.html`, with the time each line starts. The
same lines are in `index.html` (one `<aside class="vo">` per line), and the
page can show them as subtitles: press `C`. Change a line in both places.

To generate the voice with ElevenLabs, use [ELEVENLABS.md](ELEVENLABS.md):
the voice description, settings and paste-ready text per scene.

253 words in two minutes. That is a calm pace with room to breathe: about 100
seconds of speech and 20 seconds of silence.

## The voice

- **Who:** one of the team, not a hired announcer. The video says "we tried
  it" and "we broke that line", so it should sound like the person who did.
- **Tone:** calm, warm and sure of itself. An engineer explaining something
  they found, with a little dry humour. Not an advert, not a lecture.
- **Pitch and pace:** the lower half of your natural range, about 150 words a
  minute. Slower on the three short lines marked **slow** below. Never speed
  up to catch the picture: the picture waits for you (see "If you run long").
- **Smile on two lines:** "Yours." and "It still said: met." They are the two
  jokes. Say them flat and let the pause do the work.
- **Sentences end down.** No rising tone at the end of a statement.
- **Recording:** close to the microphone, in a room with soft furnishings.
  Record each scene as its own take. Leave one second of silence before and
  after each take.

How to say the names: "seal" like the animal. "Tieto" is TEE-eh-toh.
Numbers are read as words: "six of six", "two".

## Line by line

`[pause]` is a full second of silence. Lines in bold are the ones the video
is built around: give them space.

### 1 · Hook · 0:00 to 0:12

On screen: Friday, 16:42. An AI agent opens a pull request. An AI reviewer
types "Looks good to me." A signature line appears with a "Sign here" tab.

| Starts | Line |
|---|---|
| 0:00.5 | Friday afternoon. An AI agent opens a pull request. |
| 0:04.0 | An AI reviewer reads it, and says: looks good to me. |
| 0:08.9 | Now it needs a signature. `[pause]` **Yours.** (slow) |

### 2 · The problem · 0:12 to 0:18

On screen: a rubber stamp, "LOOKS GOOD, no evidence attached".

| Starts | Line |
|---|---|
| 0:12.8 | But "looks good" is an opinion. **It gives you nothing to sign.** |

### 3 · The proof · 0:18 to 0:40

On screen: the real code from Tieto's sample pull request #1. The reviewer's
proof, line 239, lights up. We strike the fix out and put a broken line in.
The reviewer thinks, then stamps "met" again.

| Starts | Line |
|---|---|
| 0:18.5 | We tried it on Tieto's own sample. The reviewer said the crash was fixed, and cited this line as proof. |
| 0:26.8 | So we made a copy, and broke exactly that line. |
| 0:31.4 | Same reviewer. Fresh session. No idea it is a test. |
| 0:35.7 | **It still said: `[half a beat]` met.** (slow) |

Say "met" as the blue chip lands, at 0:36. Then say nothing until 0:41.

### 4 · The answer · 0:40 to 0:48

On screen: the logo is stamped in. "Test the reviewer. Then sign."

| Starts | Line |
|---|---|
| 0:41.1 | An approval nobody tested is a rubber stamp. |
| 0:44.8 | So seal tests the reviewer first. |

### 5 · How it works · 0:48 to 1:09

On screen: the requirement splits into four points, each wired to the lines
that prove it. Ten copies of the change appear, one planted edit in each. The
reviewer passes over them: caught, missed, false alarm. The three misses stay
and become one line to check.

| Starts | Line |
|---|---|
| 0:48.5 | Seal splits the requirement into checkable points. For each one, the reviewer must cite the lines that prove it. |
| 0:56.3 | Then a different model breaks exactly those lines. One break per copy. |
| 1:01.6 | The reviewer judges every copy, blind. |
| 1:04.2 | Where it notices, its word counts. **Where it misses, a human looks.** |

### 6 · The product · 1:09 to 1:35

On screen: the real page. The board, then the audit of pull request #1 with
the blind spot at line 239, "Looks right", the locked sign-off, a name typed,
Accept, the board with the pull request under "Accepted". Then the twist:
"That was a spot-check. You just approved a planted bug."

| Starts | Line |
|---|---|
| 1:09.8 | You do not read the whole diff. You land on the line where the reviewer proved blind, and judge it yourself. |
| 1:18.9 | Accept stays locked until every marked spot has your verdict. |
| 1:23.2 | Then you sign. **With your name.** |
| 1:28.3 | People rubber-stamp too. So some sign-offs carry a planted bug. Approve it, `[half a beat]` and nothing is approved. |

Start the last line as the red spot-check message appears, at 1:28.

### 7 · Evidence and track record · 1:35 to 1:50

On screen: two reviewers, both "meets requirement", 6 of 6 against 2 of 6.
Then the pooled catch rates as ranges, and three risk tiers.

| Starts | Line |
|---|---|
| 1:35.4 | Does it tell reviewers apart? Both approved the same change. One caught six of six planted breaks. The other, two. |
| 1:43.6 | Every planted break is a labelled test. Trust becomes a track record, and review depth follows risk. |

### 8 · Close · 1:50 to 2:00

On screen: three checks, then the title and the seal.

| Starts | Line |
|---|---|
| 1:51.0 | Every claim cites its evidence. Every reviewer is tested. Every signature, too. |
| 1:56.0 | Seal. `[half a beat]` **Test the reviewer. Then sign.** (slow) |

## If you run long

The picture is fixed at two minutes, so cut words, not pauses. In this order:

1. Scene 7, second line: drop "Every planted break is a labelled test."
2. Scene 5, first line: say "For each one, the reviewer must cite its proof."
3. Scene 6, first line: drop "You do not read the whole diff."
4. Scene 1, second line: say "An AI reviewer says: looks good to me."

If one scene still does not fit, change the scene instead: every scene's
start time is one number in `index.html` (see the README).

## Where real footage can go

The video is complete without extra footage. These are the places where a
screen recording of the live page, or a shot of a person, can replace or
cover the animation without breaking the story:

| Time | Length | What is there now | What could go there |
|---|---|---|---|
| 1:09 to 1:35 | 26 s | Scene 6: screenshots of the page with a moving camera and cursor | A real screen recording of the same clicks: board, Start audit, step O2, "Looks right", sign-off, Accept, the spot-check message. Keep the four captions; they are in `index.html`. |
| 0:00 to 0:12 | 12 s | Scene 1: the three cards | A hand on a keyboard, a clock at 16:42, a pull request notification. |
| 1:35 to 1:43 | 8 s | Scene 7, first half: the dots | The "Test" step of the page for pull request #3, switching between the two reviewers. |

To leave a hole for footage, render the parts on either side:
`node tools/render.mjs --to 69` and `node tools/render.mjs --from 95`.

## What every number in the video rests on

All from the saved runs in `results/`, summarised in `docs/results.md`.

| In the video | Source |
|---|---|
| Line 239 broken, reviewer still says "met" (scene 3) | Pull request #1, Nemotron 3.5 Super VL, planted bug at `TypeCollector.cs:239` |
| 4 bugs, 3 omissions, 3 harmless rewrites; 4 of 7 caught, one false alarm; all three misses at line 239 (scene 5) | Pull request #1, Nemotron 3.5 Super VL: the outcome of each of its ten planted copies |
| "You accepted it after … seconds" (scene 6) | The capture script accepting the spot-check copy without looking. The number changes a little with every capture. |
| 6 of 6 against 2 of 6 (scene 7) | Pull request #3, both reviewers |
| 17 of 20 (64% to 95%) against 6 of 13 (23% to 71%) (scene 7) | Pooled over the three tested changes |

After a rerun of the pipeline, update scenes 5 and 7 in `index.html` by hand
and take the screenshots again.
