# Pitch deck

Nine slides for a three-minute pitch. No build step and no network needed:
open `index.html` in Chrome, press `F` for fullscreen and present.

## Keys

| Key | What it does |
|---|---|
| `→` or `Space` | Next build, then next slide |
| `←` | Back |
| `F` | Fullscreen |
| `N` | Speaker notes for the current slide, with its time budget |
| `T` | Three-minute countdown; it changes colour for the last 20 seconds |
| `P` | Print, to save as PDF |
| `?` | Show the keys |

A click on the right two thirds of the screen goes forward, on the left third
back. `index.html#6` opens the deck on slide 6.

## Save as PDF

```bash
bash presentation/export-pdf.sh
```

This writes `presentation/reviewer-controls-pitch.pdf`: one slide per page,
every build shown. It needs Chrome or Chromium. Without the script, open the
deck, press `P` and choose "Save as PDF".

## Change the content

- Text and speaker notes are in `index.html`, one `<section>` per slide.
- The numbers on slides 7 and 8 are copied by hand from `docs/results.md`.
  Update them after a rerun, and run the export again.
- The product screenshots in `img/` are taken from the running page at
  1200 by 780.
- Colours and type are at the top of `deck.css`. The fonts are the two the
  page uses, bundled in `fonts/` with their licences.

## The projector cut-off

The projector cuts off the top 15% and the bottom 20% of the picture, so every
slide keeps its content in the band between. Only the background fills the
rest. The band is set by `--cut-top` and `--cut-bottom` under `.stage` in
`deck.css`, in pixels of the 1080-pixel-high slide. The layout is tuned for the
current values; after changing them, look at every slide again.
