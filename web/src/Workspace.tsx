import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DiffView, type Mark } from "./DiffView";
import { COLUMN, fileName, objectiveName, prettyModel, sameFile } from "./lib";
import {
  buildSteps,
  clearSaved,
  findFile,
  freshProgress,
  isBlank,
  openProgress,
  pointCards,
  stepLabel,
  stepState,
  storageKey,
  writeSaved,
  type FindingAnswer,
  type PointAnswer,
  type PointStep,
  type Progress,
  type Step,
  type StepState,
  type Tone,
} from "./progress";
import { ReviewerTest } from "./ReviewerTest";
import { SignOffStep } from "./SignOff";
import { StepNav, type View } from "./StepNav";
import { Choice, FindingsBody, PointBody, SpotsBody } from "./StepPanel";
import type { Exam, Reviewer, SignOff, SpotVerdict } from "./types";

const TONE_TEXT: Record<Tone, string> = { verified: "text-caught", unproven: "text-ink", risk: "text-missed" };

/** How long a finished step stays on screen before the next step opens by itself. */
const ADVANCE_MS = 700;

/** Sets an answer, or takes it back when the same answer is pressed again. */
function toggled<T extends string>(record: Record<string, T>, id: string, value: T): Record<string, T> {
  const next = { ...record };
  if (next[id] === value) delete next[id];
  else next[id] = value;
  return next;
}

/** How many separate places the AI reviewer cites as evidence for an objective. */
function citedCount(step: PointStep): number {
  return pointCards(step).filter((card) => card.cited).length;
}

/** What the person does on an objective, as numbered actions with nothing left to interpret. */
function auditTasks(step: PointStep): string[] {
  const objective = objectiveName(step.point.id);
  const cited = citedCount(step);
  const tasks: string[] = [];
  if (step.spots.length > 0) {
    tasks.push(`Judge the real code at ${step.spots.length === 1 ? "the red line" : `each of the ${step.spots.length} red lines`}.`);
  }
  if (step.claimsMet && cited > 0) {
    tasks.push(`Read the ${cited === 1 ? "cited reference" : `${cited} cited references`}.`);
    tasks.push(`Decide whether the cited code proves that the change meets ${objective}.`);
  } else {
    tasks.push("Read the full change.");
    tasks.push(`Decide whether the change meets ${objective}.`);
  }
  return tasks;
}

/** The question in the bottom bar: exactly what the person rules on. */
function auditQuestion(step: PointStep): string {
  const objective = objectiveName(step.point.id);
  return step.claimsMet && citedCount(step) > 0 ? `Does the cited code prove that the change meets ${objective}?` : `Does the change meet ${objective}?`;
}

/** The one instruction under the title of a step that is not an objective. */
function stepTask(step: Step, exam: Exam, reviewer: Reviewer): string {
  const model = prettyModel(reviewer.name);
  switch (step.kind) {
    case "intro":
      return `An AI agent wrote the pull request. ${model} reviewed the pull request against the requirement (issue ${exam.change.requirement_id}). You check whether the review by ${model} can be trusted, then you sign.`;
    case "spots":
      return "The code below is the real code. In test copies, the AI reviewer missed a planted mistake at each red line. Judge whether the real code at each red line is correct.";
    case "findings":
      return "The AI reviewer reported the problems below in the real code. Judge whether each reported problem is real.";
    case "sign":
      return "Decide on the pull request and put your name on the decision.";
    case "point":
      return "";
  }
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3">
      <dt className="text-[12.5px] font-bold text-soft">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * One pull request as a guided audit of its AI review: the step being worked on in a centred
 * column, and a bottom bar with the progress indicator and the question of the step. It is
 * remounted when the code or the AI reviewer changes, so checks never carry over to something
 * the person has not looked at.
 */
export function Workspace({
  exam,
  reviewer,
  code,
  signoffs,
  header,
  onSign,
  onSaved,
}: {
  exam: Exam;
  reviewer: Reviewer;
  /** Fingerprint of the code on screen. */
  code: string;
  signoffs: SignOff[];
  header: React.ReactNode;
  onSign: (name: string, decision: string, spots: { plant_id: string; verdict: SpotVerdict }[]) => Promise<void>;
  /** Called after the saved checks change, so the list of pull requests can show progress. */
  onSaved: () => void;
}) {
  const key = storageKey(exam.change.id, reviewer.name);
  const steps = useMemo(() => buildSteps(exam, reviewer), [exam, reviewer]);
  const [opened] = useState(() => openProgress(key, reviewer.run_file, code));
  const [progress, setProgress] = useState<Progress>(opened.progress);
  const [stale, setStale] = useState(opened.stale);
  const [view, setView] = useState<View>("step");
  const [filePath, setFilePath] = useState<string | null>(() => {
    // Open the whole change on the file the planted edits live in: that is the one worth reading.
    const planted = exam.plants[0]?.file;
    return exam.change.files.find((file) => file.path === planted)?.path ?? exam.change.files[0]?.path ?? null;
  });
  const [focus, setFocus] = useState<{ line: number; token: number } | null>(null);

  const mine = signoffs.filter((entry) => entry.reviewer === reviewer.name);
  const signed = mine[mine.length - 1] ?? null;
  const states: StepState[] = steps.map((item) => stepState(item, progress, signed));
  const done = states.filter((state) => state.done).length;
  const index = Math.max(0, steps.findIndex((item) => item.id === progress.step));
  const step = steps[index];
  const state = states[index];
  const label = stepLabel(step);

  // Checks made on older code or older results are gone for good, not kept for a later visit.
  useEffect(() => {
    if (!opened.stale) return;
    clearSaved(key);
    onSaved();
  }, [opened, key, onSaved]);

  useEffect(() => {
    if (progress === opened.progress) return;
    if (isBlank(progress)) clearSaved(key);
    else writeSaved(key, { ...progress, done, total: steps.length, savedAt: new Date().toISOString() });
    onSaved();
  }, [progress, opened, key, done, steps.length, onSaved]);

  const check = (change: (current: Progress) => Partial<Progress>) => {
    setStale(false);
    setProgress((current) => ({ ...current, ...change(current) }));
  };
  const goTo = (stepId: string) => {
    setProgress((current) => ({ ...current, step: stepId }));
    setView("step");
  };
  const onSpot = (plantId: string, verdict: SpotVerdict) => check((current) => ({ spots: toggled(current.spots, plantId, verdict) }));
  const onPoint = (pointId: string, answer: PointAnswer) => check((current) => ({ points: toggled(current.points, pointId, answer) }));
  const onFinding = (findingId: string, answer: FindingAnswer) => check((current) => ({ findings: toggled(current.findings, findingId, answer) }));

  const showInWhole = (path: string, line: number) => {
    const target = findFile(exam.change.files, path);
    if (!target) return;
    setFilePath(target.path);
    setFocus({ line, token: Date.now() });
    setView("whole");
  };

  const file = exam.change.files.find((item) => item.path === filePath) ?? null;
  const marks = useMemo<Mark[]>(() => {
    if (!file) return [];
    const blind: Mark[] = exam.plants
      .filter((plant) => reviewer.read_yourself.includes(plant.id) && sameFile(file.path, plant.file))
      .map((plant) => ({ start: plant.line_start, end: plant.line_end, tone: "blind" }));
    const found: Mark[] = reviewer.findings
      .filter((finding) => sameFile(file.path, finding.file))
      .map((finding) => ({ start: finding.line_start, end: finding.line_end, tone: "finding" }));
    const cited: Mark[] =
      step.kind === "point"
        ? step.point.evidence
            .filter((evidence) => sameFile(file.path, evidence.file))
            .map((evidence) => ({ start: evidence.line_start, end: evidence.line_end, tone: "evidence", label: `Evidence for ${objectiveName(step.point.id)}` }))
        : [];
    return [...blind, ...found, ...cited];
  }, [exam, reviewer, file, step]);

  const spotsLeft = step.kind === "point" || step.kind === "spots" ? step.spots.filter((plant) => !progress.spots[plant.id]).length : 0;
  const shared = { files: exam.change.files, progress, onOpen: showInWhole, onSpot };

  // Finishing a step opens the next unfinished one by itself, after a moment to see the answer land.
  const nextOpen = steps.slice(index + 1).find((_, offset) => !states[index + 1 + offset].done) ?? steps[steps.length - 1];
  const seen = useRef({ step: step.id, done: state.done });
  useEffect(() => {
    const before = seen.current;
    seen.current = { step: step.id, done: state.done };
    if (before.step !== step.id || before.done || !state.done) return;
    if (step.kind === "intro" || step.kind === "sign") return;
    const timer = window.setTimeout(() => goTo(nextOpen.id), ADVANCE_MS);
    return () => window.clearTimeout(timer);
    // Only a step turning from open to done should move on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, state.done]);

  const clear = () => {
    setStale(false);
    setProgress(freshProgress(reviewer.run_file, code));
    setView("step");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="border-b border-hair">
        <div className={`${COLUMN} pb-5 pt-4`}>
          {header}
          {stale && (
            <p role="status" className="mt-3 rounded-md bg-warn-wash px-3 py-1.5 text-[12.5px] font-medium">
              The code or the results of the AI reviewer changed since your last visit. Your earlier audit was cleared.
            </p>
          )}

          {step.kind === "point" ? (
            <div className="mt-5 grid gap-x-10 gap-y-4 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
              <div>
                <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-soft">
                  {label.eyebrow} · step {index + 1} of {steps.length}
                </p>
                {/* Long objectives stay readable at about eight words a line. */}
                <h1 className="mt-1.5 text-[17px] font-bold leading-snug">{label.title}</h1>
              </div>
              <dl className="space-y-2.5 text-[13.5px] leading-snug">
                <Row term="AI reviewer claims">
                  <span className="font-bold">{step.claim}</span>
                  {step.point.reason && (
                    <details className="group mt-0.5 text-[12.5px] text-soft">
                      <summary className="cursor-pointer list-none text-faint hover:text-ink">
                        <span className="group-open:hidden">Show the reasoning of the AI reviewer</span>
                        <span className="hidden group-open:inline">Hide the reasoning of the AI reviewer</span>
                      </summary>
                      <p className="mt-1 border-l-2 border-hair pl-3">“{step.point.reason}”</p>
                    </details>
                  )}
                </Row>
                <Row term="Test of the claim">
                  <span className={`font-bold ${TONE_TEXT[step.tone]}`}>{step.test.verdict}.</span> {step.test.detail}
                </Row>
                <Row term="Your audit">
                  <ol className="list-decimal space-y-0.5 pl-4 font-medium">
                    {auditTasks(step).map((task) => (
                      <li key={task}>{task}</li>
                    ))}
                  </ol>
                </Row>
              </dl>
            </div>
          ) : (
            <div className="mt-5">
              <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-soft">
                {label.eyebrow} · step {index + 1} of {steps.length}
              </p>
              <h1 className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight">{label.title}</h1>
              <p className="mt-2 max-w-[44rem] text-[14px] leading-snug">{stepTask(step, exam, reviewer)}</p>
            </div>
          )}
        </div>
      </div>

      {view === "whole" ? (
        <div className="flex min-h-0 flex-1 flex-col bg-canvas">
          <div className={`${COLUMN} flex min-h-0 flex-1 flex-col py-4`}>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border-2 border-ink bg-panel">
              <div className="thin-scroll flex gap-1 overflow-x-auto border-b border-hair px-3 py-2" role="tablist" aria-label="Files in the change">
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
                      className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[12px] font-bold ${
                        active ? "bg-ink text-white" : "text-soft hover:bg-canvas hover:text-ink"
                      }`}
                    >
                      {fileName(item.path)}
                      {toRead > 0 && <span className="rounded-sm bg-missed px-1 font-sans text-[10.5px] text-white">{toRead}</span>}
                    </button>
                  );
                })}
              </div>
              {file && <DiffView file={file} marks={marks} focus={focus?.line ?? null} key={`${file.path}-${focus?.token ?? 0}`} className="min-h-0 flex-1" />}
            </div>
          </div>
        </div>
      ) : step.kind === "intro" ? (
        <ReviewerTest exam={exam} reviewer={reviewer} steps={steps} />
      ) : step.kind === "point" ? (
        <PointBody key={step.id} step={step} {...shared} onWholeChange={() => setView("whole")} />
      ) : step.kind === "spots" ? (
        <SpotsBody spots={step.spots} {...shared} />
      ) : step.kind === "findings" ? (
        <FindingsBody findings={step.findings} files={exam.change.files} progress={progress} onOpen={showInWhole} onFinding={onFinding} />
      ) : (
        <SignOffStep
          steps={steps.slice(0, -1)}
          states={states.slice(0, -1)}
          mine={mine}
          onGoTo={goTo}
          onClear={clear}
          onSign={(name, decision) =>
            onSign(
              name,
              decision,
              reviewer.read_yourself.filter((id) => progress.spots[id]).map((id) => ({ plant_id: id, verdict: progress.spots[id] })),
            )
          }
        />
      )}

      <div className="border-t-2 border-ink bg-panel">
        <div className={`${COLUMN} py-3`}>
          <StepNav steps={steps} states={states} current={step.id} view={view} onView={setView} onGoTo={goTo} />

          {step.kind !== "sign" && (
            <div className="mt-3 flex min-h-[3.25rem] flex-wrap items-center gap-x-5 gap-y-2 border-t border-hair pt-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
                {step.kind === "point" && spotsLeft === 0 && (
                  // Unfolds once the red lines are judged, so there is one thing to do at a time.
                  <motion.div
                    key={step.id}
                    initial={step.spots.length > 0 ? { opacity: 0, y: 8 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2"
                  >
                    <p className="text-[15px] font-bold">{auditQuestion(step)}</p>
                    <Choice
                      value={progress.points[step.point.id]}
                      options={[
                        { value: "met", label: `Yes, ${objectiveName(step.point.id)} is met`, short: "Yes", good: true },
                        { value: "not_met", label: `No, ${objectiveName(step.point.id)} is not met`, short: "No", good: false },
                      ]}
                      onPick={(answer) => onPoint(step.point.id, answer)}
                    />
                  </motion.div>
                )}
                {(step.kind === "point" || step.kind === "spots") && spotsLeft > 0 && (
                  <p className="text-[14px] font-medium">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-missed" aria-hidden="true" />
                    {view === "whole" ? "Switch to “Review” and judge" : "First judge"} the real code at{" "}
                    {spotsLeft === 1 ? "the red line" : `the ${spotsLeft} red lines`}.
                  </p>
                )}
                {step.kind === "findings" && !state.done && <p className="text-[14px] font-medium">Judge every reported problem.</p>}
                {state.done && (step.kind === "spots" || step.kind === "findings") && <p className="text-[14px] font-bold text-caught">✓ Step done</p>}
              </div>
              <div className="flex shrink-0 items-center gap-4">
                {index > 0 && (
                  <button type="button" onClick={() => goTo(steps[index - 1].id)} className="text-[13px] font-medium text-soft underline-offset-2 hover:text-ink hover:underline">
                    Previous step
                  </button>
                )}
                {step.kind === "intro" ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!progress.intro) check(() => ({ intro: true }));
                      goTo(nextOpen.id);
                    }}
                    className="press rounded-md bg-warn px-4 py-2 text-[14px] font-bold"
                  >
                    {progress.intro ? "Continue the audit →" : "Start the audit →"}
                  </button>
                ) : state.done ? (
                  <button type="button" onClick={() => goTo(nextOpen.id)} className="press rounded-md bg-warn px-4 py-2 text-[14px] font-bold">
                    Next step →
                  </button>
                ) : (
                  <button type="button" onClick={() => goTo(steps[index + 1].id)} className="text-[13px] font-medium text-soft underline-offset-2 hover:text-ink hover:underline">
                    Skip the step
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
