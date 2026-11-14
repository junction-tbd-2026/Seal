import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPulls, fetchReview, postSignOff } from "./lib";
import { clearSaved, codeFingerprint, readSaved, storageKey } from "./progress";
import { Prose } from "./Prose";
import { SpotCheckReveal } from "./SpotCheck";
import type { Exam, Pull, PullList, PullStatus, SignOff, SignResult, SpotVerdict } from "./types";
import { Workspace } from "./Workspace";

const PRODUCT_NAME = "Reviewer Controls";

/** One short line on where a pull request stands, and the colour of its badge in the rail. */
const STATUS: Record<PullStatus, { label: (pull: Pull) => string; badge: (pull: Pull) => string }> = {
  needs_you: {
    label: (pull) => `${pull.lines_to_read} ${pull.lines_to_read === 1 ? "spot" : "spots"} to check yourself`,
    badge: () => "bg-missed text-white",
  },
  // Not "ready to sign": the steps come first, whatever the reviewer caught.
  clear: {
    label: (pull) => (pull.planted_defects ? "Reviewer missed nothing we planted" : "Reviewer could not be tested"),
    badge: (pull) => (pull.planted_defects ? "bg-caught text-white" : "bg-warn text-ink"),
  },
  signed: {
    label: (pull) =>
      `${{ accept: "Accepted", reject: "Rejected", full_read: "Sent for full read" }[pull.signed?.decision ?? ""] ?? "Signed"} by ${pull.signed?.name ?? "someone"}`,
    badge: () => "bg-ink text-white",
  },
  untested: { label: () => "Not tested yet", badge: () => "border-dashed bg-canvas text-faint" },
};

/** Text in the rail that only shows once the rail is open. */
const WHEN_OPEN = "opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100 group-has-[:focus-visible]/rail:opacity-100";

/** One pull request in the rail: a numbered badge that is always visible, and its title and status once the rail opens. */
function PullItem({ pull, active, onSelect }: { pull: Pull; active: boolean; onSelect: () => void }) {
  const status = STATUS[pull.status];
  // A review this person started here and has not signed yet.
  const saved = pull.status === "needs_you" || pull.status === "clear" ? readSaved(storageKey(pull.change_id, pull.reviewers[0] ?? "")) : null;
  const started = saved != null && saved.done > 0 && saved.total > 0;
  const detail = started ? `${saved.done} of ${saved.total} steps done` : status.label(pull);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      aria-label={`Pull request ${pull.number}: ${pull.title}. ${detail}`}
      className={`relative flex w-full items-center gap-3 rounded-lg p-1.5 text-left ${
        active ? "group-hover/rail:bg-panel group-has-[:focus-visible]/rail:bg-panel" : "hover:bg-panel"
      }`}
    >
      {/* The open pull request: a bar on the rail's edge, so it reads the same closed and open. */}
      {active && <span className="absolute -left-2.5 top-2.5 h-8 w-1 rounded-r bg-ink" aria-hidden="true" />}
      <span
        className={`relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border-2 border-ink text-[13px] font-extrabold ${status.badge(pull)} ${
          active ? "shadow-[var(--shadow-hard-sm)]" : ""
        }`}
      >
        #{pull.number}
        {started && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-panel" aria-hidden="true">
            <span className="block h-full bg-ink" style={{ width: `${Math.round((saved.done / saved.total) * 100)}%` }} />
          </span>
        )}
      </span>
      <span className={`min-w-0 flex-1 ${WHEN_OPEN}`}>
        <span className="block truncate text-[13.5px] font-bold leading-snug">{pull.title}</span>
        <span className="block truncate text-[12px] text-soft">{detail}</span>
      </span>
    </button>
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
  const [showRequirement, setShowRequirement] = useState(false);
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
    setShowRequirement(false);
    if (pull.status !== "untested") void loadReview(pull.change_id, false);
    // Reload only when a different pull request is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pull?.change_id, pull?.status === "untested"]);

  const reviewer = exam?.reviewers.find((item) => item.name === reviewerName) ?? exam?.reviewers[0] ?? null;
  // Saved checks belong to the code they were made on. A spot-check copy and the real change differ here.
  const code = useMemo(() => (exam ? codeFingerprint(exam.change.files) : ""), [exam]);

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
        <h1 className="text-[28px] font-extrabold">The page could not load its data</h1>
        <p className="mt-3 text-soft">{error}</p>
        <p className="mt-3 text-soft">
          Start the backend, then reload:
          <code className="mt-2 block rounded-md border-2 border-ink bg-panel p-2 font-mono text-[12px]">
            .venv/bin/uvicorn reviewer_controls.server:app --app-dir src --port 8000
          </code>
        </p>
      </main>
    );
  }

  if (!pulls) return <main className="px-6 py-24 text-center text-soft">Loading pull requests…</main>;

  const waiting = pulls.pull_requests.filter((item) => item.status === "needs_you" || item.status === "clear");
  const signed = pulls.pull_requests.filter((item) => item.status === "signed");
  const untested = pulls.pull_requests.filter((item) => item.status === "untested");
  const totals = exam?.change.files.reduce((sum, item) => ({ added: sum.added + item.added, removed: sum.removed + item.removed }), { added: 0, removed: 0 });
  const requirementBody = exam ? exam.change.requirement_text.split("\n").slice(1).join("\n").replace(/^\s*Source:.*$/m, "").trim() : "";
  const spot = pulls.spot_checks;

  const group = (title: string, items: Pull[]) =>
    items.length > 0 && (
      <div className="border-t border-hair pt-2 first:border-t-0 first:pt-0">
        <h2 className={`whitespace-nowrap px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.1em] text-faint ${WHEN_OPEN}`}>
          {title} · {items.length}
        </h2>
        <div className="space-y-1">
          {items.map((item) => (
            <PullItem key={item.number} pull={item} active={item.number === selected} onSelect={() => setSelected(item.number)} />
          ))}
        </div>
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-6 bg-ink px-4 py-2 text-white">
        <div className="flex items-center gap-2.5">
          <span className="grid h-6 w-6 place-items-center rounded bg-warn text-[13px] font-extrabold text-ink" aria-hidden="true">
            ✓
          </span>
          <span className="text-[15px] font-extrabold tracking-tight">{PRODUCT_NAME}</span>
        </div>
        <div className="flex items-center gap-5 text-[12px] text-white/70">
          {spot.enabled && (
            <span title="Now and then the code shown for sign-off is a copy with a planted mistake. Accepting it is recorded.">
              {spot.rate != null && spot.rate < 1 ? `About ${Math.round(spot.rate * 100)}% of first sign-offs are spot-checks` : "Sign-offs are spot-checked"}
              {spot.checked > 0 && ` · people caught ${spot.caught} of ${spot.checked}`}
            </span>
          )}
          <a href={pulls.repository_url} target="_blank" rel="noreferrer" className="font-mono hover:text-white" title="The repository this tool is watching">
            {pulls.repository}
          </a>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/*
          The rail keeps its narrow place in the layout; opening it lays it over the page instead of pushing the page aside.
          It opens on hover and on keyboard focus only, so it closes again after a click. Its box clips rather than hides
          overflow, because a hidden box can still be scrolled sideways by focus, which would slide the badges out of sight.
        */}
        <nav aria-label="Pull requests" className="group/rail relative z-40 w-[4.25rem] shrink-0">
          <div className="absolute inset-y-0 left-0 w-[4.25rem] overflow-clip border-r-2 border-ink bg-canvas transition-[width,box-shadow] duration-200 ease-out group-hover/rail:w-[20rem] group-hover/rail:shadow-[8px_0_24px_rgb(0_0_0/0.12)] group-hover/rail:delay-100 group-has-[:focus-visible]/rail:w-[20rem] group-has-[:focus-visible]/rail:shadow-[8px_0_24px_rgb(0_0_0/0.12)]">
            <div className="thin-scroll h-full w-[20rem] space-y-2 overflow-y-auto px-2.5 py-3">
              {group("Waiting for you", waiting)}
              {group("Signed", signed)}
              {group("Not tested yet", untested)}
            </div>
          </div>
        </nav>

        <main className="min-h-0 min-w-0 flex-1">
        {!pull ? (
          <p className="p-10 text-soft">No pull requests to show.</p>
        ) : pull.status === "untested" ? (
          <div className="mx-auto max-w-xl p-10">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-soft">Pull request #{pull.number}</p>
            <h1 className="mt-1 text-[28px] font-extrabold leading-tight">{pull.title}</h1>
            <div className="mt-6 rounded-lg border-2 border-ink bg-panel p-5 shadow-[var(--shadow-hard)]">
              <p className="text-[17px] font-bold">This pull request has not been tested yet</p>
              <p className="mt-2 text-soft">Run it from the project folder:</p>
              <code className="mt-3 block overflow-x-auto rounded-md border-2 border-ink bg-canvas p-2.5 font-mono text-[12px]">
                .venv/bin/python -m reviewer_controls.pipeline --change {pull.change_id} --kinds bug omission harmless
              </code>
              <button type="button" onClick={() => void loadPulls()} className="press mt-4 rounded-md bg-warn px-3 py-1.5 text-[13px] font-bold">
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
            onReviewer={setReviewerName}
            onSign={sign}
            onSaved={onSaved}
            header={
              // The pull request is context, not the task: one quiet line, with the requirement a click away.
              <div className="text-[12.5px] text-soft">
                <div className="flex items-baseline gap-2.5">
                  <a href={pull.url} target="_blank" rel="noreferrer" className="shrink-0 font-bold text-ink underline underline-offset-2">
                    Pull request #{pull.number}
                  </a>
                  <span className="min-w-0 truncate">{exam.change.requirement_title}</span>
                  <button
                    type="button"
                    onClick={() => setShowRequirement(!showRequirement)}
                    aria-expanded={showRequirement}
                    className="shrink-0 font-bold text-brand underline underline-offset-2 hover:text-ink"
                  >
                    {showRequirement ? "Hide the requirement" : "Read the requirement"}
                  </button>
                </div>
                {showRequirement && (
                  <div className="thin-scroll mt-3 max-h-64 overflow-y-auto rounded-lg border border-hair bg-canvas px-5 py-3 text-ink">
                    <p className="text-[12px] text-soft">
                      Issue {pull.requirement_id} · written by an AI agent
                      {totals && (
                        <>
                          {" "}
                          · {exam.change.files.length} files, <span className="text-caught">+{totals.added}</span> <span className="text-missed">−{totals.removed}</span>
                        </>
                      )}
                    </p>
                    <Prose text={requirementBody} />
                  </div>
                )}
              </div>
            }
          />
        )}
        </main>
      </div>

      {reveal && <SpotCheckReveal result={reveal.result} name={reveal.name} onContinue={continueAfterReveal} />}
    </div>
  );
}
