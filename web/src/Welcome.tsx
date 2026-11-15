import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, GitHubMark } from "./icons";
import { fetchPulls } from "./lib";

/** The pitch deck, copied into the page unchanged by the build (see vite.config.ts). */
const DECK_ADDRESS = "/deck/index.html";
/** How long the flow rests on a slide when it arrives, and on each further build of it. */
const SLIDE_MS = 6500;
const BUILD_MS = 4500;
/** How often the page looks at where the deck is. The deck does not announce its moves. */
const WATCH_MS = 200;
/** How far the wheel or the trackpad must travel for one step, and the pause before the next, so one swipe is one step. */
const WHEEL_STEP = 40;
const WHEEL_REST_MS = 450;
/** The name typed into the sign-in when the repository owner is not known yet. */
const FALLBACK_LOGIN = "reviewer";
const PASSWORD_DOTS = 11;

type Slide = { label: string; builds: number };
/** Where the deck is, and the colour under the bar: "light" on a white slide, "dark" or "blue" otherwise. */
type Place = { index: number; build: number; theme: string };

/** The slide's name, from the comment the deck keeps above it: "02 · Problem". */
function labelOf(slide: Element, number: number): string {
  for (let node = slide.previousSibling; node && node.nodeType !== Node.ELEMENT_NODE; node = node.previousSibling) {
    if (node.nodeType !== Node.COMMENT_NODE) continue;
    const name = /·\s*(.+?)\s*(\(.*\))?\s*$/.exec(node.textContent ?? "")?.[1];
    if (name) return name;
  }
  return `Slide ${number}`;
}

/**
 * Reads and steers the deck in the frame without touching its files. It reads the slide from
 * the frame's address and the build from the slide's classes, and it moves the deck with the
 * same key presses a presenter would use. Scrolling counts as such presses too.
 */
function useDeck(onTouched: () => void, scrollable: boolean) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [place, setPlace] = useState<Place>({ index: 0, build: 0, theme: "dark" });
  const touched = useRef(onTouched);
  touched.current = onTouched;
  const scrolls = useRef(scrollable);
  scrolls.current = scrollable;
  const wheel = useRef({ travelled: 0, lastAt: 0, restUntil: 0 });

  const read = useCallback((): Place | null => {
    const view = frame.current?.contentWindow;
    const page = frame.current?.contentDocument;
    const stage = page?.getElementById("stage");
    if (!view || !page || !stage || !page.documentElement.classList.contains("ready")) return null;
    const all = stage.querySelectorAll(".slide");
    const index = Math.max(0, Math.min(all.length - 1, (Number(view.location.hash.slice(1)) || 1) - 1));
    const shown = [...(all[index]?.querySelectorAll<HTMLElement>("[data-step].on") ?? [])];
    // In a tall window the slide sits lower, and the bar lies on the black above it.
    const theme = stage.getBoundingClientRect().top > 28 ? "dark" : (stage.dataset.theme ?? "dark");
    return { index, build: Math.max(0, ...shown.map((part) => Number(part.dataset.step))), theme };
  }, []);

  const press = useCallback((key: string, times = 1) => {
    const view = frame.current?.contentWindow;
    for (let count = 0; view && count < times; count += 1) view.dispatchEvent(new KeyboardEvent("keydown", { key }));
    const now = read();
    if (now) setPlace(now);
  }, [read]);

  /** Opens a slide at its first build, by pressing through whatever lies between. */
  const goTo = useCallback(
    (target: number) => {
      const now = read();
      if (!now) return;
      if (target > now.index) {
        let presses = slides[now.index].builds - now.build + 1;
        for (let between = now.index + 1; between < target; between += 1) presses += slides[between].builds + 1;
        press("ArrowRight", presses);
      } else {
        let presses = now.build;
        for (let between = target; between < now.index; between += 1) presses += slides[between].builds + 1;
        press("ArrowLeft", presses);
      }
    },
    [read, press, slides],
  );

  /**
   * Scrolling turns the slides: down or right is forward, up or left is back. Nothing on the page
   * scrolls, so the wheel is free for this, wherever the pointer is.
   */
  const onWheel = useCallback(
    (event: WheelEvent) => {
      if (event.ctrlKey) return; // A pinch to zoom, not a scroll.
      event.preventDefault();
      const state = wheel.current;
      const now = performance.now();
      if (!scrolls.current || now < state.restUntil) return;
      const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      // A mouse wheel may count in lines, a trackpad in pixels.
      const moved = (sideways ? event.deltaX : event.deltaY) * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 33 : 1);
      if (now - state.lastAt > 250 || Math.sign(moved) !== Math.sign(state.travelled)) state.travelled = 0;
      state.lastAt = now;
      state.travelled += moved;
      if (Math.abs(state.travelled) < WHEEL_STEP) return;
      touched.current();
      press(state.travelled > 0 ? "ArrowRight" : "ArrowLeft");
      state.travelled = 0;
      state.restUntil = now + WHEEL_REST_MS;
    },
    [press],
  );

  // Over the bar the wheel reaches this page; over the deck it reaches the frame, which onLoad covers.
  useEffect(() => {
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const onLoad = useCallback(() => {
    const page = frame.current?.contentDocument;
    if (!page) return;
    setSlides(
      [...page.querySelectorAll("#stage .slide")].map((slide, index) => ({
        label: labelOf(slide, index + 1),
        builds: Math.max(0, ...[...slide.querySelectorAll<HTMLElement>("[data-step]")].map((part) => Number(part.dataset.step))),
      })),
    );
    // A click or a key inside the deck is the visitor taking over. Key presses sent by this page do not arrive here.
    page.addEventListener("pointerdown", () => touched.current());
    page.addEventListener("keydown", () => touched.current());
    page.addEventListener("wheel", onWheel, { passive: false });
  }, [onWheel]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = read();
      if (now) setPlace((old) => (old.index === now.index && old.build === now.build && old.theme === now.theme ? old : now));
    }, WATCH_MS);
    return () => window.clearInterval(timer);
  }, [read]);

  return { frame, onLoad, slides, place, ready: slides.length > 0, press, goTo };
}

const PlayIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
    <path d="M2.5 1.3v9.4a.6.6 0 0 0 .9.5l8-4.7a.6.6 0 0 0 0-1l-8-4.7a.6.6 0 0 0-.9.5Z" />
  </svg>
);
const PauseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
    <rect x="2" y="1.5" width="3" height="9" rx="1" />
    <rect x="7" y="1.5" width="3" height="9" rx="1" />
  </svg>
);

/** Dark glass for the slide navigation, so it reads on the deck's dark, white and blue slides alike. */
const GLASS = "pointer-events-auto border border-white/15 bg-[#0b0b0c]/80 text-white shadow-[0_6px_24px_rgb(0_0_0/0.28)] backdrop-blur-md";

/**
 * A sign-in that only plays: it types a name and a row of dots, waits, and lets the visitor in.
 * Nothing can be typed into it and nothing is sent anywhere.
 */
function SignIn({ login, onLoading, onDone, onCancel }: { login: string; onLoading: () => void; onDone: () => void; onCancel: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const [typed, setTyped] = useState(0);
  const [dots, setDots] = useState(0);
  const [phase, setPhase] = useState<"typing" | "loading" | "done">("typing");
  const calls = useRef({ onLoading, onDone, onCancel });
  calls.current = { onLoading, onDone, onCancel };

  useEffect(() => {
    const timers: number[] = [];
    let clock = 0;
    const after = (wait: number, act: () => void) => {
      clock += wait;
      timers.push(window.setTimeout(act, clock));
    };
    const load = () => {
      setPhase("loading");
      calls.current.onLoading();
    };
    if (reduced) {
      setTyped(login.length);
      setDots(PASSWORD_DOTS);
      after(300, load);
      after(700, () => setPhase("done"));
      after(500, () => calls.current.onDone());
    } else {
      after(380, () => undefined);
      // Uneven gaps between the letters, the way a person types.
      for (let count = 1; count <= login.length; count += 1) after(48 + ((count * 37) % 60), () => setTyped(count));
      after(240, () => undefined);
      for (let count = 1; count <= PASSWORD_DOTS; count += 1) after(42 + ((count * 23) % 36), () => setDots(count));
      after(340, load);
      after(1250, () => setPhase("done"));
      after(800, () => calls.current.onDone());
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [login, reduced]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && calls.current.onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const typingName = phase === "typing" && typed < login.length;
  const typingPassword = phase === "typing" && !typingName;
  const field = (active: boolean) =>
    `flex h-10 items-center rounded-lg border bg-canvas px-3 font-mono text-[13.5px] transition-[border-color,box-shadow] duration-150 ${
      active ? "border-link shadow-[0_0_0_3px_rgb(35_131_226/0.16)]" : "border-line"
    }`;
  const caret = <span className="ml-px inline-block h-[17px] w-[1.5px] animate-pulse bg-ink" />;
  const title = { typing: "Sign in with GitHub", loading: "Signing in…", done: `Welcome, ${login}` }[phase];

  return (
    <motion.div
      className="fixed inset-0 z-20 grid place-items-center bg-[#0b0b0c]/60 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.2 }}
      onClick={(event) => event.target === event.currentTarget && onCancel()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Signing in"
        className="relative w-full max-w-[360px] overflow-hidden rounded-2xl bg-panel p-6 text-ink shadow-[var(--shadow-pop)]"
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.82, y: 28 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, scale: phase === "done" ? 1.03 : 1, y: 0 }}
        exit={{ opacity: 0, scale: reduced ? 1 : 0.94 }}
        transition={{ type: "spring", stiffness: 420, damping: 24 }}
      >
        {/* The wait, drawn along the top edge of the card. */}
        <motion.span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[3px] origin-left bg-gradient-to-r from-ai via-[#5a6be0] to-link"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: phase === "typing" ? 0 : 1, opacity: phase === "done" ? 0 : 1 }}
          transition={{ scaleX: { duration: reduced ? 0 : 1.2, ease: "easeInOut" }, opacity: { duration: 0.3 } }}
        />
        <p role="status" className="sr-only">
          {title}
        </p>

        <div className="flex items-center justify-center gap-3" aria-hidden="true">
          <img src="/seal.svg" alt="" className="h-12 w-12" />
          <span className="flex w-10 items-center justify-center gap-1.5">
            {phase === "done" ? (
              <motion.span
                className="grid h-6 w-6 place-items-center rounded-full bg-caught text-white"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 520, damping: 18 }}
              >
                <CheckIcon size={14} strokeWidth={3} />
              </motion.span>
            ) : (
              [0, 1, 2].map((dot) => (
                <motion.span
                  key={dot}
                  className="h-1.5 w-1.5 rounded-full bg-ink"
                  animate={reduced ? { opacity: 0.4 } : { opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: phase === "loading" ? 0.7 : 1.4, repeat: Infinity, delay: dot * 0.16 }}
                />
              ))
            )}
          </span>
          <span className="grid h-12 w-12 place-items-center rounded-full bg-ink text-white">
            <GitHubMark size={26} />
          </span>
        </div>

        <h2 className="mt-4 text-center font-display text-[22px] leading-tight font-bold tracking-[-0.03em]" aria-hidden="true">
          {title}
        </h2>
        <p className="mt-1 text-center text-[13.5px] text-soft">to open your pull requests in seal</p>

        <div className="mt-5 space-y-3" aria-hidden="true">
          <div>
            <div className="mb-1 text-[12.5px] font-medium text-soft">Username</div>
            <div className={field(typingName)}>
              {login.slice(0, typed)}
              {typingName && caret}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[12.5px] font-medium text-soft">Password</div>
            <div className={`${field(typingPassword)} tracking-[0.18em]`}>
              {"•".repeat(dots)}
              {typingPassword && caret}
            </div>
          </div>
          <motion.div
            className="flex h-10 items-center justify-center gap-2 rounded-lg text-[14px] font-medium text-white"
            animate={{ backgroundColor: phase === "done" ? "#3f7d58" : "#37352f", scale: phase === "loading" && !reduced ? [1, 0.96, 1] : 1 }}
            transition={{ duration: 0.3 }}
          >
            {phase === "typing" && "Sign in"}
            {phase === "loading" && (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                Signing in…
              </>
            )}
            {phase === "done" && (
              <>
                <CheckIcon size={16} strokeWidth={2.6} />
                Signed in
              </>
            )}
          </motion.div>
        </div>

        <p className="mt-4 text-center text-[12px] text-faint">A demo sign-in. No account is used.</p>
      </motion.div>
    </motion.div>
  );
}

/**
 * The first thing a visitor sees: the pitch deck, with a bar laid over it. The middle runs through
 * the slides once by itself, and "Log in" plays a sign-in and opens the board.
 */
export function Welcome({ onAuth, onCancel, onEnter }: { onAuth: () => void; onCancel: () => void; onEnter: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const [playing, setPlaying] = useState(!reduced);
  const [signingIn, setSigningIn] = useState(false);
  const [login, setLogin] = useState(FALLBACK_LOGIN);
  const pause = useCallback(() => setPlaying(false), []);
  const { frame, onLoad, slides, place, ready, press, goTo } = useDeck(pause, !signingIn);

  // The board shows the owner of the repository as the account, so the sign-in types that name.
  useEffect(() => {
    fetchPulls()
      .then((list) => setLogin(list.repository.split("/")[0] || FALLBACK_LOGIN))
      .catch(() => undefined);
  }, []);

  const slide = slides[place.index];
  const rest = place.build === 0 ? SLIDE_MS : BUILD_MS;
  const running = ready && playing && !signingIn;

  const atEnd = slide != null && place.index === slides.length - 1 && place.build === slide.builds;

  // The flow: one press after each rest. It stops on the last slide and does not start over by itself.
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => (atEnd ? setPlaying(false) : press("ArrowRight")), rest);
    return () => window.clearTimeout(timer);
  }, [running, atEnd, place.index, place.build, rest, press]);

  /** Play and pause. Played from the end, the flow starts again at the first slide. */
  const togglePlaying = () => {
    if (!playing && atEnd) press("Home");
    setPlaying(!playing);
  };

  // Keys reach this page, not the frame, until the visitor clicks into the deck. Pass on the ones that turn slides.
  useEffect(() => {
    if (signingIn) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const onButton = event.target instanceof Element && event.target.closest("button") != null;
      const turns = ["ArrowRight", "ArrowLeft", "PageDown", "PageUp", "Home", "End"].includes(event.key) || (event.key === " " && !onButton);
      if (!turns) return;
      event.preventDefault();
      setPlaying(false);
      press(event.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [signingIn, press]);

  // "Log in" is solid, in whichever of white and ink stands out from the slide under it.
  const solid = `pointer-events-auto border shadow-[0_6px_24px_rgb(0_0_0/0.28)] transition-[background-color,color,transform] duration-200 motion-reduce:transition-none ${
    place.theme === "light" ? "border-white/20 bg-[#0b0b0c] text-white" : "border-black/10 bg-white text-[#0b0b0c]"
  }`;

  return (
    <div className="fixed inset-0 bg-black">
      <iframe ref={frame} src={DECK_ADDRESS} onLoad={onLoad} title="Seal pitch deck" allow="fullscreen" className="absolute inset-0 h-full w-full border-0" />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-3 sm:gap-3 sm:p-4">
        {/* Nothing on the left: the slides carry the seal themselves. The empty cell keeps the navigation centred. */}
        <span />

        <nav aria-label="Slides" className={`${GLASS} flex h-10 items-center gap-1 rounded-full pl-1.5 pr-3 transition-opacity duration-300 ${ready ? "" : "opacity-0"}`}>
          <button
            type="button"
            onClick={togglePlaying}
            aria-label={playing ? "Pause the slides" : atEnd ? "Play the slides again" : "Play the slides"}
            title={playing ? "Pause" : atEnd ? "Play again" : "Play"}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full hover:bg-white/15"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <div className="flex items-center">
            {slides.map((item, index) => {
              const current = index === place.index;
              const from = place.build / (item.builds + 1);
              const to = (place.build + 1) / (item.builds + 1);
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => goTo(index)}
                  aria-label={`Slide ${index + 1}: ${item.label}`}
                  aria-current={current ? "step" : undefined}
                  title={item.label}
                  className="group/part flex h-8 w-3.5 items-center px-[2px] sm:w-7"
                >
                  <span className="relative block h-[4px] w-full overflow-hidden rounded-full bg-white/25 transition-[height] group-hover/part:h-[7px]">
                    {index < place.index && <span className="absolute inset-0 bg-white/70" />}
                    {current && (
                      <motion.span
                        // Drawn anew for each build and each start, so it always fills over the rest that is left.
                        key={`${place.build}:${running}`}
                        className="absolute inset-0 origin-left bg-white"
                        initial={{ scaleX: running ? from : to }}
                        animate={{ scaleX: to }}
                        transition={{ duration: running ? rest / 1000 : 0, ease: "linear" }}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <button
          type="button"
          onClick={() => setSigningIn(true)}
          className={`${solid} flex h-10 items-center gap-2 justify-self-end whitespace-nowrap rounded-full px-3 text-[14px] font-semibold hover:scale-[1.04] active:scale-[0.97] sm:px-4`}
        >
          <GitHubMark size={16} />
          Log in
        </button>
      </header>

      <AnimatePresence>
        {signingIn && (
          <SignIn
            login={login}
            onLoading={onAuth}
            onDone={onEnter}
            onCancel={() => {
              setSigningIn(false);
              onCancel();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
