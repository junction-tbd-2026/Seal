import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, BotIcon, CheckIcon, ChevronDown, PanelIcon, PullIcon, RepoIcon, XIcon } from "./icons";
import { fetchPulls, fetchReview, postSignOff, prettyModel } from "./lib";
import { clearSaved, codeFingerprint, readSaved, storageKey } from "./progress";
import { SpotCheckReveal } from "./SpotCheck";
import type { Exam, Pull, PullList, PullStatus, SignOff, SignResult, SpotVerdict } from "./types";
import { Workspace } from "./Workspace";

/** One short line on where a pull request stands, and the colour of its dot. */
const STATUS: Record<PullStatus, { label: (pull: Pull) => string; dot: (pull: Pull) => string }> = {
  needs_you: {
    label: (pull) => `AI reviewer missed planted mistakes at ${pull.lines_to_read} ${pull.lines_to_read === 1 ? "line" : "lines"}`,
    dot: () => "bg-missed",
  },
  // Not "ready to sign": the steps come first, whatever the reviewer caught.
  clear: {
    label: (pull) => (pull.planted_defects ? "AI reviewer noticed every planted mistake" : "AI reviewer could not be tested"),
    dot: (pull) => (pull.planted_defects ? "bg-caught" : "bg-warn"),
  },
  signed: {
    label: (pull) =>
      `${{ accept: "Accepted", reject: "Rejected", full_read: "Sent for full read" }[pull.signed?.decision ?? ""] ?? "Signed"} by ${pull.signed?.name ?? "someone"}`,
    dot: () => "bg-ink",
  },
  untested: { label: () => "Not tested yet", dot: () => "border-[1.5px] border-faint" },
};

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

/** The name and the seal. The seal wiggles when pointed at, because it can. */
function Brand() {
  const reduced = useReducedMotion() ?? false;
  return (
    <span className="flex shrink-0 items-center gap-2 pl-1 pr-0.5">
      <motion.img
        src="/seal.svg"
        alt=""
        width={28}
        height={28}
        className="h-7 w-7 drop-shadow-[0_1px_1px_rgb(0_0_0/0.06)]"
        whileHover={reduced ? undefined : { rotate: [0, -8, 7, -4, 0], scale: 1.08 }}
        transition={{ duration: 0.6 }}
      />
      <span className="hidden text-[15.5px] font-semibold tracking-[-0.01em] sm:inline">Seal</span>
    </span>
  );
}

/** One pull request in a list: number, title, where it stands, and how far this person got. */
function PullRow({ pull, active, inMenu, onSelect }: { pull: Pull; active: boolean; inMenu: boolean; onSelect: () => void }) {
  const status = STATUS[pull.status];
  // A review this person started here and has not signed yet.
  const saved = pull.status === "needs_you" || pull.status === "clear" ? readSaved(storageKey(pull.change_id, pull.reviewers[0] ?? "")) : null;
  const started = saved != null && saved.done > 0 && saved.total > 0;
  const detail = started ? `Your audit: ${saved.done} of ${saved.total} steps done` : status.label(pull);
  return (
    <button
      type="button"
      role={inMenu ? "menuitem" : undefined}
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`relative w-full rounded-lg px-3 py-2 text-left ${active ? "bg-canvas" : "hover:bg-canvas"}`}
    >
      <span className="flex items-start gap-2">
        <i className={`mt-[7px] inline-block h-2 w-2 shrink-0 rounded-full ${status.dot(pull)}`} aria-hidden="true" />
        <span className="shrink-0 text-[13px] font-medium leading-[21px] text-soft">#{pull.number}</span>
        <span className="line-clamp-2 min-w-0 text-[14px] font-medium leading-[21px]">{pull.title}</span>
        {active && <CheckIcon size={14} className="ml-auto mt-[4px] shrink-0 text-soft" />}
      </span>
      <span className="mt-0.5 line-clamp-2 block pl-4 text-[12.5px] leading-snug text-soft">{detail}</span>
      {started && (
        <span className="ml-4 mt-1.5 block h-[3px] overflow-hidden rounded-full bg-black/[0.08]" aria-hidden="true">
          <span className="block h-full rounded-full bg-done" style={{ width: `${Math.round((saved.done / saved.total) * 100)}%` }} />
        </span>
      )}
    </button>
  );
}

function PullGroups({ pulls, selected, inMenu = false, onSelect }: { pulls: PullList; selected: number | null; inMenu?: boolean; onSelect: (number: number) => void }) {
  const groups: [string, Pull[]][] = [
    ["Waiting for your audit", pulls.pull_requests.filter((item) => item.status === "needs_you" || item.status === "clear")],
    ["Signed", pulls.pull_requests.filter((item) => item.status === "signed")],
    ["Not tested yet", pulls.pull_requests.filter((item) => item.status === "untested")],
  ];
  return (
    <div className="space-y-3">
      {groups.map(
        ([title, items]) =>
          items.length > 0 && (
            <div key={title}>
              <p className="px-3 pb-1 pt-1 text-[12.5px] text-soft">
                {title} · {items.length}
              </p>
              {items.map((item) => (
                <PullRow key={item.number} pull={item} active={item.number === selected} inMenu={inMenu} onSelect={() => onSelect(item.number)} />
              ))}
            </div>
          ),
      )}
    </div>
  );
}

function SpotNote({ pulls }: { pulls: PullList }) {
  const spot = pulls.spot_checks;
  return (
    <div className="space-y-1.5 px-3 text-[12.5px] leading-snug text-soft">
      {spot.enabled && (
        <p title="Now and then the code shown for sign-off is a copy with a planted mistake. Accepting it is recorded.">
          {spot.rate != null && spot.rate < 1 ? `About ${Math.round(spot.rate * 100)}% of first sign-offs are spot-checks.` : "Sign-offs are spot-checked."}
          {spot.checked > 0 && ` People caught ${spot.caught} of ${spot.checked}.`}
        </p>
      )}
      <a href={pulls.repository_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-[12px] hover:text-ink" title="The repository this tool is watching">
        <RepoIcon size={13} />
        {pulls.repository}
      </a>
    </div>
  );
}

export default function App() {
  const [pulls, setPulls] = useState<PullList | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [exam, setExam] = useState<Exam | null>(null);
  const [loadingExam, setLoadingExam] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewerName, setReviewerName] = useState<string | null>(null);
  const [signoffs, setSignoffs] = useState<SignOff[]>([]);
  const [tab, setTab] = useState<"brief" | "pulls">("brief");
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
        .then((list) => {
          setPulls(list);
          setSelected((current) => current ?? list.pull_requests.find((pull) => pull.status !== "untested")?.number ?? list.pull_requests[0]?.number ?? null);
        })
        .catch((problem: Error) => setError(problem.message)),
    [],
  );

  useEffect(() => {
    void loadPulls();
  }, [loadPulls]);

  const pull = pulls?.pull_requests.find((item) => item.number === selected) ?? null;

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
  const hasBrief = Boolean(pull && pull.status !== "untested" && exam && reviewer);

  const select = (number: number) => {
    setSelected(number);
    setTab("brief");
    setSideOpen(false);
  };

  const sign = async (name: string, decision: string, spots: { plant_id: string; verdict: SpotVerdict }[]) => {
    if (!exam?.session || !reviewer) throw new Error("This review session has ended. Reload the pull request.");
    const result = await postSignOff({ session: exam.session, reviewer: reviewer.name, name, decision, spots });
    if (result.spot_check) {
      setReveal({ result, name: name.trim() });
    } else {
      setSignoffs((current) => [...current, result.signoff]);
      await loadReview(exam.change.id, true);
    }
    void loadPulls();
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

  const activeTab = hasBrief ? tab : "pulls";

  const panel = !pull ? (
    <p className="p-10 text-soft">No pull requests to show.</p>
  ) : pull.status === "untested" ? (
    <div className="max-w-xl px-10 py-10">
      <p className="text-[13.5px] text-soft">Pull request #{pull.number}</p>
      <h1 className="mt-1 text-[22px] font-semibold leading-snug">{pull.title}</h1>
      <div className="mt-6 rounded-xl border border-line bg-panel p-5">
        <p className="text-[15px] font-medium">This pull request has not been tested yet</p>
        <p className="mt-1 text-soft">Run it from the project folder:</p>
        <code className="mt-3 block overflow-x-auto rounded-lg bg-canvas p-3 font-mono text-[12px]">
          .venv/bin/python -m reviewer_controls.pipeline --change {pull.change_id} --kinds bug omission harmless
        </code>
        <button type="button" onClick={() => void loadPulls()} className="btn mt-4 h-9 px-3.5 text-[14px]">
          Check again
        </button>
      </div>
    </div>
  ) : !exam || !reviewer ? (
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
            aria-label="Show the audit brief and pull requests"
          >
            <PanelIcon size={17} />
          </button>
          <Brand />
          <span className="mx-1.5 hidden h-5 w-px shrink-0 bg-line sm:block" aria-hidden="true" />
          {pull && (
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
                  <PullGroups
                    pulls={pulls}
                    selected={selected}
                    inMenu
                    onSelect={(number) => {
                      select(number);
                      close();
                    }}
                  />
                  <div className="mt-2 border-t border-hair pb-1.5 pt-2.5">
                    <SpotNote pulls={pulls} />
                  </div>
                </>
              )}
            </Dropdown>
          )}
          {pull?.url && (
            <a
              href={pull.url}
              target="_blank"
              rel="noreferrer"
              title={`Open pull request #${pull.number} on GitHub`}
              aria-label={`Open pull request #${pull.number} on GitHub`}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint hover:bg-subtle hover:text-ink"
            >
              <ArrowUpRight size={16} />
            </a>
          )}
        </div>
        {exam && reviewer && pull?.status !== "untested" && (
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
            <div className="relative flex flex-1 rounded-[10px] bg-subtle p-[3px]" role="tablist" aria-label="Side bar">
              {(
                [
                  ["brief", "Audit brief"],
                  ["pulls", "Pull requests"],
                ] as const
              ).map(([value, text]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === value}
                  disabled={value === "brief" && !hasBrief}
                  onClick={() => setTab(value)}
                  className={`relative h-[30.5px] flex-1 rounded-lg text-[14px] font-medium ${activeTab === value ? "text-ink" : "text-soft hover:text-ink"} disabled:opacity-50`}
                >
                  {activeTab === value && (
                    <motion.span
                      layoutId="side-tab"
                      className="absolute inset-0 rounded-lg bg-panel shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  )}
                  <span className="relative">{text}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setSideOpen(false)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-soft hover:bg-subtle lg:hidden" aria-label="Close">
              <XIcon size={16} />
            </button>
          </div>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="rounded-[14px] border border-hair bg-panel">
              {/* The audit brief is drawn here by the review on screen; the slot stays mounted so it can. */}
              <div ref={setBriefSlot} className={activeTab === "brief" ? "" : "hidden"} />
              {activeTab === "pulls" && (
                <div className="space-y-3 py-2.5">
                  <div className="px-1.5">
                    <PullGroups pulls={pulls} selected={selected} onSelect={select} />
                  </div>
                  <div className="border-t border-hair pt-3">
                    <SpotNote pulls={pulls} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl border border-hair bg-panel shadow-[var(--shadow-panel)]">{panel}</main>
      </div>

      {reveal && <SpotCheckReveal result={reveal.result} name={reveal.name} onContinue={continueAfterReveal} />}
    </div>
  );
}
