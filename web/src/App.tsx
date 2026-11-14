import { useEffect, useMemo, useRef, useState } from "react";
import { Board } from "./Board";
import { Card } from "./Card";
import { DiffView } from "./DiffView";
import { fetchChanges, fetchExam, fileName, prettyModel } from "./lib";
import { Prose } from "./Prose";
import type { ChangeSummary, Exam, Plant, SignOff } from "./types";

const PRODUCT_NAME = "Reviewer Controls";

function Step({ number, title, lead, children, id }: { number: string; title: string; lead?: string; children: React.ReactNode; id: string }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-rule py-14">
      <div className="mb-6">
        <p className="font-mono text-[0.8rem] text-faint">{number}</p>
        <h2 className="mt-1 font-serif text-[2rem] leading-tight">{title}</h2>
        {lead && <p className="mt-2 max-w-2xl text-soft">{lead}</p>}
      </div>
      {children}
    </section>
  );
}

function Tabs<T extends string>({ items, value, onChange, label }: { items: { value: T; label: string; hint?: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1">
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          type="button"
          aria-selected={item.value === value}
          onClick={() => onChange(item.value)}
          title={item.hint}
          className={`rounded px-3 py-1.5 text-[0.88rem] transition-colors ${
            item.value === value ? "bg-ink text-sheet" : "text-soft hover:bg-rule/60 hover:text-ink"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [changes, setChanges] = useState<ChangeSummary[] | null>(null);
  const [changeId, setChangeId] = useState<string | null>(null);
  const [exam, setExam] = useState<Exam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [reviewerName, setReviewerName] = useState<string | null>(null);
  const [signoffs, setSignoffs] = useState<SignOff[]>([]);
  const [focus, setFocus] = useState<{ line: number; token: number } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const changeSection = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchChanges()
      .then((list) => {
        setChanges(list);
        if (list.length > 0) setChangeId((current) => current ?? list[0].id);
      })
      .catch((problem: Error) => setError(problem.message));
  }, []);

  useEffect(() => {
    if (!changeId) return;
    setExam(null);
    fetchExam(changeId)
      .then((data) => {
        setExam(data);
        setSignoffs(data.signoffs);
        setReviewerName(data.reviewers[0]?.name ?? null);
        // Open on the file the planted edits live in: that is the one worth reading.
        const planted = data.plants[0]?.file;
        setFilePath(data.change.files.find((file) => file.path === planted)?.path ?? data.change.files[0]?.path ?? null);
        setShowAll(false);
      })
      .catch((problem: Error) => setError(problem.message));
  }, [changeId]);

  const reviewer = exam?.reviewers.find((item) => item.name === reviewerName) ?? exam?.reviewers[0] ?? null;
  const file = exam?.change.files.find((item) => item.path === filePath) ?? null;

  // Lines the selected reviewer missed a planted defect on, in the file being shown.
  const marks = useMemo(() => {
    if (!exam || !reviewer || !file) return [];
    return exam.plants
      .filter((plant) => reviewer.read_yourself.includes(plant.id) && plant.file === file.path)
      .map((plant) => ({ start: plant.line_start, end: plant.line_end }));
  }, [exam, reviewer, file]);

  const jumpTo = (plant: Plant) => {
    setFilePath(plant.file);
    setFocus({ line: plant.line_start, token: Date.now() });
    changeSection.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24">
        <h1 className="font-serif text-[2rem]">The page could not load its data</h1>
        <p className="mt-3 text-soft">{error}</p>
        <p className="mt-3 text-soft">
          Start the backend with <code className="font-mono text-[0.9em]">PYTHONPATH=src .venv/bin/uvicorn reviewer_controls.server:app --port 8000</code> and reload.
        </p>
      </main>
    );
  }

  if (changes && changes.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-24">
        <h1 className="font-serif text-[2rem]">No runs yet</h1>
        <p className="mt-3 text-soft">Run the pipeline on a change and its results will appear here.</p>
      </main>
    );
  }

  if (!exam || !changes) {
    return <main className="mx-auto max-w-2xl px-6 py-24 text-soft">Loading the latest run…</main>;
  }

  const totals = exam.change.files.reduce((sum, item) => ({ added: sum.added + item.added, removed: sum.removed + item.removed }), { added: 0, removed: 0 });
  const requirementBody = exam.change.requirement_text.split("\n").slice(1).join("\n").replace(/^\s*Source:.*$/m, "").trim();
  const longRequirement = requirementBody.length > 900;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-rule bg-paper/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
          <a href="#top" className="font-serif text-[1.15rem] tracking-tight">
            {PRODUCT_NAME}
          </a>
          <nav aria-label="Sections" className="flex gap-5 text-[0.88rem] text-soft">
            <a className="hover:text-ink" href="#change">The change</a>
            <a className="hover:text-ink" href="#test">The test</a>
            <a className="hover:text-ink" href="#card">The card</a>
          </nav>
          {changes.length > 1 && (
            <label className="flex items-center gap-2 text-[0.85rem] text-soft">
              Change
              <select
                value={exam.change.id}
                onChange={(event) => setChangeId(event.target.value)}
                className="rounded border border-rule bg-sheet px-2 py-1 text-ink"
              >
                {changes.map((change) => (
                  <option key={change.id} value={change.id}>
                    #{change.requirement_id} {change.title.slice(0, 48)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      <main id="top" className="mx-auto max-w-6xl px-6">
        <section className="py-16">
          <p className="max-w-3xl font-serif text-[2.6rem] leading-[1.12] tracking-tight">
            An AI reviewer said this change looks good. We planted bugs in it to find out what that is worth.
          </p>
          <p className="mt-5 max-w-2xl text-[1.05rem] text-soft">
            Every review is tested on copies of the same change with known defects. The person who signs gets the
            reviewer’s findings, what it missed, and the lines to read personally.
          </p>
        </section>

        <div ref={changeSection}>
          <Step id="change" number="01" title="The change" lead="An AI agent wrote this change to meet one requirement. This is what a human is asked to approve.">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div>
                <p className="text-[0.8rem] uppercase tracking-wider text-faint">Requirement #{exam.change.requirement_id}</p>
                <h3 className="mt-1 font-serif text-[1.4rem] leading-snug">{exam.change.requirement_title}</h3>
                <div className={`relative mt-2 ${longRequirement && !showAll ? "max-h-[22rem] overflow-hidden" : ""}`}>
                  <Prose text={requirementBody} />
                  {longRequirement && !showAll && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-paper to-transparent" />
                  )}
                </div>
                {longRequirement && (
                  <button type="button" onClick={() => setShowAll(!showAll)} className="mt-2 text-[0.9rem] text-accent underline-offset-4 hover:underline">
                    {showAll ? "Show less" : "Read the whole requirement"}
                  </button>
                )}
              </div>

              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <Tabs
                    label="Files in this change"
                    value={file?.path ?? ""}
                    onChange={(path) => {
                      setFilePath(path);
                      setFocus(null);
                    }}
                    items={exam.change.files.map((item) => ({ value: item.path, label: fileName(item.path), hint: item.path }))}
                  />
                  <p className="text-[0.82rem] text-faint">
                    {exam.change.files.length} files · <span className="text-caught">+{totals.added}</span>{" "}
                    <span className="text-missed">−{totals.removed}</span>
                  </p>
                </div>
                {file && <DiffView file={file} marks={marks} focus={focus?.line ?? null} key={`${file.path}-${focus?.token ?? 0}`} />}
                {marks.length > 0 && reviewer && (
                  <p className="mt-2 text-[0.85rem] text-soft">
                    <span className="mr-1 inline-block h-3 w-[3px] translate-y-[2px] bg-missed" /> Lines where{" "}
                    {prettyModel(reviewer.name)} missed a planted defect.
                  </p>
                )}
              </div>
            </div>
          </Step>
        </div>

        <Step id="test" number="02" title="The test" lead="Before trusting the review, test the reviewer on this exact change.">
          <Board exam={exam} key={exam.change.id + exam.created_at} />
        </Step>

        <Step id="card" number="03" title="The card" lead="What a named person signs, in place of reading every line.">
          <div className="mb-6 flex justify-center">
            <Tabs
              label="Reviewer"
              value={reviewer?.name ?? ""}
              onChange={setReviewerName}
              items={exam.reviewers.map((item) => ({ value: item.name, label: prettyModel(item.name), hint: item.name }))}
            />
          </div>
          {reviewer && (
            <Card
              exam={exam}
              reviewer={reviewer}
              signoffs={signoffs}
              onSigned={(entry) => setSignoffs((current) => [...current, entry])}
              onJump={jumpTo}
            />
          )}
        </Step>
      </main>

      <footer className="mt-10 border-t border-rule">
        <div className="mx-auto max-w-6xl px-6 py-8 text-[0.85rem] text-faint">
          Built at Junction 2026 for Tieto’s challenge, Earned Trust in AI Code. Planted defects were written by{" "}
          {prettyModel(exam.planter)}.
        </div>
      </footer>
    </div>
  );
}
