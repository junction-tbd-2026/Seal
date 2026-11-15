// Takes the product screenshots the video uses, from the running page.
// Usage: node tools/capture-shots.mjs            (page must be running on http://localhost:5173)
//        SIGNER="Your Name" APP=http://localhost:5173 node tools/capture-shots.mjs
//
// It walks pull request #1 as the accountable person, auditing the Nemotron review:
// first the spot-check copy (accepted on purpose, to film the reveal), then the real change.
// It writes shots/*.png and shots/shots.js, which lists where the buttons and blocks are in each
// screenshot. The video aims its camera, cursor and highlights with those positions, so nothing in
// the video is placed by hand. The browser profile is new every time: nothing is signed for anyone.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../shots");
const APP = process.env.APP || "http://localhost:5173";
const SIGNER = process.env.SIGNER || "Niek Adams";
// Both sizes are 16:10, so every screenshot fills the same browser frame in the video.
// The board needs the width; the audit reads better a little larger.
const BOARD_VIEW = { width: 1440, height: 900 };
const VIEW = { width: 1280, height: 800 };

fs.mkdirSync(outDir, { recursive: true });
for (const file of fs.readdirSync(outDir)) if (/\.(png|js)$/.test(file)) fs.unlinkSync(path.join(outDir, file));

// The page asks for Inter and falls back to a system font. A fresh Linux browser has neither,
// so Inter is handed to it here. The page itself is not touched.
const inter = fs.readFileSync(path.resolve(here, "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")).toString("base64");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, reducedMotion: "no-preference" });
await context.addInitScript((font) => {
  const add = () => {
    const style = document.createElement("style");
    style.textContent = `@font-face{font-family:"Inter Variable";src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:100 900;font-display:block}`;
    document.head.appendChild(style);
  };
  if (document.head) add();
  else document.addEventListener("DOMContentLoaded", add);
}, inter);
const page = await context.newPage();
page.setDefaultTimeout(10000);

const shots = {};
const settle = (ms = 1100) => page.waitForTimeout(ms);

/** Where an element is on the page, in CSS pixels: [x, y, width, height]. */
async function box(locator) {
  const b = await locator.first().boundingBox();
  if (!b) throw new Error(`No box for ${locator}`);
  return [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 10) / 10);
}

/** Saves the page as shots/<name>.png and remembers the named boxes in it. */
async function shot(name, boxes = {}) {
  await settle();
  const found = {};
  for (const [key, locator] of Object.entries(boxes)) found[key] = await box(locator);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  const view = page.viewportSize();
  shots[name] = { src: `shots/${name}.png`, view: [view.width, view.height], boxes: found };
  console.log(`shot ${name}`, Object.keys(found).join(" "));
}

const button = (name) => page.getByRole("button", { name });
const yes = async () => {
  await page.keyboard.press("y");
  await settle(900);
};

async function chooseNemotron() {
  await button("AI reviewer under audit").click();
  await page.getByRole("menu").getByText(/Nemotron/).first().click();
  await settle();
}

async function judgeBlindSpots() {
  const looksRight = button("Looks right");
  for (let i = await looksRight.count(); i > 0; i -= 1) {
    await looksRight.first().click();
    await settle(500);
  }
}

// ---- The board, before anything is signed ----
await page.setViewportSize(BOARD_VIEW);
await page.goto(APP, { waitUntil: "networkidle" });
const card1 = page.locator("div").filter({ hasText: "Crash on a closed generic struct" }).filter({ has: button("Start audit") }).filter({ hasNotText: "Analyzer does not run" }).first();
await shot("board", { start: button("Start audit"), card: card1, ready: page.getByText("Ready for your audit") });

// ---- Pass 1: the spot-check copy. Accepted without a second look, to film what happens. ----
await page.setViewportSize(VIEW);
await button("Start audit").first().click();
await settle();
await chooseNemotron();
await button("Start the audit").click();
await settle();
for (let step = 0; step < 4; step += 1) {
  await judgeBlindSpots();
  await yes();
}
await page.getByPlaceholder("Your name").fill(SIGNER);
await button("Accept the pull request").click();
const reveal = page.getByRole("dialog");
await reveal.waitFor();
await shot("spotcheck", {
  dialog: reveal.locator("> div"),
  verdict: reveal.locator("> div > div").first(),
  told: reveal.locator("p").filter({ hasText: SIGNER }),
  nothing: reveal.locator("p").filter({ hasText: "Nothing was approved." }),
});
await button("Show me the real change").click();
await settle();

// ---- Pass 2: the real change ----
await shot("test", { noticed: page.getByText(/Noticed .* planted mistakes/), brief: page.getByText("Audit brief") });

await button("Sign").click();
await shot("sign-locked", {
  open: page.locator("section").filter({ hasText: /steps are open/ }),
  decide: page.locator("section").filter({ has: page.getByPlaceholder("Your name") }),
});

await button("O2").first().click();
await settle();
const blind = page.locator("article").filter({ has: button("Looks right") }).first();
const row239 = blind.getByText("239", { exact: true }).first().locator("xpath=..");
await shot("o2", { blind, claim: page.getByText(/Claims O2 is met/), failed: page.getByText("Failed", { exact: true }) });

// Scroll the blind spot up, so its code and its question are both in view above the floating bar.
const scrollBlindTo = (top) =>
  blind.evaluate((element, wanted) => {
    let parent = element.parentElement;
    while (parent && !(parent.scrollHeight > parent.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(parent).overflowY))) parent = parent.parentElement;
    (parent ?? document.scrollingElement).scrollTop += element.getBoundingClientRect().top - wanted;
  }, top);
const blindParts = {
  blind,
  line: row239,
  looksRight: button("Looks right"),
  missed: blind.getByText(/planted a mistake here/),
  question: blind.getByText(/Is the real code at line 239 correct/),
  next: button(/Yes, next O3/),
};
await scrollBlindTo(122);
await shot("o2-blind", blindParts);
await button("Looks right").first().click();
await settle(700);
await scrollBlindTo(122);
await shot("o2-judged", blindParts);

// Finish every step, in order, until the sign-off opens with nothing left to do.
const nameBox = page.getByPlaceholder("Your name");
const ready = page.getByText(/Every step is done/);
await button("O1").first().click();
await settle();
for (let tries = 0; tries < 10 && !(await ready.isVisible()); tries += 1) {
  if (await nameBox.isVisible()) {
    // On the sign-off with a step still open: go to that step.
    await button(/Open the step/).first().click();
    await settle();
  }
  await judgeBlindSpots();
  await yes();
}
if (!(await ready.isVisible())) {
  await page.screenshot({ path: path.join(outDir, "_stuck.png") });
  throw new Error("The audit did not reach an unlocked sign-off. See shots/_stuck.png");
}
await nameBox.click();
const decide = page.locator("section").filter({ has: nameBox });
await shot("sign-ready", { name: nameBox, accept: button("Accept the pull request"), decide });

// The name being typed: one small picture of the field per letter, laid over the screenshot in the video.
const field = await box(nameBox);
const pad = 6;
const clip = { x: field[0] - pad, y: field[1] - pad, width: field[2] + 2 * pad, height: field[3] + 2 * pad };
const typed = [];
for (let i = 1; i <= SIGNER.length; i += 1) {
  await nameBox.pressSequentially(SIGNER[i - 1]);
  if (SIGNER[i - 1] === " ") continue;
  const file = `name-${String(i).padStart(2, "0")}.png`;
  await page.waitForTimeout(60);
  await page.screenshot({ path: path.join(outDir, file), clip });
  typed.push(`shots/${file}`);
}
shots["sign-ready"].typing = { box: [clip.x, clip.y, clip.width, clip.height], frames: typed };
await shot("sign-named", { name: nameBox, accept: button("Accept the pull request"), decide });

await button("Accept the pull request").click();
await page.getByText("Pull requests to audit").waitFor();
await page.setViewportSize(BOARD_VIEW);
await settle(1600);
const accepted = page.locator("div").filter({ hasText: "Crash on a closed generic struct" }).filter({ hasText: SIGNER }).last();
await shot("board-accepted", { card: accepted, column: page.getByText("Accepted", { exact: true }).first() });

await browser.close();

const data = { signer: SIGNER, shots };
fs.writeFileSync(
  path.join(outDir, "shots.js"),
  `// Written by tools/capture-shots.mjs. Do not edit by hand.\nwindow.SHOTS = ${JSON.stringify(data, null, 2)};\n`,
);
console.log(`Saved ${Object.keys(shots).length} screenshots to ${outDir}`);
