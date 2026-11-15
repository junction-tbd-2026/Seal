/* Video engine. The whole video is one page of CSS animations that never run by themselves:
   every animation is paused, and this file sets its time from one clock. So the video can be
   played, paused, scrubbed, and rendered frame by frame with the same result every time.

   A scene is a <section class="scene" data-start="seconds">. Delays inside a scene count from the
   start of that scene (set with --at, and --out for the exit). No transitions are used anywhere
   in the stage: only keyframe animations can be set to a time. No dependencies. */
(() => {
  const W = 1920;
  const H = 1080;
  const OVERLAP = 1; // seconds a scene stays in place underneath while the next one wipes over it
  const FRAME = 1 / 30;

  const params = new URLSearchParams(location.search);
  const root = document.documentElement;
  const stage = document.getElementById("stage");
  const TOTAL = Number(stage.dataset.total);
  const sceneEls = [...stage.querySelectorAll(".scene")];
  const scenes = sceneEls.map((el, i) => ({
    el,
    name: el.dataset.name || el.id,
    start: Number(el.dataset.start),
    end: i < sceneEls.length - 1 ? Number(sceneEls[i + 1].dataset.start) : TOTAL,
    anims: [],
    tickers: [],
    on: null,
  }));
  scenes.forEach((scene, i) => {
    scene.el.style.zIndex = String(i + 1);
    scene.until = i < scenes.length - 1 ? scene.end + OVERLAP : TOTAL + 1;
  });
  const sceneOf = (el) => scenes.find((scene) => scene.el.contains(el));

  // ---- Spoken lines. Each <aside class="vo" data-at="s"> is one line, timed from its scene's start. ----
  const cues = [];
  for (const scene of scenes) {
    for (const el of scene.el.querySelectorAll(".vo")) {
      cues.push({ at: scene.start + Number(el.dataset.at), text: el.textContent.replace(/\s+/g, " ").trim(), scene: scene.name });
    }
  }
  cues.sort((a, b) => a.at - b.at);
  cues.forEach((cue, i) => {
    const next = cues[i + 1];
    // A line stays up until the next one, but no longer than it takes to say it slowly.
    const spoken = 0.9 + cue.text.split(" ").length / 2.3;
    cue.end = Math.min(next ? next.at - 0.15 : TOTAL, cue.at + spoken + 1.2);
  });

  // ---- Things CSS cannot do: text that types itself, numbers that count. ----
  function setUpTickers() {
    for (const el of stage.querySelectorAll("[data-type]")) {
      const scene = sceneOf(el);
      const text = el.textContent;
      const at = Number(el.dataset.at || 0);
      const cps = Number(el.dataset.cps || 18);
      el.setAttribute("aria-label", text);
      let shown = -1;
      scene.tickers.push((t) => {
        const count = Math.max(0, Math.min(text.length, Math.floor((t - at) * cps)));
        if (count === shown) return;
        shown = count;
        el.textContent = text.slice(0, count);
        el.classList.toggle("typing", count > 0 && count < text.length);
        el.classList.toggle("typed", count === text.length);
      });
    }
    for (const el of stage.querySelectorAll("[data-count]")) {
      const scene = sceneOf(el);
      const from = Number(el.dataset.from || 0);
      const to = Number(el.dataset.count);
      const at = Number(el.dataset.at || 0);
      const dur = Number(el.dataset.dur || 0.8);
      let shown = null;
      scene.tickers.push((t) => {
        const p = Math.max(0, Math.min(1, (t - at) / dur));
        const value = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
        if (value === shown) return;
        shown = value;
        el.textContent = String(value);
      });
    }
  }

  // ---- The clock ----
  let now = 0;
  let playing = false;
  let playFrom = 0;
  let playAt = 0;
  let raf = 0;
  let showCaptions = params.has("captions");
  const captionEl = document.getElementById("caption");

  function render(t) {
    now = Math.max(0, Math.min(TOTAL, t));
    for (const scene of scenes) {
      const on = now >= scene.start && now < scene.until;
      if (on !== scene.on) {
        scene.on = on;
        scene.el.classList.toggle("on", on);
      }
      if (!on) continue;
      const local = (now - scene.start) * 1000;
      for (const anim of scene.anims) anim.currentTime = local;
      for (const tick of scene.tickers) tick(local / 1000);
    }
    const cue = showCaptions ? cues.find((item) => now >= item.at && now < item.end) : null;
    stage.classList.toggle("captions", showCaptions);
    if (captionEl) {
      const text = cue ? cue.text : "";
      if (captionEl.textContent !== text) captionEl.textContent = text;
      captionEl.hidden = !cue;
    }
    refreshHud();
  }

  function loop() {
    const t = playFrom + (performance.now() - playAt) / 1000;
    if (t >= TOTAL) {
      render(TOTAL);
      pause();
      return;
    }
    render(t);
    raf = requestAnimationFrame(loop);
  }
  function play() {
    if (playing) return;
    if (now >= TOTAL) now = 0;
    playing = true;
    playFrom = now;
    playAt = performance.now();
    root.classList.add("playing");
    raf = requestAnimationFrame(loop);
    refreshHud();
  }
  function pause() {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(raf);
    root.classList.remove("playing");
    refreshHud();
  }
  function seek(t) {
    if (playing) {
      playFrom = Math.max(0, Math.min(TOTAL, t));
      playAt = performance.now();
    }
    render(t);
  }

  // ---- Fit the 1920x1080 stage to the window ----
  function fit() {
    if (params.has("render")) return;
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    const x = (window.innerWidth - W * scale) / 2;
    const y = (window.innerHeight - H * scale) / 2;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  // ---- Controls: a bar under the picture, hidden while playing ----
  const hud = document.getElementById("hud");
  const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}.${Math.floor((t % 1) * 10)}`;
  let hudParts = null;
  function buildHud() {
    if (!hud || params.has("render") || params.has("rec")) {
      if (hud) hud.hidden = true;
      return;
    }
    hud.innerHTML =
      `<button type="button" class="hud-play" aria-label="Play or pause"></button>` +
      `<span class="hud-time"></span>` +
      `<div class="hud-track"><i class="hud-fill"></i>${scenes
        .map((scene) => `<b style="left:${(scene.start / TOTAL) * 100}%" title="${scene.name}"></b>`)
        .join("")}<input type="range" min="0" max="${TOTAL}" step="0.01" value="0" aria-label="Position"></div>` +
      `<span class="hud-scene"></span>` +
      `<span class="hud-keys">Space play · ←/→ 1s · , . frame · 1–${scenes.length} scene · C captions · F full · R restart</span>`;
    hudParts = {
      play: hud.querySelector(".hud-play"),
      time: hud.querySelector(".hud-time"),
      fill: hud.querySelector(".hud-fill"),
      range: hud.querySelector("input"),
      scene: hud.querySelector(".hud-scene"),
    };
    hudParts.play.addEventListener("click", () => (playing ? pause() : play()));
    hudParts.range.addEventListener("input", () => seek(Number(hudParts.range.value)));
  }
  function refreshHud() {
    if (!hudParts) return;
    hudParts.play.textContent = playing ? "❚❚" : "▶";
    hudParts.time.textContent = `${clock(now)} / ${clock(TOTAL)}`;
    hudParts.fill.style.width = `${(now / TOTAL) * 100}%`;
    if (document.activeElement !== hudParts.range) hudParts.range.value = String(now);
    const scene = [...scenes].reverse().find((item) => now >= item.start);
    hudParts.scene.textContent = scene ? scene.name : "";
  }
  let idle = 0;
  function wake() {
    root.classList.remove("idle");
    clearTimeout(idle);
    idle = setTimeout(() => root.classList.add("idle"), 1800);
  }

  function onKey(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    const jump = event.shiftKey ? 5 : 1;
    if (key === " " || key === "k") playing ? pause() : play();
    else if (key === "ArrowRight") seek(now + jump);
    else if (key === "ArrowLeft") seek(now - jump);
    else if (key === ".") { pause(); seek(now + FRAME); }
    else if (key === ",") { pause(); seek(now - FRAME); }
    else if (key === "Home" || key === "0") seek(0);
    else if (key === "End") seek(TOTAL);
    else if (key === "r" || key === "R") { pause(); render(0); play(); }
    else if (key === "c" || key === "C") { showCaptions = !showCaptions; render(now); }
    else if (key === "f" || key === "F") {
      if (document.fullscreenElement) document.exitFullscreen();
      else root.requestFullscreen?.();
    } else if (/^[1-9]$/.test(key) && scenes[Number(key) - 1]) seek(scenes[Number(key) - 1].start);
    else return;
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  // ---- Start ----
  async function start() {
    fit();
    await Promise.all([
      document.fonts.load('700 80px "Bricolage Grotesque"'),
      document.fonts.load('500 20px "JetBrains Mono"'),
    ]).catch(() => {});
    await document.fonts.ready;

    // Scenes built by script (the product walkthrough) add their elements and animations first.
    if (typeof window.buildScenes === "function") window.buildScenes({ overlap: OVERLAP });
    await Promise.all([...stage.querySelectorAll("img")].map((img) => img.decode().catch(() => {})));

    setUpTickers();
    for (const anim of document.getAnimations()) {
      const target = anim.effect && anim.effect.target;
      const scene = target && sceneOf(target);
      if (!scene) continue;
      anim.pause();
      scene.anims.push(anim);
    }

    buildHud();
    window.addEventListener("resize", fit);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", wake);
    stage.addEventListener("click", () => (playing ? pause() : play()));
    if (params.has("rec")) root.classList.add("rec");
    if (params.has("render")) root.classList.add("rendering");

    render(Number(params.get("t")) || 0);
    root.classList.add("ready");
    wake();
    if (params.has("autoplay")) play();

    // For tools/render.mjs: put the video at an exact time and wait until it is drawn.
    window.__video = {
      total: TOTAL,
      cues,
      scenes: scenes.map(({ name, start, end }) => ({ name, start, end })),
      seek: (t) =>
        new Promise((resolve) => {
          render(t);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
        }),
    };
  }
  start();
})();
