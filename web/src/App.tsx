import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, BotIcon, CheckIcon, ChevronDown, GitHubMark, PanelIcon, PullIcon, XIcon } from "./icons";
import { fetchPulls, fetchReview, postSignOff, prettyModel } from "./lib";
import { clearSaved, codeFingerprint, storageKey } from "./progress";
import { Account, Landing, PullGroups, RepoLink, canOpen, stageOf } from "./Pulls";
import { SpotCheckReveal } from "./SpotCheck";
import type { Exam, PullList, SignOff, SignResult, SpotVerdict } from "./types";
import { Workspace } from "./Workspace";

/** A button that opens a small menu under itself. Closes on a click outside, on Escape, and after a choice. */
function Dropdown({
  align = "left",
  label,
  trigger,
  children,
}: {
  align?: "left" | "right";
  label: string;
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion() ?? false;
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)} className="block max-w-full">
        {trigger(open)}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: reduced ? 0 : -4, scale: reduced ? 1 : 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduced ? 0 : -4, scale: reduced ? 1 : 0.98 }}
            transition={{ duration: 0.14 }}
            className={`absolute top-full z-50 mt-1.5 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-hair bg-panel p-1.5 shadow-[var(--shadow-pop)] ${
              align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left"
            }`}
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** How often the list asks again while an AI check is running. */
const POLL_MS = 8000;

/** The pull request named in the address (?pr=2), so the back button and a reload keep the place. */
function pullInAddress(): number | null {
  const number = Number(new URLSearchParams(window.location.search).get("pr"));
  return Number.isInteger(number) && number > 0 ? number : null;
}

/** The name and the seal, which lead back to the list. The seal wiggles when pointed at, because it can. */
function Brand({ onHome }: { onHome: () => void }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <button type="button" onClick={onHome} title="All pull requests" className="flex shrink-0 items-center gap-2 rounded-lg py-0.5 pl-1 pr-1.5">
      <motion.img
        src="/seal.svg"
        alt=""
        width={32}
        height={32}
        className="h-8 w-8"
        whileHover={reduced ? undefined : { rotate: [0, -8, 7, -4, 0], scale: 1.08 }}
        transition={{ duration: 0.6 }}
      />
      <span className="hidden font-display text-[21px] leading-none font-bold tracking-[-0.04em] sm:inline">seal</span>
    </button>
  );
}

export default function App() {
  const [pulls, setPulls] = useState<PullList | null>(null);
  const [selected, setSelected] = useState<number | null>(pullInAddress);
  /** The pull request signed last, so the list can show it settling at the bottom. */
  const [justSigned, setJustSigned] = useState<number | null>(null);
  const [exam, setExam] = useState<Exam | null>(null);
  const [loadingExam, setLoadingExam] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewerName, setReviewerName] = useState<string | null>(null);
  const [signoffs, setSignoffs] = useState<SignOff[]>([]);
  const [sideOpen, setSideOpen] = useState(false);
  const [briefSlot, setBriefSlot] = useState<HTMLDivElement | null>(null);
  const reduced = useReducedMotion() ?? false;
  // Saved checks live in the browser, not in state: this redraws the list when they change.
  const [, setSavedTick] = useState(0);
  const onSaved = useCallback(() => setSavedTick((tick) => tick + 1), []);
  const [reveal, setReveal] = useState<{ result: Extract<SignResult, { spot_check: true }>; name: string } | null>(null);

  const loadPulls = useCallback(
    () =>
      fetchPulls()
        .then((list) => setPulls(list))
        .catch((problem: Error) => setError(problem.message)),
    [],
  );

  useEffect(() => {
    void loadPulls();
  }, [loadPulls]);

  // While an AI check is running, ask again now and then, so the pull request opens up once its results are in.
  const checking = pulls?.pull_requests.some((item) => stageOf(item) === "checking") ?? false;
  useEffect(() => {
    if (!checking) return;
    const timer = window.setInterval(() => void loadPulls(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [checking, loadPulls]);

  /** Opens a pull request, or the list with null. The address follows, so the back button works. */
  const go = useCallback((number: number | null, replace = false) => {
    setSelected(number);
    setSideOpen(false);
    if (number != null) {
      setJustSigned(null);
    }
    const address = number == null ? window.location.pathname : `${window.location.pathname}?pr=${number}`;
    if (replace) window.history.replaceState(null, "", address);
    else window.history.pushState(null, "", address);
  }, []);

  useEffect(() => {
    const onPop = () => setSelected(pullInAddress());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const pull = pulls?.pull_requests.find((item) => item.number === selected) ?? null;

  // Only a pull request ready to audit opens. A signed one, one still being checked, or an unknown number leads back to the list.
  useEffect(() => {
    if (pulls && selected != null && (!pull || !canOpen(pull))) go(null, true);
  }, [pulls, selected, pull, go]);

  const loadReview = useCallback((changeId: string, keepView: boolean) => {
    setLoadingExam(true);
    return fetchReview(changeId)
      .then((data) => {
        setExam(data);
        setSignoffs(data.signoffs);
        if (!keepView) setReviewerName(data.reviewers[0]?.name ?? null);
      })
      .catch((problem: Error) => setError(problem.message))
      .finally(() => setLoadingExam(false));
  }, []);

  useEffect(() => {
    if (!pull) return;
    setExam(null);
    if (pull.status !== "untested") void loadReview(pull.change_id, false);
    // Reload only when a different pull request is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pull?.change_id, pull?.status === "untested"]);

  const reviewer = exam?.reviewers.find((item) => item.name === reviewerName) ?? exam?.reviewers[0] ?? null;
  // Saved checks belong to the code they were made on. A spot-check copy and the real change differ here.
  const code = useMemo(() => (exam ? codeFingerprint(exam.change.files) : ""), [exam]);
  const select = (number: number) => go(number);

  const sign = async (name: string, decision: string, spots: { plant_id: string; verdict: SpotVerdict }[]) => {
    if (!exam?.session || !reviewer) throw new Error("This review session has ended. Reload the pull request.");
    const result = await postSignOff({ session: exam.session, reviewer: reviewer.name, name, decision, spots });
    if (result.spot_check) {
      setReveal({ result, name: name.trim() });
      void loadPulls();
      return;
    }
    // Signed is final: the audit's checks are done with, and the pull request closes.
    exam.reviewers.forEach((item) => clearSaved(storageKey(exam.change.id, item.name)));
    setSignoffs((current) => [...current, result.signoff]);
    // Noted before the list reloads: the reload alone already leads back to the list.
    setJustSigned(pull?.number ?? null);
    await loadPulls();
    setExam(null);
    go(null, true);
  };

  const continueAfterReveal = () => {
    setReveal(null);
    if (!exam) return;
    // Those checks were made on the planted copy. The real change starts from nothing.
    exam.reviewers.forEach((item) => clearSaved(storageKey(exam.change.id, item.name)));
    void loadReview(exam.change.id, true);
  };

  if (error) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <h1 className="text-[24px] font-semibold">The page could not load its data</h1>
        <p className="mt-3 text-soft">{error}</p>
        <p className="mt-3 text-soft">
          Start the backend, then reload:
          <code className="mt-2 block rounded-lg border border-line bg-panel p-2.5 font-mono text-[12px]">
            .venv/bin/uvicorn reviewer_controls.server:app --app-dir src --port 8000
          </code>
        </p>
      </main>
    );
  }

  if (!pulls)
    return (
      <main className="grid h-full place-items-center px-6 text-center text-soft">
        <div>
          <motion.img
            src="/seal.svg"
            alt=""
            className="mx-auto h-14 w-14"
            animate={reduced ? undefined : { y: [0, -5, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
          <p className="mt-3">Loading pull requests…</p>
        </div>
      </main>
    );


  // Home: the list of pull requests in the middle of the screen.
  if (!pull) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-hair bg-panel px-3 sm:px-4">
          <Brand onHome={() => go(null)} />
          <div className="flex min-w-0 items-center gap-4">
            <RepoLink pulls={pulls} />
            <span className="h-5 w-px shrink-0 bg-line" aria-hidden="true" />
            <Account pulls={pulls} />
          </div>
        </header>
        <main className="min-h-0 flex-1">
          <Landing pulls={pulls} justSigned={justSigned} onOpen={(number) => go(number)} />
        </main>
        {reveal && <SpotCheckReveal result={reveal.result} name={reveal.name} onContinue={continueAfterReveal} />}
      </div>
    );
  }

  const panel = !exam || !reviewer ? (
    <p className="p-10 text-soft">{loadingExam ? "Loading the review…" : "No review to show."}</p>
  ) : (
    <Workspace
      key={`${exam.change.id}|${reviewer.run_file}|${code}`}
      exam={exam}
      reviewer={reviewer}
      code={code}
      signoffs={signoffs}
      briefSlot={briefSlot}
      onSign={sign}
      onSaved={onSaved}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setSideOpen(true)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-soft hover:bg-subtle hover:text-ink lg:hidden"
            aria-label="Show the audit brief"
          >
            <PanelIcon size={17} />
          </button>
          <Brand onHome={() => go(null)} />
          <span className="mx-1.5 hidden h-5 w-px shrink-0 bg-line sm:block" aria-hidden="true" />
          {(
            <Dropdown
              label="Switch pull request"
              trigger={(open) => (
                <span className={`flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 ${open ? "bg-subtle" : "hover:bg-subtle"}`}>
                  <PullIcon size={17} className="shrink-0 text-soft" />
                  <span className="shrink-0 text-[14.5px] font-semibold">PR #{pull.number}</span>
                  <span className="min-w-0 truncate text-[14.5px] text-soft">{pull.title}</span>
                  <ChevronDown size={15} className={`shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`} />
                </span>
              )}
            >
              {(close) => (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      go(null);
                      close();
                    }}
                    className="mb-1.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] font-medium hover:bg-canvas"
                  >
                    <ArrowLeft size={15} className="text-soft" />
                    All pull requests
                  </button>
                  <PullGroups
                    pulls={pulls}
                    selected={selected}
                    inMenu
                    onSelect={(number) => {
                      select(number);
                      close();
                    }}
                  />
                  <div className="mt-2 border-t border-hair px-3 pb-1.5 pt-2.5">
                    <RepoLink pulls={pulls} />
                  </div>
                </>
              )}
            </Dropdown>
          )}
          {pull.url && (
            <a
              href={pull.url}
              target="_blank"
              rel="noreferrer"
              title={`Open pull request #${pull.number} on GitHub`}
              aria-label={`Open pull request #${pull.number} on GitHub`}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-soft hover:bg-subtle hover:text-ink"
            >
              <GitHubMark size={16} />
            </a>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {exam && reviewer && (
            <Dropdown
              align="right"
              label="AI reviewer under audit"
              trigger={(open) => (
                <span
                  className={`flex h-[28.5px] items-center gap-2 rounded-lg px-2.5 text-[14px] font-medium text-ai transition-colors ${
                    open ? "bg-ai-tint" : "bg-ai-wash hover:bg-ai-tint"
                  }`}
                >
                  <BotIcon size={15} className="shrink-0" />
                  <span className="hidden sm:inline">Auditing</span>
                  <span className="max-w-[12rem] truncate">{prettyModel(reviewer.name)}</span>
                  {exam.reviewers.length > 1 && <ChevronDown size={15} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />}
                </span>
              )}
            >
              {(close) => (
                <div>
                  <p className="px-3 pb-1 pt-1 text-[12.5px] text-soft">AI reviewers of this pull request</p>
                  {exam.reviewers.map((item) => {
                    const active = item.name === reviewer.name;
                    return (
                      <button
                        key={item.name}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => {
                          setReviewerName(item.name);
                          close();
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left ${active ? "bg-canvas" : "hover:bg-canvas"}`}
                      >
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ai text-white">
                          <BotIcon size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium">{prettyModel(item.name)}</span>
                          <span className="block text-[12.5px] text-soft">
                            {item.counts.defects_total > 0 ? `Noticed ${item.counts.defects_caught} of ${item.counts.defects_total} planted mistakes` : "Could not be tested"}
                          </span>
                        </span>
                        {active && <CheckIcon size={15} className="shrink-0 text-soft" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </Dropdown>
          )}
          <Account pulls={pulls} compact />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 px-2 pb-2 sm:px-4 sm:pb-4">
        {/* Below the large breakpoint the side bar slides over the page instead of taking room from the code. */}
        <AnimatePresence>
          {sideOpen && (
            <motion.div
              key="scrim"
              className="fixed inset-0 z-40 bg-ink/20 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.18 }}
              onClick={() => setSideOpen(false)}
            />
          )}
        </AnimatePresence>
        <aside
          className={`fixed inset-y-2 left-2 z-50 flex w-[260px] flex-col gap-3 rounded-2xl bg-canvas p-2 shadow-[var(--shadow-pop)] transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-[240px] lg:shrink-0 lg:translate-x-0 lg:rounded-none lg:bg-transparent lg:p-0 lg:pt-1 lg:shadow-none ${
            sideOpen ? "translate-x-0" : "-translate-x-[110%]"
          }`}
        >
          <div className="flex items-center gap-2">
            {/* The way back to the board: the "Start audit" sweep, mirrored, so the colour runs the way you go. */}
            <button
              type="button"
              onClick={() => go(null)}
              className="group/back relative flex h-[36.5px] flex-1 items-center gap-2 overflow-hidden rounded-[10px] bg-subtle px-3 text-[14px] font-medium text-soft"
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 origin-right scale-x-0 bg-gradient-to-l from-ai via-[#5a6be0] to-link transition-transform duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/back:scale-x-100 group-focus-visible/back:scale-x-100 motion-reduce:transition-none"
              />
              <ArrowLeft
                size={16}
                className="relative transition-[transform,color] duration-300 group-hover/back:-translate-x-1 group-hover/back:text-white group-focus-visible/back:-translate-x-1 group-focus-visible/back:text-white motion-reduce:transition-none"
              />
              <span className="relative transition-colors duration-200 group-hover/back:text-white group-focus-visible/back:text-white">All pull requests</span>
            </button>
            <button type="button" onClick={() => setSideOpen(false)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-soft hover:bg-subtle lg:hidden" aria-label="Close">
              <XIcon size={16} />
            </button>
          </div>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="rounded-[14px] border border-hair bg-panel">
              {/* The audit brief is drawn here by the review on screen; the slot stays mounted so it can. */}
              <div ref={setBriefSlot} />
            </div>
          </div>
        </aside>

        <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl border border-hair bg-panel shadow-[var(--shadow-panel)]">{panel}</main>
      </div>

      {reveal && <SpotCheckReveal result={reveal.result} name={reveal.name} onContinue={continueAfterReveal} />}
    </div>
  );
}
