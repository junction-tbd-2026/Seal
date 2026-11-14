import { useCallback, useEffect, useMemo, useState } from "react";
import { DiffView } from "./DiffView";
import { Evidence } from "./Evidence";
import { fetchExam, fetchPulls, fileName, prettyModel } from "./lib";
import { Prose } from "./Prose";
import type { Exam, Plant, Pull, PullList, PullStatus, Reviewer, SignOff } from "./types";

const PRODUCT_NAME = "Reviewer Controls";

const STATUS: Record<PullStatus, { label: (pull: Pull) => string; chip: string; dot: string }> = {
  needs_you: {
    label: (pull) => `${pull.lines_to_read} ${pull.lines_to_read === 1 ? "spot" : "spots"} to check yourself`,
    chip: "bg-missed text-white",
    dot: "bg-missed",
  },
  clear: { label: () => "Ready to sign", chip: "bg-caught text-white", dot: "bg-caught" },
  signed: { label: (pull) => `Signed by ${pull.signed?.name ?? "someone"}`, chip: "bg-ink text-white", dot: "bg-ink" },
  untested: { label: () => "Not tested yet", chip: "bg-panel text-soft", dot: "bg-hair" },
};

/** One plain sentence: what the reviewer said about the real code, how it did when tested, and what to do. */
function summarise(reviewer: Reviewer): string {
  const { defects_caught: caught, defects_total: total } = reviewer.counts;
  const said = reviewer.review_failed
    ? "The AI reviewer gave no usable answer on this change."
    : reviewer.findings.length > 0
      ? `The AI reviewer reported ${reviewer.findings.length} ${reviewer.findings.length === 1 ? "problem" : "problems"} in this change.`
      : "The AI reviewer found no problems in this change.";
  const tested =
    total > 0
      ? ` To see what that is worth, we hid ${total} mistakes of our own in copies of it: the reviewer caught ${caught} and missed ${total - caught}.`
      : " The reviewer could not be tested on this change.";
  const spots = reviewer.read_yourself.length;
  const todo =
    spots > 0
      ? ` Check the ${spots} red ${spots === 1 ? "spot" : "spots"} yourself before you sign.`
      : total > 0
        ? " It missed nothing we planted, so there is nothing extra to check."
        : " Treat the change as unreviewed.";
  return said + tested + todo;
}

function PullItem({ pull, active, onSelect }: { pull: Pull; active: boolean; onSelect: () => void }) {
  const status = STATUS[pull.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`w-full rounded-lg border-2 border-ink px-3 py-2.5 text-left transition-[transform,box-shadow] ${
        active ? "bg-warn shadow-[var(--shadow-hard)] -translate-x-0.5 -translate-y-0.5" : "bg-panel hover:bg-canvas"
      }`}
    >
      <span className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wide text-soft">
        <span>
          #{pull.number} · issue {pull.requirement_id}
        </span>
        <span>{pull.files} files</span>
      </span>
      <span className="mt-1 block text-[14px] font-bold leading-snug">{pull.title}</span>
      <span className={`mt-2 inline-block rounded border-2 border-ink px-1.5 py-px text-[11px] font-bold ${status.chip}`}>
        {status.label(pull)}
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
  const [filePath, setFilePath] = useState<string | null>(null);
  const [reviewerName, setReviewerName] = useState<string | null>(null);
  const [signoffs, setSignoffs] = useState<SignOff[]>([]);
  const [focus, setFocus] = useState<{ line: number; token: number } | null>(null);
  const [showRequirement, setShowRequirement] = useState(false);

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

  useEffect(() => {
    if (!pull) return;
    setExam(null);
    setFocus(null);
    setShowRequirement(false);
    if (pull.status === "untested") return;
    setLoadingExam(true);
    fetchExam(pull.change_id)
      .then((data) => {
        setExam(data);
        setSignoffs(data.signoffs);
        setReviewerName(data.reviewers[0]?.name ?? null);
        // Open on the file the planted edits live in: that is the one worth reading.
        const planted = data.plants[0]?.file;
        setFilePath(data.change.files.find((file) => file.path === planted)?.path ?? data.change.files[0]?.path ?? null);
      })
      .catch((problem: Error) => setError(problem.message))
      .finally(() => setLoadingExam(false));
    // Reload only when a different pull request is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pull?.change_id, pull?.status === "untested"]);

  const reviewer = exam?.reviewers.find((item) => item.name === reviewerName) ?? exam?.reviewers[0] ?? null;
  const file = exam?.change.files.find((item) => item.path === filePath) ?? null;

  const marks = useMemo(() => {
    if (!exam || !reviewer || !file) return [];
    const blind = exam.plants
      .filter((plant) => reviewer.read_yourself.includes(plant.id) && plant.file === file.path)
      .map((plant) => ({ start: plant.line_start, end: plant.line_end, tone: "blind" as const }));
    const found = reviewer.findings
      .filter((finding) => file.path.endsWith(finding.file) || finding.file.endsWith(file.path))
      .map((finding) => ({ start: finding.line_start, end: finding.line_end, tone: "finding" as const }));
    return [...blind, ...found];
  }, [exam, reviewer, file]);

  const jumpTo = (plant: Plant) => {
    setFilePath(plant.file);
    setFocus({ line: plant.line_start, token: Date.now() });
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
        <a
          href={pulls.repository_url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-md border-2 border-white/40 px-2.5 py-1 font-mono text-[12px] hover:border-white"
          title="The repository this tool is watching"
        >
          <span className="h-2 w-2 rounded-full bg-caught" /> {pulls.repository}
        </a>
      </header>

      <nav aria-label="Pull requests" className="thin-scroll space-y-6 overflow-y-auto border-r-2 border-ink bg-canvas p-4">
        <p className="text-[12.5px] leading-snug text-soft">
          Pull requests opened by an AI agent. Each one is reviewed by an AI, and that reviewer is tested before you sign.
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
              <p className="mt-2 text-soft">
                Testing plants known defects in copies of the change and checks which ones the AI reviewer catches. Run it from the project folder:
              </p>
              <code className="mt-3 block overflow-x-auto rounded-md border-2 border-ink bg-canvas p-2.5 font-mono text-[12px]">
                .venv/bin/python -m reviewer_controls.pipeline --change {pull.change_id} --kinds bug omission harmless
              </code>
              <button type="button" onClick={() => void loadPulls()} className="press mt-4 rounded-md bg-warn px-3 py-1.5 text-[13px] font-bold">
                Check again
              </button>
            </div>
          </div>
        ) : !exam || !reviewer || loadingExam ? (
          <p className="p-10 text-soft">Loading the review…</p>
        ) : (
          <div className="grid h-full grid-cols-[minmax(0,1fr)_23rem]">
            <section className="flex min-h-0 min-w-0 flex-col">
              <div className="border-b-2 border-ink bg-panel px-5 py-3.5">
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
                </div>
                <h1 className="mt-1 text-[22px] font-extrabold leading-tight tracking-tight">{exam.change.requirement_title}</h1>
                <p className="mt-2 max-w-4xl rounded-md border-2 border-ink bg-warn-wash px-3 py-2 text-[14px] font-medium leading-snug">
                  {summarise(reviewer)}
                </p>
                <button
                  type="button"
                  onClick={() => setShowRequirement(!showRequirement)}
                  aria-expanded={showRequirement}
                  className="mt-1.5 text-[13px] font-bold text-brand underline decoration-2 underline-offset-2"
                >
                  {showRequirement ? "Hide the requirement" : "Read the requirement"}
                </button>
                {showRequirement && (
                  <div className="thin-scroll mt-2 max-h-64 overflow-y-auto rounded-md border-2 border-ink bg-canvas px-4 py-2">
                    <Prose text={requirementBody} />
                  </div>
                )}
              </div>

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

              <p className="border-t-2 border-ink bg-panel px-5 py-2 text-[12.5px] text-soft">
                <span className="mr-1.5 inline-block h-3 w-1.5 translate-y-0.5 bg-missed" />
                <strong>Red is not a known bug.</strong> It is a spot where {prettyModel(reviewer.name)} missed a mistake we planted in a copy, so its
                “no problems” can’t be trusted there.
                <span className="ml-4 mr-1.5 inline-block h-3 w-1.5 translate-y-0.5 bg-warn" />
                Yellow is a problem the reviewer itself reported in the real code.
              </p>
            </section>

            <Evidence
              key={`${exam.change.id}-${reviewer.name}`}
              exam={exam}
              reviewer={reviewer}
              onReviewer={setReviewerName}
              signoffs={signoffs}
              onSigned={(entry) => {
                setSignoffs((current) => [...current, entry]);
                void loadPulls();
              }}
              onJump={jumpTo}
            />
          </div>
        )}
      </main>
    </div>
  );
}
