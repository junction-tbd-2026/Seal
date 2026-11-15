# Two-minute video

The video is a web page: eight animated scenes, 1920 by 1080, exactly two
minutes, in the style of the pitch deck. It has no sound. The spoken text and
the voice are described in [SCRIPT.md](SCRIPT.md).

Open `index.html` in Chrome and press `Space`. No build step and no network
needed. The page uses the deck's fonts and logo from `../presentation/`, so
keep the two folders next to each other.

| Scene | Time | What it shows |
|---|---|---|
| 1 Hook | 0:00 | An AI writes, an AI says "looks good", and you have to sign |
| 2 Problem | 0:12 | "Looks good" gives you nothing to sign |
| 3 Proof | 0:18 | We broke the line the reviewer cited. It still said "met" |
| 4 Answer | 0:40 | seal: test the reviewer, then sign |
| 5 How | 0:48 | Cite, break, re-review, on the real run of pull request #1 |
| 6 Product | 1:09 | The real page: blind spot, verdict, sign-off, and the spot-check of the signer |
| 7 Evidence | 1:35 | Two reviewers told apart; trust as a track record |
| 8 Close | 1:50 | The three rules and the title |

## Keys

| Key | What it does |
|---|---|
| `Space` or a click | Play, pause |
| `←` `→` | One second back or forward (five with `Shift`) |
| `,` `.` | One frame back or forward |
| `1` to `8` | Jump to a scene |
| `R` | Start again from 0:00 and play |
| `C` | Show the spoken lines as subtitles, to read along while recording the voice |
| `F` | Fullscreen |

The bar at the bottom shows the time and the scene. It hides while the video
plays and the mouse is still. `index.html?t=69` opens at second 69.

## Get a video file

There are two ways. The first gives the cleaner result.

**Render it** (every frame drawn exactly, no dropped frames):

```bash
cd video
```

```bash
npm install
```

```bash
node tools/render.mjs
```

This writes `out/seal-video.mp4` (30 frames a second, no sound) and
`out/captions.vtt` (the spoken lines with their times). It takes a few
minutes. Then lay the voice recording over it in any video editor.

It needs Playwright's Chromium. If the script says the browser is missing,
run `npx playwright-core install chromium` once, or point it at a browser
you have: `CHROME=/path/to/chrome node tools/render.mjs`.

| Command | Result |
|---|---|
| `node tools/render.mjs --captions` | The same video with subtitles burnt in, for watching without sound |
| `node tools/render.mjs --fps 60` | Smoother motion, twice the time |
| `node tools/render.mjs --from 69 --to 95` | Only one part, to check a scene quickly |
| `node tools/render.mjs --stills 36,75.5` | Single pictures in `out/stills/` |

**Record the screen:** open `index.html?rec` (no bar, no mouse pointer), press
`F` for fullscreen, start your recorder, press `Space`. The video stops on
its last frame. To record the voice at the same time, open `index.html`
on a second screen with subtitles on (`C`) and read along.

## Change it

- **Text and timing** are in `index.html`, one `<section>` per scene.
  `data-start` is the second the scene starts. Inside a scene, `--at` is when
  an element comes in and `--out` when it leaves, in seconds from the start of
  that scene. To give a scene more time, raise the `data-start` of every scene
  after it and keep the last one ending at 120 (`data-total` on the stage).
- **The spoken lines** are the `<aside class="vo">` elements at the end of
  each scene, and in `SCRIPT.md`. Keep the two the same.
- **Looks** are in `video.css`. Colours and fonts are at the top and are the
  deck's.
- **Scene 6**, the product walkthrough, is put together in `scenes.js`: which
  screenshot shows when, where the camera looks, where the cursor clicks.
- **Numbers** in scenes 5 and 7 are copied by hand from `docs/results.md`.
  `SCRIPT.md` lists where each one comes from.

One rule when you add motion: use keyframe animations, never transitions, and
never start an animation by changing a class. The player sets the time of
every animation itself. That is what makes scrubbing and rendering exact.

## Take the product screenshots again

Scene 6 is made of screenshots of the running page, in `shots/`. Take them
again after the page or the results change. Start the page as the main README
says (backend with `SPOT_CHECK_RATE=1`, and the front end), then:

```bash
node tools/capture-shots.mjs
```

The script audits pull request #1 against the Nemotron review in a fresh
browser: first the spot-check copy, which it accepts on purpose to film the
message, then the real change. It signs with the name in `SIGNER`
(`SIGNER="Your Name" node tools/capture-shots.mjs`). Sign-offs are kept in
that browser only, so nothing changes for anyone else. It also writes
`shots/shots.js`, the positions of the buttons, which the video uses to aim
the camera and the cursor. Look at scene 6 afterwards: `index.html?t=69`.

## Files

| Path | What it holds |
|---|---|
| `index.html` | The eight scenes and the spoken lines |
| `video.css` | Looks and motion |
| `player.js` | The clock: play, pause, scrub, subtitles, and the hook the renderer uses |
| `scenes.js` | The edit of scene 6 |
| `shots/` | Product screenshots and `shots.js` |
| `tools/capture-shots.mjs` | Takes the screenshots |
| `tools/render.mjs` | Renders the MP4, stills and the subtitle file |
| `SCRIPT.md` | Spoken text, voice, and where real footage can go |
| `out/` | Rendered files. Not committed |
