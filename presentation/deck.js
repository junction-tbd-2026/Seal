/* Deck engine: fixed 1920x1080 stage scaled to the window, step-by-step builds,
   speaker notes, a pitch timer, and a print mode that lays every slide out in
   its final state so the browser can save it as a PDF. No dependencies. */
(() => {
  const W = 1920;
  const H = 1080;
  const PITCH_SECONDS = 180;

  const root = document.documentElement;
  const stage = document.getElementById("stage");
  const slides = [...stage.querySelectorAll(".slide")];
  const bar = document.getElementById("bar");
  const timerEl = document.getElementById("timer");
  const notesEl = document.getElementById("notes");
  const helpEl = document.getElementById("help");

  const pad = (n) => String(n).padStart(2, "0");

  // How many builds each slide has: the highest data-step inside it.
  const stepsOf = slides.map((slide) =>
    Math.max(0, ...[...slide.querySelectorAll("[data-step]")].map((el) => Number(el.dataset.step))),
  );
  slides.forEach((slide, i) => {
    const foot = document.createElement("footer");
    foot.className = "foot";
    foot.innerHTML =
      `<span class="wm"><svg><use href="#i-mark"/></svg>Reviewer Controls</span>` +
      `<span class="pg">${pad(i + 1)} / ${pad(slides.length)}</span>`;
    slide.querySelector(".safe").appendChild(foot);
  });

  let current = 0;
  let step = 0;
  let cleanup = 0;

  /** Show the builds of one slide up to and including `upTo`. */
  function applySteps(slide, index, upTo) {
    for (let k = 1; k <= stepsOf[index]; k += 1) slide.classList.toggle(`s${k}`, upTo >= k);
    slide.querySelectorAll("[data-step]").forEach((el) => {
      el.classList.toggle("on", Number(el.dataset.step) <= upTo);
    });
  }

  function fit() {
    if (root.classList.contains("print")) return;
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    const x = (window.innerWidth - W * scale) / 2;
    const y = (window.innerHeight - H * scale) / 2;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }

  function refreshChrome() {
    const done = slides.length > 1 ? current / (slides.length - 1) : 1;
    stage.dataset.theme = ["light", "blue"].find((theme) => slides[current].classList.contains(theme)) ?? "dark";
    bar.style.transform = `scaleX(${done})`;
    if (!notesEl.hidden) {
      const note = slides[current].querySelector(".notes");
      const time = note?.dataset.time ? `<b>${note.dataset.time}</b>` : "";
      const builds = stepsOf[current] ? `<i>build ${step} of ${stepsOf[current]}</i>` : "";
      notesEl.innerHTML = `<header>${pad(current + 1)} ${time} ${builds}</header><p>${note ? note.innerHTML : ""}</p>`;
    }
    const hash = `#${current + 1}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  function go(index, atStep, direction) {
    index = Math.max(0, Math.min(slides.length - 1, index));
    const from = slides[current];
    const to = slides[index];
    clearTimeout(cleanup);
    slides.forEach((slide) => {
      if (slide !== from && slide !== to) slide.classList.remove("shown", "live", "under", "enter-fwd", "enter-back");
    });
    if (from !== to) {
      // The old slide stays in place underneath while the new one wipes over it.
      from.classList.remove("enter-fwd", "enter-back");
      from.classList.add("under");
      to.classList.remove("under", "live");
      applySteps(to, index, atStep);
      void to.offsetWidth; // restart the entrance from its first frame
      to.classList.add("shown", "live", direction < 0 ? "enter-back" : "enter-fwd");
      cleanup = setTimeout(() => {
        from.classList.remove("shown", "live", "under");
        applySteps(from, slides.indexOf(from), 0);
      }, 800);
    } else {
      to.classList.add("shown", "live");
      applySteps(to, index, atStep);
    }
    current = index;
    step = atStep;
    refreshChrome();
  }

  function next() {
    if (step < stepsOf[current]) {
      step += 1;
      applySteps(slides[current], current, step);
      refreshChrome();
    } else if (current < slides.length - 1) {
      go(current + 1, 0, 1);
    }
  }

  function prev() {
    if (step > 0) {
      step -= 1;
      applySteps(slides[current], current, step);
      refreshChrome();
    } else if (current > 0) {
      go(current - 1, stepsOf[current - 1], -1);
    }
  }

  // Timer: counts down the pitch; the last 20 seconds are marked.
  let timerId = 0;
  let endsAt = 0;
  function tick() {
    const left = Math.round((endsAt - Date.now()) / 1000);
    const shown = Math.abs(left);
    timerEl.textContent = `${left < 0 ? "+" : ""}${Math.floor(shown / 60)}:${pad(shown % 60)}`;
    timerEl.classList.toggle("ending", left <= 20);
  }
  function toggleTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = 0;
      timerEl.hidden = true;
      return;
    }
    endsAt = Date.now() + PITCH_SECONDS * 1000;
    timerEl.hidden = false;
    tick();
    timerId = setInterval(tick, 250);
  }

  // Print: every slide on its own page, every build shown.
  function enterPrint() {
    root.classList.add("print", "ready");
    stage.style.transform = "";
    slides.forEach((slide, i) => {
      slide.classList.remove("under", "enter-fwd", "enter-back");
      slide.classList.add("shown", "live");
      applySteps(slide, i, stepsOf[i]);
    });
  }
  function leavePrint() {
    root.classList.remove("print");
    slides.forEach((slide, i) => {
      slide.classList.remove("shown", "live");
      applySteps(slide, i, 0);
    });
    go(current, step, 1);
    fit();
  }

  const printOnly = new URLSearchParams(location.search).has("print");
  if (printOnly) {
    enterPrint();
    return;
  }

  window.addEventListener("beforeprint", enterPrint);
  window.addEventListener("afterprint", leavePrint);
  window.addEventListener("resize", fit);

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    if (key === "ArrowRight" || key === "ArrowDown" || key === "PageDown" || key === " " || key === "Enter") next();
    else if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp" || key === "Backspace") prev();
    else if (key === "Home") go(0, 0, -1);
    else if (key === "End") go(slides.length - 1, stepsOf[slides.length - 1], 1);
    else if (key === "f" || key === "F") {
      if (document.fullscreenElement) document.exitFullscreen();
      else root.requestFullscreen?.();
    } else if (key === "n" || key === "N") {
      notesEl.hidden = !notesEl.hidden;
      refreshChrome();
    } else if (key === "t" || key === "T") toggleTimer();
    else if (key === "p" || key === "P") window.print();
    else if (key === "?" || key === "h" || key === "H") helpEl.hidden = !helpEl.hidden;
    else if (key === "Escape") helpEl.hidden = true;
    else return;
    event.preventDefault();
  });

  // Click or tap: right two thirds go forward, left third goes back.
  stage.addEventListener("click", (event) => {
    if (event.target.closest(".hud")) return;
    if (event.clientX < window.innerWidth / 3) prev();
    else next();
  });
  let touchX = null;
  window.addEventListener("touchstart", (event) => { touchX = event.touches[0].clientX; }, { passive: true });
  window.addEventListener("touchend", (event) => {
    if (touchX === null) return;
    const dx = event.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) < 40) return;
    if (dx < 0) next();
    else prev();
  }, { passive: true });

  const start = Math.max(1, Math.min(slides.length, Number(location.hash.slice(1)) || 1)) - 1;
  fit();
  // Wait for the fonts so the first entrance is not drawn in a fallback face.
  (document.fonts?.ready ?? Promise.resolve()).then(() => {
    current = start;
    go(start, 0, 1);
    root.classList.add("ready");
  });
})();
