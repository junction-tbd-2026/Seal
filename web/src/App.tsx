import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPulls, fetchReview, postSignOff } from "./lib";
import { clearSaved, codeFingerprint, readSaved, storageKey } from "./progress";
import { Prose } from "./Prose";
import { SpotCheckReveal } from "./SpotCheck";
import type { Exam, Pull, PullList, PullStatus, Reviewer, SignOff, SignResult, SpotVerdict } from "./types";
import { Workspace } from "./Workspace";

const PRODUCT_NAME = "Reviewer Controls";

const STATUS: Record<PullStatus, { label: (pull: Pull) => string; chip: string | ((pull: Pull) => string) }> = {
  needs_you: {
    label: (pull) => `${pull.lines_to_read} ${pull.lines_to_read === 1 ? "spot" : "spots"} to check yourself`,
    chip: "bg-missed text-white",
  },
  // "Ready to sign" would be wrong here: the steps come first, whatever the reviewer caught.
  clear: {
    label: (pull) => (pull.planted_defects ? "Reviewer missed nothing we planted" : "Reviewer could not be tested"),
    chip: (pull) => (pull.planted_defects ? "bg-caught text-white" : "bg-warn text-ink"),
  },
  signed: {
    label: (pull) =>
      `${{ accept: "Accepted", reject: "Rejected", full_read: "Sent for full read" }[pull.signed?.decision ?? ""] ?? "Signed"} by ${pull.signed?.name ?? "someone"}`,
    chip: "bg-ink text-white",
  },
  untested: { label: () => "Not tested yet", chip: "bg-panel text-soft" },
};

/** One plain sentence: what was claimed, how far to believe it, and what to do. */
function summarise(reviewer: Reviewer): string {
  const points = reviewer.points;
  const { defects_caught: caught, defects_total: total } = reviewer.counts;
  const spots = reviewer.read_yourself.length;

  let said: string;
  if (reviewer.review_failed) {
    said = "The AI reviewer gave no usable answer on this change.";
  } else if (points.length > 0) {
    const met = points.filter((point) => point.status === "met").length;
    said = `The requirement asks for ${points.length} things. The AI reviewer says ${met} ${met === 1 ? "is" : "are"} met and points to the lines.`;
  } else {
    said = reviewer.findings.length > 0 ? `The AI reviewer reported ${reviewer.findings.length} problems.` : "The AI reviewer found no problems.";
  }
  const tested =
    total > 0
      ? ` We then broke the change ${total} times in copies to see if it would notice: it noticed ${caught}.`
      : " The reviewer could not be tested on this change.";
  const todo =
    spots > 0
      ? ` The steps take you through every point, and the ${spots} red ${spots === 1 ? "spot" : "spots"} it missed need your own check.`
      : total > 0
        ? " It missed nothing we planted. The steps still take you through every point before you sign."
        : " Treat the change as unreviewed.";
  return said + tested + todo;
}

function PullItem({ pull, active, onSelect }: { pull: Pull; active: boolean; onSelect: () => void }) {
  const status = STATUS[pull.status];
  const chip = typeof status.chip === "string" ? status.chip : status.chip(pull);
  // A review this person started here and has not signed yet.
  const saved = pull.status === "needs_you" || pull.status === "clear" ? readSaved(storageKey(pull.change_id, pull.reviewers[0] ?? "")) : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`w-full rounded-lg border-2 border-ink px-3 py-2.5 text-left transition-[transform,box-shadow] ${
        active ? "-translate-x-0.5 -translate-y-0.5 bg-warn shadow-[var(--shadow-hard)]" : "bg-panel hover:bg-canvas"
      }`}
    >
      <span className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide text-soft">
        <span>
          #{pull.number} · issue {pull.requirement_id}
        </span>
        <span>{pull.files} files</span>
      </span>
      <span className="mt-1 block text-[14px] font-bold leading-snug">{pull.title}</span>
      <span className={`mt-2 inline-block rounded border-2 border-ink px-1.5 py-px text-[11px] font-bold ${chip}`}>{status.label(pull)}</span>
      {saved && saved.done > 0 && saved.total > 0 && (
        <span className="mt-2 flex items-center gap-2 text-[11.5px] font-bold">
          <span className="h-2 flex-1 overflow-hidden rounded-sm border-2 border-ink bg-panel" aria-hidden="true">
            <span className="block h-full bg-ink" style={{ width: `${Math.round((saved.done / saved.total) * 100)}%` }} />
          </span>
          Your review: {saved.done} of {saved.total} steps
        </span>
      )}
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
  const [compare, setCompare] = useState(false);
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
    setCompare(false);
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
      <div>
        <h2 className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.12em] text-soft">
          {title} <span className="rounded border-2 border-ink bg-panel px-1.5 text-ink">{items.length}</span>
        </h2>
        <div className="space-y-2.5">
          {items.map((item) => (
            <PullItem key={item.number} pull={item} active={item.number === selected} onSelect={() => setSelected(item.number)} />
          ))}
        </div>
      </div>
    );

  return (
    <div className="grid h-full grid-cols-[19rem_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]">
      <header className="col-span-2 flex items-center justify-between gap-6 border-b-2 border-ink bg-ink px-4 py-2.5 text-white">
        <div className="flex items-center gap-3">
          <span className="grid h-7 w-7 place-items-center rounded-md border-2 border-white bg-warn text-[15px] font-extrabold text-ink" aria-hidden="true">
            ✓
          </span>
          <span className="text-[17px] font-extrabold tracking-tight">{PRODUCT_NAME}</span>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          {spot.enabled && (
            <span className="rounded-md border-2 border-white/40 px-2.5 py-1" title="Now and then the code shown for sign-off is a copy with a planted mistake. Accepting it is recorded.">
              {spot.rate != null && spot.rate < 1
                ? `About ${Math.round(spot.rate * 100)}% of first sign-offs are spot-checks`
                : "Sign-offs are spot-checked"}
              {spot.checked > 0 && (
                <strong className="ml-1.5 text-warn">
                  · people caught {spot.caught} of {spot.checked}
                </strong>
              )}
            </span>
          )}
          <a
            href={pulls.repository_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-md border-2 border-white/40 px-2.5 py-1 font-mono hover:border-white"
            title="The repository this tool is watching"
          >
            <span className="h-2 w-2 rounded-full bg-caught" /> {pulls.repository}
          </a>
        </div>
      </header>

      <nav aria-label="Pull requests" className="thin-scroll space-y-6 overflow-y-auto border-r-2 border-ink bg-canvas p-4">
        <p className="text-[12.5px] leading-snug text-soft">
          Pull requests opened by an AI agent. An AI reviewer checks each one against its requirement, and we test that reviewer before you sign.
        </p>
        {group("Waiting for you", waiting)}
        {group("Signed", signed)}
        {group("Not tested yet", untested)}
      </nav>

      <main className="min-h-0 min-w-0">
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
            summary={summarise(reviewer)}
            compare={compare}
            onCompare={() => setCompare(true)}
            onReviewer={setReviewerName}
            onSign={sign}
            onSaved={onSaved}
            header={
              <div className="border-b-2 border-ink bg-canvas px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold uppercase tracking-[0.1em] text-soft">
                  <a href={pull.url} target="_blank" rel="noreferrer" className="underline decoration-2 underline-offset-2 hover:text-ink">
                    Pull request #{pull.number}
                  </a>
                  <span>issue {pull.requirement_id}</span>
                  <span>written by an AI agent</span>
                  {totals && (
                    <span>
                      {exam.change.files.length} files · <span className="text-caught">+{totals.added}</span> <span className="text-missed">−{totals.removed}</span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowRequirement(!showRequirement)}
                    aria-expanded={showRequirement}
                    className="text-brand underline decoration-2 underline-offset-2"
                  >
                    {showRequirement ? "Hide the full requirement" : "Read the full requirement"}
                  </button>
                </div>
                <h1 className="mt-1 text-[21px] font-extrabold leading-tight tracking-tight">{exam.change.requirement_title}</h1>
                {showRequirement && (
                  <div className="thin-scroll mt-2 max-h-56 overflow-y-auto rounded-md border-2 border-ink bg-panel px-4 py-2">
                    <Prose text={requirementBody} />
                  </div>
                )}
              </div>
            }
          />
        )}
      </main>

      {reveal && <SpotCheckReveal result={reveal.result} name={reveal.name} onContinue={continueAfterReveal} />}
    </div>
  );
}
