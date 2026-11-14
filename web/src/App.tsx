import { useCallback, useEffect, useMemo, useState } from "react";
import { DiffView, type Mark } from "./DiffView";
import { Evidence } from "./Evidence";
import { fetchPulls, fetchReview, fileName, postSignOff, prettyModel } from "./lib";
import { Prose } from "./Prose";
import { RequirementTable } from "./RequirementTable";
import { SpotCheckReveal } from "./SpotCheck";
import type { EvidenceRef, Exam, Plant, Pull, PullList, PullStatus, Reviewer, SignOff, SignResult } from "./types";

const PRODUCT_NAME = "Reviewer Controls";

const STATUS: Record<PullStatus, { label: (pull: Pull) => string; chip: string }> = {
  needs_you: {
    label: (pull) => `${pull.lines_to_read} ${pull.lines_to_read === 1 ? "spot" : "spots"} to check yourself`,
    chip: "bg-missed text-white",
  },
  clear: { label: () => "Ready to sign", chip: "bg-caught text-white" },
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
      ? ` Check the ${spots} red ${spots === 1 ? "spot" : "spots"} yourself before you sign.`
      : total > 0
        ? " It missed nothing, so there is nothing extra to check."
        : " Treat the change as unreviewed.";
  return said + tested + todo;
}

function sameFile(a: string, b: string): boolean {
  return a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
}

function PullItem({ pull, active, onSelect }: { pull: Pull; active: boolean; onSelect: () => void }) {
  const status = STATUS[pull.status];
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
      <span className={`mt-2 inline-block rounded border-2 border-ink px-1.5 py-px text-[11px] font-bold ${status.chip}`}>{status.label(pull)}</span>
    </button>
  );
}

export default function App() {
  const [pulls, setPulls] = useState<PullList | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [exam, setExam] = useState<Exam | null>(null);
  const [loadingExam, setLoadingExam] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [reviewerName, setReviewerName] = useState<string | null>(null);
  const [signoffs, setSignoffs] = useState<SignOff[]>([]);
  const [focus, setFocus] = useState<{ line: number; token: number } | null>(null);
  const [cited, setCited] = useState<{ pointId: string; evidence: EvidenceRef } | null>(null);
  const [showRequirement, setShowRequirement] = useState(false);
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [showPoints, setShowPoints] = useState(true);
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
        if (!keepView) {
          setReviewerName(data.reviewers[0]?.name ?? null);
          // Open on the file the planted edits live in: that is the one worth reading.
          const planted = data.plants[0]?.file;
          setFilePath(data.change.files.find((file) => file.path === planted)?.path ?? data.change.files[0]?.path ?? null);
        }
      })
      .catch((problem: Error) => setError(problem.message))
      .finally(() => setLoadingExam(false));
  }, []);

  useEffect(() => {
    if (!pull) return;
    setExam(null);
    setFocus(null);
    setCited(null);
    setVisited(new Set());
    setShowRequirement(false);
    if (pull.status !== "untested") void loadReview(pull.change_id, false);
    // Reload only when a different pull request is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pull?.change_id, pull?.status === "untested"]);

  const reviewer = exam?.reviewers.find((item) => item.name === reviewerName) ?? exam?.reviewers[0] ?? null;
  const file = exam?.change.files.find((item) => item.path === filePath) ?? null;

  const marks = useMemo<Mark[]>(() => {
    if (!exam || !reviewer || !file) return [];
    const blind: Mark[] = exam.plants
      .filter((plant) => reviewer.read_yourself.includes(plant.id) && plant.file === file.path)
      .map((plant) => ({ start: plant.line_start, end: plant.line_end, tone: "blind" }));
    const found: Mark[] = reviewer.findings
      .filter((finding) => sameFile(file.path, finding.file))
      .map((finding) => ({ start: finding.line_start, end: finding.line_end, tone: "finding" }));
    const evidence: Mark[] =
      cited && sameFile(file.path, cited.evidence.file)
        ? [{ start: cited.evidence.line_start, end: cited.evidence.line_end, tone: "evidence", label: `Cited for ${cited.pointId}` }]
        : [];
    return [...blind, ...found, ...evidence];
  }, [exam, reviewer, file, cited]);

  const jumpToPlant = (plant: Plant) => {
    setVisited((current) => new Set(current).add(plant.id));
    setCited(null);
    setFilePath(plant.file);
    setFocus({ line: plant.line_start, token: Date.now() });
  };

  const jumpToEvidence = (pointId: string, evidence: EvidenceRef) => {
    const target = exam?.change.files.find((item) => sameFile(item.path, evidence.file));
    if (!target) return;
    setCited({ pointId, evidence });
    setFilePath(target.path);
    setFocus({ line: evidence.line_start, token: Date.now() });
  };

  const sign = async (name: string, decision: string) => {
    if (!exam?.session || !reviewer) throw new Error("This review session has ended. Reload the pull request.");
    const result = await postSignOff({ session: exam.session, reviewer: reviewer.name, name, decision });
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
    if (exam) void loadReview(exam.change.id, true);
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
          <div className="grid h-full grid-cols-[minmax(0,1fr)_23rem]">
            <section className="flex min-h-0 min-w-0 flex-col">
              <div className="border-b-2 border-ink bg-panel px-5 py-3">
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
                <p className="mt-2 max-w-4xl rounded-md border-2 border-ink bg-warn-wash px-3 py-1.5 text-[13.5px] font-medium leading-snug">{summarise(reviewer)}</p>
                {showRequirement && (
                  <div className="thin-scroll mt-2 max-h-56 overflow-y-auto rounded-md border-2 border-ink bg-canvas px-4 py-2">
                    <Prose text={requirementBody} />
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowPoints(!showPoints)}
                aria-expanded={showPoints}
                className="flex items-center justify-between border-b-2 border-ink bg-canvas px-5 py-1 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-soft hover:text-ink"
              >
                <span>The requirement, point by point ({reviewer.points.length})</span>
                <span>{showPoints ? "Hide" : "Show"}</span>
              </button>
              {showPoints && <RequirementTable reviewer={reviewer} selected={cited?.pointId ?? null} onEvidence={jumpToEvidence} />}

              <div className="thin-scroll flex gap-1.5 overflow-x-auto border-b-2 border-ink bg-canvas px-3 py-2" role="tablist" aria-label="Files in this change">
                {exam.change.files.map((item) => {
                  const toRead = exam.plants.filter((plant) => plant.file === item.path && reviewer.read_yourself.includes(plant.id)).length;
                  const active = item.path === file?.path;
                  return (
                    <button
                      key={item.path}
                      role="tab"
                      type="button"
                      aria-selected={active}
                      title={item.path}
                      onClick={() => {
                        setFilePath(item.path);
                        setFocus(null);
                      }}
                      className={`flex shrink-0 items-center gap-1.5 rounded-md border-2 border-ink px-2.5 py-1 font-mono text-[12px] font-bold ${
                        active ? "bg-ink text-white" : "bg-panel hover:bg-brand-wash"
                      }`}
                    >
                      {fileName(item.path)}
                      {toRead > 0 && <span className="rounded-sm bg-missed px-1 font-sans text-[10.5px] text-white">{toRead}</span>}
                    </button>
                  );
                })}
              </div>

              {file && <DiffView file={file} marks={marks} focus={focus?.line ?? null} key={`${file.path}-${focus?.token ?? 0}`} className="min-h-0 flex-1" />}

              <p className="border-t-2 border-ink bg-panel px-5 py-2 text-[12px] text-soft">
                <span className="mr-1.5 inline-block h-3 w-1.5 translate-y-0.5 bg-missed" />
                <strong className="text-ink">Red is not a known bug.</strong> {prettyModel(reviewer.name)} failed to notice when we broke the code there, so check it yourself.
                <span className="ml-3 mr-1.5 inline-block h-3 w-1.5 translate-y-0.5 bg-brand" />
                Blue: lines the reviewer cites as evidence.
                <span className="ml-3 mr-1.5 inline-block h-3 w-1.5 translate-y-0.5 bg-warn" />
                Yellow: a problem the reviewer reported.
              </p>
            </section>

            <Evidence
              key={exam.change.id}
              exam={exam}
              reviewer={reviewer}
              onReviewer={(name) => {
                setReviewerName(name);
                setVisited(new Set());
                setCited(null);
              }}
              signoffs={signoffs}
              visited={visited}
              onSign={sign}
              onJump={jumpToPlant}
            />
          </div>
        )}
      </main>

      {reveal && <SpotCheckReveal result={reveal.result} name={reveal.name} onContinue={continueAfterReveal} />}
    </div>
  );
}
