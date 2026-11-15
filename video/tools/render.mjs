// Renders the video page to an MP4, frame by frame. No screen recording, so no dropped frames.
//
//   node tools/render.mjs                     out/seal-video.mp4, 1920x1080, 30 frames a second, no sound
//   node tools/render.mjs --captions          the same with the spoken lines burnt in as subtitles
//   node tools/render.mjs --fps 60            smoother, twice the time
//   node tools/render.mjs --from 69 --to 95   only a part (seconds), to check a scene quickly
//   node tools/render.mjs --stills 5,12.5,40  PNG pictures of single moments, in out/stills/
//
// Every run also writes out/captions.vtt: the spoken lines with their times, for a video player.
// Needs the packages in this folder (npm install) and Playwright's Chromium
// (npx playwright-core install chromium). Set CHROME=/path/to/chrome to use another browser.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(root, "out");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const fps = Number(value("fps", 30));
const captions = flag("captions");
const stills = value("stills", null);
const workers = Number(value("workers", Math.max(2, Math.min(6, os.cpus().length - 1))));

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const url = `${pathToFileURL(path.join(root, "index.html")).href}?render${captions ? "&captions" : ""}`;

async function openPage() {
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("Page error:", error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__video, null, { timeout: 30000 });
  return page;
}
const frameAt = async (page, t) => {
  await page.evaluate((time) => window.__video.seek(time), t);
  return page.screenshot({ type: "png" });
};

const first = await openPage();
const info = await first.evaluate(() => ({ total: window.__video.total, cues: window.__video.cues, scenes: window.__video.scenes }));

// The spoken lines as a subtitle file.
const stamp = (t) => {
  const ms = Math.round(t * 1000);
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
};
fs.writeFileSync(
  path.join(outDir, "captions.vtt"),
  `WEBVTT\n\n${info.cues.map((cue, i) => `${i + 1}\n${stamp(cue.at)} --> ${stamp(cue.end)}\n${cue.text}\n`).join("\n")}`,
);

if (stills) {
  const dir = path.join(outDir, "stills");
  fs.mkdirSync(dir, { recursive: true });
  for (const text of stills.split(",")) {
    const t = Number(text);
    const file = path.join(dir, `${t.toFixed(2).padStart(6, "0")}.png`);
    fs.writeFileSync(file, await frameAt(first, t));
    console.log(file);
  }
  await browser.close();
  process.exit(0);
}

const from = Number(value("from", 0));
const to = Math.min(info.total, Number(value("to", info.total)));
const count = Math.round((to - from) * fps);
const partial = from > 0 || to < info.total;
const outFile = path.join(outDir, value("out", `seal-video${captions ? "-captions" : ""}${partial ? `-${from}-${to}` : ""}.mp4`));

const ffmpeg = spawn(
  ffmpegPath,
  [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
    "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "15",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-movflags", "+faststart",
    outFile,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);
const encoded = new Promise((resolve, reject) => {
  ffmpeg.on("error", reject);
  ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg stopped with code ${code}`))));
});

// Several pages draw frames at the same time; the frames go to the encoder in order.
const pages = [first, ...(await Promise.all(Array.from({ length: workers - 1 }, openPage)))];
const ready = new Map();
let nextToDraw = 0;
let nextToWrite = 0;
const started = Date.now();

async function flush() {
  while (ready.has(nextToWrite)) {
    const png = ready.get(nextToWrite);
    ready.delete(nextToWrite);
    nextToWrite += 1;
    if (!ffmpeg.stdin.write(png)) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
  }
}
let writing = Promise.resolve();
async function work(page) {
  while (nextToDraw < count) {
    const index = nextToDraw;
    nextToDraw += 1;
    // Do not run far ahead of the encoder: frames wait in memory until they are written.
    while (index - nextToWrite > workers * 4) await new Promise((resolve) => setTimeout(resolve, 5));
    ready.set(index, await frameAt(page, from + index / fps));
    writing = writing.then(flush);
    if (index % (fps * 5) === 0) {
      const done = index / count;
      const left = done > 0.02 ? Math.round(((Date.now() - started) / 1000 / done) * (1 - done)) : null;
      console.log(`${stamp(from + index / fps).slice(3, 8)}  ${Math.round(done * 100)}%${left === null ? "" : `  about ${left}s left`}`);
    }
  }
}
await Promise.all(pages.map(work));
await writing;
await flush();
ffmpeg.stdin.end();
await encoded;
await browser.close();
console.log(`Saved ${outFile} (${count} frames, ${Math.round((Date.now() - started) / 1000)}s)`);
