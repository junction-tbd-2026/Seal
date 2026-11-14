import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DiffView, type Mark } from "./DiffView";
import { fileName, prettyModel, sameFile } from "./lib";
import { Objectives } from "./Objectives";
import {
  buildSteps,
  clearSaved,
  findFile,
  freshProgress,
  isBlank,
  openProgress,
  readSigner,
  stepLabel,
  stepState,
  storageKey,
  summaryLine,
  writeSaved,
  writeSigner,
  type FindingAnswer,
  type PointAnswer,
  type Progress,
  type Step,
  type StepState,
  type Tone,
} from "./progress";
import { ReviewerTest } from "./ReviewerTest";
import { SignOffStep } from "./SignOff";
import { StepList } from "./StepList";
import { AddedBody, Choice, FindingsBody, PointBody, ProvenBody, SpotsBody } from "./StepPanel";
import type { Exam, Reviewer, SignOff, SpotVerdict } from "./types";

type View = "step" | "whole";

const TONE_CHIP: Record<Tone, string> = {
  verified: "bg-caught text-white",
  unproven: "bg-warn text-ink",
  risk: "bg-missed text-white",
};

/** How long a finished step stays on screen before the next one opens by itself. */
const ADVANCE_MS = 700;

const CONFIRM_OPTIONS: { value: PointAnswer; label: string; good: boolean }[] = [
  { value: "met", label: "Yes, confirm", good: true },
  { value: "not_met", label: "No, I disagree", good: false },
];

const DECIDE_OPTIONS: { value: PointAnswer; label: string; good: boolean }[] = [
  { value: "met", label: "Yes, it is met", good: true },
  { value: "not_met", label: "No, not met", good: false },
  { value: "cannot_tell", label: "Can't tell: needs a run", good: true },
];

/** Sets an answer, or takes it back when the same answer is pressed again. */
function toggled<T extends string>(record: Record<string, T>, id: string, value: T): Record<string, T> {
  const next = { ...record };
  if (next[id] === value) delete next[id];
  else next[id] = value;
  return next;
}

/** The one sentence under the step title that says what to do here. */
function stepTask(step: Step, reviewer: Reviewer): string {
  switch (step.kind) {
    case "objectives":
      return "A model drafted these objectives from the requirement, without seeing the code. Everything after this is measured against them, so the owner of the requirement approves them first: strike what is out of scope, mark what is risky, add what is missing.";
    case "intro":
      return "Before you check anything yourself, see what the reviewer said and whether it could tell real breaks from harmless edits on this change.";
    case "proven":
      return "On these, the reviewer took back \"met\" every time we broke the lines it cites, and never on a harmless edit there. They need no reading; accept them as proven.";
    case "added":
      return "The owner added this objective. The AI never reviewed it, so read the whole change with it in mind and decide.";
    case "point":
      return step.todo;
    case "spots":
      return `${prettyModel(reviewer.name)} missed mistakes we planted here in test copies. Say whether the real code looks right.`;
    case "findings":
      return "These are in the real code, not in our test copies. Say whether each one is a real problem.";
    case "sign":
      return "Put your name on a decision.";
  }
}

/**
 * One pull request as a guided review: the step list on the right, the step being worked
 * on in the middle. It is remounted when the code or the reviewer changes, so checks never
 * carry over to something the person has not looked at.
 */
export function Workspace({
  exam,
  reviewer,
  code,
  signoffs,
  header,
  onReviewer,
  onSign,
  onSaved,
  onReload,
}: {
  exam: Exam;
  reviewer: Reviewer;
  /** Fingerprint of the code on screen. */
  code: string;
  signoffs: SignOff[];
  header: React.ReactNode;
  onReviewer: (name: string) => void;
  onSign: (
    name: string,
    decision: string,
    spots: { plant_id: string; verdict: SpotVerdict }[],
    points: Record<string, string>,
    findings: Record<string, string>,
  ) => Promise<void>;
  /** Called after the saved checks change, so the list of pull requests can show progress. */
  onSaved: () => void;
  /** Reload the pull request, e.g. after the owner approved its objectives. */
  onReload: () => Promise<void>;
}) {
  // Checks belong to the person doing them: the name comes first, and two people never share checks.
  const [signer, setSignerState] = useState(readSigner);
  const [nameDraft, setNameDraft] = useState("");
  const key = signer ? storageKey(exam.change.id, reviewer.name, signer) : null;
  const steps = useMemo(() => buildSteps(exam, reviewer), [exam, reviewer]);
  const [opened, setOpened] = useState(() => openProgress(key, reviewer.run_file, code));
  const [progress, setProgress] = useState<Progress>(opened.progress);
  const [stale, setStale] = useState(opened.stale);
  const summary = summaryLine(exam, reviewer);

  const setSigner = (name: string) => {
    const clean = name.trim();
    writeSigner(clean);
    setSignerState(clean);
    const next = openProgress(clean ? storageKey(exam.change.id, reviewer.name, clean) : null, reviewer.run_file, code);
    // A person who starts now keeps what they did before typing their name.
    const keep = clean && isBlank(next.progress) ? { ...progress } : next.progress;
    setOpened({ progress: next.progress, stale: next.stale });
    setProgress(keep);
    setStale(next.stale);
  };
  const [view, setView] = useState<View>("step");
  const [filePath, setFilePath] = useState<string | null>(() => {
    // Open the whole change on the file the planted edits live in: that is the one worth reading.
    const planted = exam.plants[0]?.file;
    return exam.change.files.find((file) => file.path === planted)?.path ?? exam.change.files[0]?.path ?? null;
  });
  const [focus, setFocus] = useState<{ line: number; token: number } | null>(null);

  const mine = signoffs.filter((entry) => entry.reviewer === reviewer.name);
  const signed = mine[mine.length - 1] ?? null;
  const states: StepState[] = steps.map((item) => stepState(item, progress, signed, exam));
  const done = states.filter((state) => state.done).length;
  const index = Math.max(0, steps.findIndex((item) => item.id === progress.step));
  const step = steps[index];
  const state = states[index];
  const label = stepLabel(step);

  // Checks made on older code or older results are gone for good, not kept for a later visit.
  useEffect(() => {
    if (!opened.stale || !key) return;
    clearSaved(key);
    onSaved();
  }, [opened, key, onSaved]);

  useEffect(() => {
    if (!key || progress === opened.progress) return;
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
  const acceptProven = (ids: string[], accept: boolean) =>
    check((current) => {
      const points = { ...current.points };
      ids.forEach((id) => {
        if (accept) points[id] = "met";
        else delete points[id];
      });
      return { points };
    });
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
            .map((evidence) => ({ start: evidence.line_start, end: evidence.line_end, tone: "evidence", label: `Cited for ${step.point.id}` }))
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
    if (step.kind === "intro" || step.kind === "sign" || step.kind === "objectives") return;
    const timer = window.setTimeout(() => goTo(nextOpen.id), ADVANCE_MS);
    return () => window.clearTimeout(timer);
    // Only a step turning from open to done should move on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, state.done]);

  const question = step.kind === "added" ? "Is this met in the real code?" : step.kind !== "point" ? null : spotsLeft > 0 ? null : "Is this met in the real code?";

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_18.5rem]">
      <section className="flex min-h-0 min-w-0 flex-col bg-panel">
        <div className="border-b border-hair px-8 pb-5 pt-4">
          {header}
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] font-bold">
            <span className={summary.approved ? "" : "text-missed"}>
              {summary.objectives} {summary.objectives === 1 ? "objective" : "objectives"} {summary.approved ? "approved by the owner" : "not approved yet"}
            </span>
            <span className="text-caught">{summary.proven} proven by our test</span>
            <span className="text-missed">{summary.forYou} for you to decide</span>
          </p>
          <p className="mt-4 flex items-center gap-2 text-[12.5px] font-bold text-soft">
            Step {index + 1} of {steps.length}
            {step.kind === "point" && <span className={`rounded-sm px-1.5 py-px text-[11px] ${TONE_CHIP[step.tone]}`}>{step.chip}</span>}
          </p>
          <h1 className="mt-1.5 max-w-3xl text-[22px] font-extrabold leading-tight tracking-tight">
            {step.kind === "point" && <span className="mr-2 font-mono text-[15px] font-bold text-faint">{step.point.id}</span>}
            {label.title}
          </h1>
          <p className="mt-2 max-w-3xl text-[14.5px] leading-snug">
            {step.kind === "point" && <span className="text-soft">{step.why} </span>}
            <span className="font-bold">{stepTask(step, reviewer)}</span>
          </p>
          {step.kind === "point" && step.point.reason && (
            <details className="group mt-2 max-w-3xl text-[13px] leading-snug text-soft">
              <summary className="cursor-pointer list-none font-medium text-faint hover:text-ink">
                <span className="group-open:hidden">Show the reviewer's reasoning</span>
                <span className="hidden group-open:inline">Hide the reviewer's reasoning</span>
              </summary>
              <p className="mt-1 border-l-2 border-hair pl-3">“{step.point.reason}”</p>
            </details>
          )}
        </div>

        {view === "whole" ? (
          <>
            <div className="thin-scroll flex gap-1 overflow-x-auto border-b border-hair bg-canvas px-8 py-2" role="tablist" aria-label="Files in this change">
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
                      active ? "bg-ink text-white" : "text-soft hover:bg-panel hover:text-ink"
                    }`}
                  >
                    {fileName(item.path)}
                    {toRead > 0 && <span className="rounded-sm bg-missed px-1 font-sans text-[10.5px] text-white">{toRead}</span>}
                  </button>
                );
              })}
            </div>
            {file && <DiffView file={file} marks={marks} focus={focus?.line ?? null} key={`${file.path}-${focus?.token ?? 0}`} className="min-h-0 flex-1" />}
          </>
        ) : step.kind === "objectives" ? (
          <Objectives key={exam.approval?.approved_at ?? "draft"} exam={exam} onApproved={onReload} />
        ) : step.kind === "intro" ? (
          <ReviewerTest exam={exam} reviewer={reviewer} signer={signer} nameDraft={nameDraft} onNameDraft={setNameDraft} />
        ) : step.kind === "proven" ? (
          <ProvenBody points={step.points} onOpen={showInWhole} />
        ) : step.kind === "added" ? (
          <AddedBody onWholeChange={() => setView("whole")} />
        ) : step.kind === "point" ? (
          <PointBody key={step.id} step={step} {...shared} onWholeChange={() => setView("whole")} />
        ) : step.kind === "spots" ? (
          <SpotsBody spots={step.spots} {...shared} />
        ) : step.kind === "findings" ? (
          <FindingsBody findings={step.findings} files={exam.change.files} progress={progress} onOpen={showInWhole} onFinding={onFinding} />
        ) : (
          <SignOffStep
            exam={exam}
            reviewer={reviewer}
            progress={progress}
            signer={signer}
            steps={steps.slice(0, -1)}
            states={states.slice(0, -1)}
            mine={mine}
            onGoTo={goTo}
            onSign={(name, decision) =>
              onSign(
                name,
                decision,
                reviewer.read_yourself.filter((id) => progress.spots[id]).map((id) => ({ plant_id: id, verdict: progress.spots[id] })),
                progress.points,
                progress.findings,
              )
            }
          />
        )}

        {step.kind !== "sign" && (
          <div className="flex min-h-[4rem] flex-wrap items-center gap-x-5 gap-y-2 border-t-2 border-ink bg-panel px-8 py-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
              {step.kind === "proven" && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <p className="text-[15px] font-bold">Accept these as proven?</p>
                  <Choice
                    value={state.done ? "yes" : undefined}
                    options={[{ value: "yes", label: "Yes, accept as proven", good: true }]}
                    onPick={() => acceptProven(step.points.map((point) => point.id), !state.done)}
                  />
                </div>
              )}
              {step.kind === "added" && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <p className="text-[15px] font-bold">{question}</p>
                  <Choice value={progress.points[step.objective.id]} options={DECIDE_OPTIONS} onPick={(answer) => onPoint(step.objective.id, answer)} />
                </div>
              )}
              {step.kind === "objectives" && !state.done && <p className="text-[14px] text-soft">The owner approves the objectives above.</p>}
              {step.kind === "point" && question && (
                // Unfolds once the red spots are judged, so there is one thing to do at a time.
                <motion.div
                  key={step.id}
                  initial={step.spots.length > 0 ? { opacity: 0, y: 8 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2"
                >
                  <p className="text-[15px] font-bold">{question}</p>
                  <Choice
                    value={progress.points[step.point.id]}
                    options={step.tone === "verified" ? CONFIRM_OPTIONS : DECIDE_OPTIONS}
                    onPick={(answer) => onPoint(step.point.id, answer)}
                  />
                </motion.div>
              )}
              {(step.kind === "point" || step.kind === "spots") && spotsLeft > 0 && (
                <p className="text-[14px] text-soft">
                  <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-missed" aria-hidden="true" />
                  {view === "whole" ? "Switch back to the review to judge" : "First judge"} {spotsLeft === 1 ? "the red spot" : `the ${spotsLeft} red spots`}
                  {view === "whole" ? "." : " above."}
                </p>
              )}
              {step.kind === "findings" && !state.done && <p className="text-[14px] text-soft">Answer each reported problem above.</p>}
              {state.done && step.kind !== "intro" && step.kind !== "point" && step.kind !== "proven" && step.kind !== "added" && (
                <p className="text-[14px] font-bold text-caught">✓ Done</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-4">
              {index > 0 && (
                <button type="button" onClick={() => goTo(steps[index - 1].id)} className="text-[13px] font-medium text-soft underline-offset-2 hover:text-ink hover:underline">
                  Back
                </button>
              )}
              {step.kind === "intro" ? (
                <button
                  type="button"
                  disabled={!signer && !nameDraft.trim()}
                  title={!signer && !nameDraft.trim() ? "Type your name first" : undefined}
                  onClick={() => {
                    if (!signer) setSigner(nameDraft);
                    if (!progress.intro) check(() => ({ intro: true }));
                    goTo(nextOpen.id);
                  }}
                  className="press rounded-md bg-warn px-4 py-2 text-[14px] font-bold"
                >
                  {progress.intro ? "Continue →" : "Start the review →"}
                </button>
              ) : state.done ? (
                <button type="button" onClick={() => goTo(nextOpen.id)} className="press rounded-md bg-warn px-4 py-2 text-[14px] font-bold">
                  Next →
                </button>
              ) : (
                <button type="button" onClick={() => goTo(steps[index + 1].id)} className="text-[13px] font-medium text-soft underline-offset-2 hover:text-ink hover:underline">
                  Skip for now
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <StepList
        exam={exam}
        reviewer={reviewer}
        steps={steps}
        states={states}
        current={step.id}
        stale={stale}
        view={view}
        onView={setView}
        onGoTo={goTo}
        onReviewer={onReviewer}
        signer={signer}
        onSwitchPerson={() => {
          setSigner("");
          setProgress(freshProgress(reviewer.run_file, code));
          setView("step");
          setProgress((current) => ({ ...current, step: "intro" }));
        }}
        onClear={() => {
          setStale(false);
          setProgress(freshProgress(reviewer.run_file, code));
          setView("step");
        }}
      />
    </div>
  );
}
