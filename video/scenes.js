/* Scene 6, the product walkthrough, built from the screenshots in shots/.

   The screenshots and the positions of their buttons come from tools/capture-shots.mjs
   (window.SHOTS). This file is the edit: which screenshot shows when, where the camera looks,
   where the cursor goes and what gets a ring. All times are seconds from the start of the scene.
   Everything becomes a paused animation; player.js sets its time like any other. */
window.buildScenes = ({ overlap }) => {
  const data = window.SHOTS;
  const scene = document.getElementById("s-product");
  if (!data || !scene) return;

  const sceneEls = [...document.querySelectorAll(".scene")];
  const next = sceneEls[sceneEls.indexOf(scene) + 1];
  const end = next ? Number(next.dataset.start) : Number(document.getElementById("stage").dataset.total);
  const D = end - Number(scene.dataset.start) + overlap; // seconds on this scene's timeline
  const timing = { duration: D * 1000, fill: "both" };
  const at = (t) => Math.max(0, Math.min(1, t / D));

  const cam = scene.querySelector(".cam");
  const screen = scene.querySelector(".screen");
  // The screen inside the browser frame, in stage pixels. Must match .browser and .screen in video.css.
  const SCREEN = { x: 192, y: 82, w: 1536, h: 960 };
  const FRAME = { x: 192, y: 38, w: 1536, h: 1004 }; // the whole browser frame, title bar included
  const CENTRE = { x: 960, y: 500 }; // where the camera puts what it looks at; a little high, above the caption
  const EASE = "cubic-bezier(0.65, 0, 0.35, 1)";

  const shotOf = (name) => {
    const shot = data.shots[name];
    if (!shot) throw new Error(`No screenshot "${name}". Run: node tools/capture-shots.mjs`);
    return shot;
  };
  /** Screen pixels per page pixel for a screenshot. */
  const k = (name) => SCREEN.w / shotOf(name).view[0];
  /** A named box of a screenshot, grown by `pad` page pixels: [x, y, w, h]. */
  const box = (name, key, pad = 0, grow = [0, 0, 0, 0]) => {
    const b = shotOf(name).boxes[key];
    if (!b) throw new Error(`No box "${key}" in screenshot "${name}".`);
    return [b[0] - pad - grow[0], b[1] - pad - grow[1], b[2] + 2 * pad + grow[0] + grow[2], b[3] + 2 * pad + grow[1] + grow[3]];
  };
  /** Keeps a box inside another one (a code line is wider than the card that shows it). */
  const within = (inner, outer) => {
    const x = Math.max(inner[0], outer[0]);
    const y = Math.max(inner[1], outer[1]);
    return [x, y, Math.min(inner[0] + inner[2], outer[0] + outer[2]) - x, Math.min(inner[1] + inner[3], outer[1] + outer[3]) - y];
  };
  const centre = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];

  // ------------------------------------------------------------------ the edit
  const NAME = shotOf("sign-ready").typing;
  const blindCard = box("o2-blind", "blind");
  const line239 = within(box("o2-blind", "line", 0), box("o2-blind", "blind", -2));
  const openSteps = box("sign-locked", "open");
  const decision = box("sign-ready", "decide");
  const dialog = box("spotcheck", "dialog");
  const told = box("spotcheck", "told");
  // The top of the spot-check message: its verdict and the sentence that names the signer.
  const verdict = [dialog[0], dialog[1], dialog[2], told[1] + told[3] + 14 - dialog[1]];
  const nothing = box("spotcheck", "nothing");

  /** Which screenshot is on screen from when. `fade` blends it in over that many seconds; otherwise it cuts. */
  const cuts = [
    { t: 0, shot: "board" },
    { t: 2.45, shot: "o2" },
    { t: 3.7, shot: "o2-blind", fade: 0.4 },
    { t: 8.15, shot: "o2-judged" },
    { t: 9.75, shot: "sign-locked" },
    { t: 13.4, shot: "sign-ready" },
    { t: 15.1, shot: "sign-named" },
    { t: 16.5, shot: "board-accepted" },
    { t: 19.4, shot: "spotcheck" },
  ];

  /** Where the camera looks. `look` is a box in the named screenshot, or null for the whole screen.
      `cut: true` jumps there; otherwise the camera travels from the key before. */
  const camera = [
    { t: 0, shot: "board", look: null },
    { t: 1.2, shot: "board", look: null },
    { t: 2.4, shot: "board", look: box("board", "card", 190) },
    { t: 2.45, shot: "o2", look: null, cut: true },
    { t: 3.5, shot: "o2", look: null },
    { t: 4.9, shot: "o2-blind", look: blindCard, pad: 26 },
    { t: 9.75, shot: "o2-blind", look: blindCard, pad: 6 },
    { t: 9.75, shot: "sign-locked", look: openSteps, pad: 70, cut: true },
    { t: 13.4, shot: "sign-locked", look: openSteps, pad: 50 },
    { t: 13.4, shot: "sign-ready", look: decision, pad: 80, cut: true },
    { t: 16.5, shot: "sign-ready", look: decision, pad: 60 },
    { t: 16.5, shot: "board-accepted", look: null, cut: true },
    { t: 16.9, shot: "board-accepted", look: null },
    { t: 17.9, shot: "board-accepted", look: box("board-accepted", "card", 150) },
    { t: 19.4, shot: "board-accepted", look: box("board-accepted", "card", 130) },
    { t: 19.4, shot: "spotcheck", look: verdict, pad: 130, cut: true },
    { t: 21.2, shot: "spotcheck", look: verdict, pad: 40 },
    { t: 23.6, shot: "spotcheck", look: verdict, pad: 30 },
    { t: 24.6, shot: "spotcheck", look: nothing, pad: 60 },
    { t: D, shot: "spotcheck", look: nothing, pad: 44 },
  ];

  /** The mouse. Points are page pixels of the named screenshot. `click: true` clicks on arrival. */
  const lookRight = centre(box("o2-blind", "looksRight"));
  const startButton = centre(box("board", "start"));
  const acceptButton = centre(box("sign-named", "accept"));
  const nameField = box("sign-ready", "name");
  const mouse = [
    { t: 0.5, shot: "board", to: [820, 620], show: true },
    { t: 1.9, shot: "board", to: startButton },
    { t: 2.1, shot: "board", to: startButton, click: true },
    { t: 2.45, shot: "board", to: startButton, hide: true },
    { t: 6.4, shot: "o2-blind", to: [640, 520], show: true },
    { t: 7.5, shot: "o2-blind", to: lookRight },
    { t: 7.85, shot: "o2-blind", to: lookRight, click: true },
    { t: 9.4, shot: "o2-blind", to: [lookRight[0] + 40, lookRight[1] + 70], hide: true },
    { t: 13.45, shot: "sign-ready", to: [nameField[0] + 250, nameField[1] + 64], show: true },
    { t: 15.1, shot: "sign-ready", to: [nameField[0] + 250, nameField[1] + 64] },
    { t: 15.8, shot: "sign-named", to: acceptButton },
    { t: 16.15, shot: "sign-named", to: acceptButton, click: true },
    { t: 16.5, shot: "sign-named", to: acceptButton, hide: true },
  ];

  /** Rings: a box that is outlined while the rest of the screen is dimmed. */
  const rings = [
    { from: 5.3, to: 7.2, shot: "o2-blind", box: line239, pad: 0 },
    { from: 10.3, to: 13.25, shot: "sign-locked", box: openSteps, pad: 6 },
    { from: 18, to: 19.35, shot: "board-accepted", box: box("board-accepted", "card", 8) },
    { from: 24.8, to: D, shot: "spotcheck", box: nothing, pad: 4 },
  ];

  /** The name, typed letter by letter into the sign-off. */
  const typing = { from: 13.8, to: 15 };

  // ------------------------------------------------------------------ build
  const add = (tag, className, parent = screen) => {
    const el = document.createElement(tag);
    el.className = className;
    parent.appendChild(el);
    return el;
  };
  /** A value that jumps at each time, written as step keyframes. `steps` is [[t, value], ...]. */
  const stepped = (property, steps) => {
    const frames = steps.map(([t, value]) => ({ offset: at(t), [property]: value, easing: "step-end" }));
    if (frames[0].offset > 0) frames.unshift({ offset: 0, [property]: steps[0][1] === 1 ? 0 : steps[0][1], easing: "step-end" });
    frames.push({ offset: 1, [property]: steps[steps.length - 1][1] });
    return frames;
  };

  // Screenshots: stacked in order, each one covering the ones before it.
  cuts.forEach((cut, i) => {
    const img = add("img", "shot");
    img.src = shotOf(cut.shot).src;
    img.alt = "";
    img.style.zIndex = String(i + 1);
    if (i === 0) return;
    const off = cuts[i + 1] ? cuts[i + 1].t + (cuts[i + 1].fade || 0) : null;
    const frames = [{ offset: 0, opacity: 0, easing: "step-end" }];
    if (cut.fade) {
      frames.push({ offset: at(cut.t), opacity: 0, easing: "linear" }, { offset: at(cut.t + cut.fade), opacity: 1, easing: "step-end" });
    } else {
      frames.push({ offset: at(cut.t), opacity: 1, easing: "step-end" });
    }
    if (off !== null) frames.push({ offset: at(off), opacity: 0, easing: "step-end" });
    frames.push({ offset: 1, opacity: off === null ? 1 : 0 });
    img.animate(frames, timing);
  });
  const topLayer = cuts.length + 1;

  // The name being typed: small pictures of the field, one per letter, over the empty field.
  if (NAME) {
    const scale = k("sign-ready");
    const gone = cuts.find((cut) => cut.shot === "sign-named").t;
    NAME.frames.forEach((src, i) => {
      const img = add("img", "patch");
      img.src = src;
      img.alt = "";
      Object.assign(img.style, {
        left: `${NAME.box[0] * scale}px`,
        top: `${NAME.box[1] * scale}px`,
        width: `${NAME.box[2] * scale}px`,
        height: `${NAME.box[3] * scale}px`,
        zIndex: String(topLayer),
      });
      const t = typing.from + ((typing.to - typing.from) * i) / Math.max(1, NAME.frames.length - 1);
      img.animate(stepped("opacity", [[t, 1], [gone, 0]]), timing);
    });
  }

  // Rings.
  for (const ring of rings) {
    const scale = k(ring.shot);
    const pad = ring.pad ?? 0;
    const el = add("i", "ring");
    Object.assign(el.style, {
      left: `${(ring.box[0] - pad) * scale}px`,
      top: `${(ring.box[1] - pad) * scale}px`,
      width: `${(ring.box[2] + 2 * pad) * scale}px`,
      height: `${(ring.box[3] + 2 * pad) * scale}px`,
      zIndex: String(topLayer + 1),
    });
    const fade = 0.3;
    const frames = [
      { offset: 0, opacity: 0, easing: "step-end" },
      { offset: at(ring.from), opacity: 0, easing: "ease-out" },
      { offset: at(ring.from + fade), opacity: 1, easing: "step-end" },
    ];
    if (ring.to < D) frames.push({ offset: at(ring.to - 0.2), opacity: 1, easing: "ease-in" }, { offset: at(ring.to), opacity: 0, easing: "step-end" });
    frames.push({ offset: 1, opacity: ring.to < D ? 0 : 1 });
    el.animate(frames, timing);
  }

  // The mouse, and a ripple for each click.
  const cursor = add("div", "cursor");
  cursor.style.zIndex = String(topLayer + 3);
  cursor.innerHTML =
    '<svg viewBox="0 0 30 30" width="30" height="30" aria-hidden="true"><path d="M5 3l18 11.5-8 1.7-4.3 7.3z" fill="#0b0b0c" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
  const place = (point) => `translate(${point.to[0] * k(point.shot) - 5}px, ${point.to[1] * k(point.shot) - 3}px)`;
  cursor.animate(
    [
      { offset: 0, transform: place(mouse[0]), easing: "step-end" },
      ...mouse.map((point, i) => ({ offset: at(point.t), transform: place(point), easing: mouse[i + 1] && mouse[i + 1].show ? "step-end" : EASE })),
      { offset: 1, transform: place(mouse[mouse.length - 1]) },
    ],
    timing,
  );
  const visible = [[0, 0]];
  for (const point of mouse) {
    if (point.show) visible.push([point.t, 1]);
    if (point.hide) visible.push([point.t, 0]);
  }
  cursor.animate(stepped("opacity", visible), timing);
  for (const point of mouse.filter((item) => item.click)) {
    const scale = k(point.shot);
    const holder = add("div", "cursor");
    holder.style.zIndex = String(topLayer + 2);
    holder.style.transform = `translate(${point.to[0] * scale}px, ${point.to[1] * scale}px)`;
    const ripple = add("i", "ripple", holder);
    ripple.animate(
      [
        { offset: 0, opacity: 0, transform: "scale(0.2)", easing: "step-end" },
        { offset: at(point.t), opacity: 1, transform: "scale(0.2)", easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
        { offset: at(point.t + 0.55), opacity: 0, transform: "scale(1.5)", easing: "step-end" },
        { offset: 1, opacity: 0, transform: "scale(1.5)" },
      ],
      timing,
    );
  }

  // The camera: scale and move the whole browser frame so the looked-at box fills the picture.
  const view = (key) => {
    if (!key.look) return "translate(0px, 0px) scale(1)";
    const scale = k(key.shot);
    const pad = key.pad ?? 0;
    const w = (key.look[2] + 2 * pad) * scale;
    const h = (key.look[3] + 2 * pad) * scale;
    const zoom = Math.min(2.1, 1720 / w, 800 / h);
    const cx = SCREEN.x + (key.look[0] + key.look[2] / 2) * scale;
    const cy = SCREEN.y + (key.look[1] + key.look[3] / 2) * scale;
    // Never show the empty stage beside the browser frame while zoomed in: where the frame is
    // larger than the picture it must cover it, where it is smaller it sits in the middle.
    const cover = (wanted, start, size, room) => {
      const length = size * zoom;
      if (length <= room) return (room - length) / 2 - start * zoom;
      return Math.max(room - (start + size) * zoom, Math.min(-start * zoom, wanted));
    };
    const tx = cover(CENTRE.x - cx * zoom, FRAME.x, FRAME.w, 1920);
    const ty = cover(CENTRE.y - cy * zoom, FRAME.y, FRAME.h, 1080);
    return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${zoom.toFixed(4)})`;
  };
  const frames = [];
  camera.forEach((key, i) => {
    const nextKey = camera[i + 1];
    // Into a cut the camera holds its place until the cut, then jumps.
    frames.push({ offset: at(key.t), transform: view(key), easing: nextKey && nextKey.cut ? "step-end" : EASE });
  });
  // Two keys at the same time (a drift that ends where a cut begins) must keep their order.
  cam.animate(frames, timing);
};
