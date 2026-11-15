# Voice-over with ElevenLabs (Eleven v4)

What to paste into ElevenLabs to get the voice for the two-minute video, using
the Eleven v4 model. The spoken text is the same as in [SCRIPT.md](SCRIPT.md).

Eleven v4 works differently from the older models:

- There are **no `<break>` tags**. Pauses come from the audio tags `[pause]`
  and `[long pause]`, from punctuation (`...`, `—`) and from line breaks.
- There is **no Speed or Style slider**. The pace comes from the voice and
  the text.
- The delivery is steered by **short instructions in square brackets**,
  placed before the words they affect.

Pauses on v4 are not exact. So generate **one clip per scene**, then line
the clips up in the video editor at the times given below. Where timing
matters to the frame, cut the clip at a pause and move the part.

## 1. The voice

**Use a voice from the Voice Library.** ElevenLabs says voices made with Voice
Design work on v4 but may sound less polished there than on earlier models.

Search the library for "calm narrator", "conversational" or "documentary".
Pick a voice that already sounds calm, warm and a little low when you preview
it. A tag can only bring out a delivery the voice already has. Avoid voices
tagged "advertisement", "trailer" or "energetic".

Preview each candidate with these lines, the ones the video turns on:

```
[Calm, warm narration, with a dry sense of humour]
We tried it on Tieto's own sample. The reviewer said the crash was fixed, and cited this line as proof.
So we made a copy, and broke exactly that line.
It still said... [pause] met.
```

The voice we are after: a man or woman in their early thirties. A thoughtful
software engineer explaining something surprising they found, to one person.
Relaxed, sure of themselves, understated. Not an announcer.

A clone of one of the team is the best option if you have one. Instant Voice
Clones are said to be more accurate on v4, and need about one or two minutes
of clean speech.

## 2. Settings

| Setting | Value | Why |
|---|---|---|
| Model | Eleven v4 | |
| Stability | 50 | The default. Lower if it sounds flat, but not below 35: it gets rushed and random |
| Similarity | 75 | |
| v4 Enhance | Do not use | It adds its own tags and capitals. The text below is already tagged |

Keep the same voice and settings for every clip. Generate two or three takes
of each scene and keep the best one. Do not change settings for a single clip.

**If "Tieto" comes out wrong.** It should sound like TEE-eh-toh. Eleven v4
reads IPA between slashes, so replace `Tieto's` in scene 3 with
`/ˈtiːɛtoʊz/`. "seal" is the animal and should come out right as written.

## 3. The text, one clip per scene

Each block starts with one direction in brackets. ElevenLabs suggests this
for steering the whole passage. It should not be spoken. If a take speaks it
aloud, generate again, or delete the first line and keep only the tags inside
the text.

Paste each block as it is.

### Scene 1 · place at 0:00.5 · must end by 0:12.8

```
[Calm, warm narration, unhurried]
Friday afternoon. An AI agent opens a pull request.
An AI reviewer reads it, and says: looks good to me.
Now it needs a signature. [pause] [dryly] Yours.
```

### Scene 2 · place at 0:12.8 · must end by 0:18.5

```
[Calm, matter-of-fact]
But "looks good" is an opinion. It gives you nothing to sign.
```

### Scene 3 · place at 0:18.5 · must end by 0:40.5

```
[Calm, like an engineer telling a colleague what they found]
We tried it on Tieto's own sample. The reviewer said the crash was fixed, and cited this line as proof.
So we made a copy, and broke exactly that line.
Same reviewer. Fresh session. No idea it is a test.
[dryly] It still said... [pause] met.
```

Line up "met" with the blue chip, at about 0:36.

### Scene 4 · place at 0:41.1 · must end by 0:48.5

```
[Calm, sure of itself]
An approval nobody tested is a rubber stamp.
So seal tests the reviewer first.
```

### Scene 5 · place at 0:48.5 · must end by 1:09.8

```
[Calm, clear explanation]
Seal splits the requirement into checkable points. For each one, the reviewer must cite the lines that prove it.
Then a different model breaks exactly those lines. One break per copy.
The reviewer judges every copy, blind.
Where it notices, its word counts. Where it misses, a human looks.
```

This is the tightest scene. See section 4 if it runs long.

### Scene 6 · place at 1:09.8 · must end by 1:35.4

```
[Calm, warm narration]
You do not read the whole diff. You land on the line where the reviewer proved blind, and judge it yourself.
Accept stays locked until every marked spot has your verdict.
Then you sign. With your name.
[long pause]
[dryly] People rubber-stamp too. So some sign-offs carry a planted bug. Approve it... and nothing is approved.
```

"People rubber-stamp too" should start at about 1:28, when the red message
appears. Cut the clip at the long pause and move the last part there.

### Scene 7 · place at 1:35.4 · must end by 1:51.0

```
[Calm, confident]
Does it tell reviewers apart? Both approved the same change. One caught six of six planted breaks. The other, two.
Every planted break is a labelled test. Trust becomes a track record, and review depth follows risk.
```

### Scene 8 · place at 1:51.0 · must end by 2:00.0

```
[Calm, warm, closing]
Every claim cites its evidence. Every reviewer is tested. Every signature, too.
[pause]
Seal. [pause] Test the reviewer. Then sign.
```

## 4. Fitting the clips to the picture

v4 has no Speed slider, so fix the length with the text and in the editor.

**If a clip is too long**, in this order:

1. Remove the `[pause]` and `[long pause]` tags in that clip, and replace
   `...` with a comma.
2. Generate a few more takes. The length differs from take to take; keep the
   shortest one that still sounds calm.
3. Cut words, as listed under "If you run long" in [SCRIPT.md](SCRIPT.md).
4. Speed the clip up by at most 5% in the video editor, with pitch kept.

**If a clip is too short**, leave the silence. The picture carries it.

**To place one sentence exactly** (for example "met" in scene 3, or the
spot-check line in scene 6), split the clip at a pause in the editor and move
the part. The start time of every line is in [SCRIPT.md](SCRIPT.md), and in
`out/captions.vtt` after a render.

If the tagged clips keep coming out uneven, generate each line on its own
instead, with the scene's direction tag at the top. Place every line at its
own start time. That takes longer, but the timing is exact.

## Sources

The v4 behaviour above is taken from ElevenLabs' own pages, checked on
15 November 2026:

- [How to add pauses in AI voiceover with Eleven v4](https://elevenlabs.io/blog/how-to-add-pauses-in-ai-voiceover)
- [Text to Speech product guide](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech)
- [Best practices, "Prompting Eleven v4"](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices)
- [Eleven v4 model page](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4)
- [Eleven v4 prompt guide (Morphic, third party)](https://morphic.com/resources/how-to/eleven-v4-guide)
