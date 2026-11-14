import { useEffect, useMemo, useState } from "react";
import { DiffView, type Mark } from "./DiffView";
import { fileName, prettyModel, sameFile } from "./lib";
import {
  buildSteps,
  clearSaved,
  findFile,
  freshProgress,
  isBlank,
  openProgress,
  stepLabel,
  stepState,
  storageKey,
  writeSaved,
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
import { Choice, FindingsBody, PointBody, SpotsBody } from "./StepPanel";
import type { Exam, PointStatus, Reviewer, SignOff, SpotVerdict } from "./types";

type View = "step" | "whole";

const STATUS: Record<PointStatus, { label: string; style: string }> = {
  met: { label: "Met", style: "bg-caught text-white" },
  not_met: { label: "Not met", style: "bg-missed text-white" },
  cannot_tell: { label: "Can't tell", style: "bg-warn text-ink" },
};

const TONE: Record<Tone, { chip: string; wash: string }> = {
  verified: { chip: "bg-caught text-white", wash: "bg-caught-wash" },
  unproven: { chip: "bg-warn text-ink", wash: "bg-warn-wash" },
  risk: { chip: "bg-missed text-white", wash: "bg-missed-wash" },
};

const CONFIRM_OPTIONS: { value: PointAnswer; label: string; good: boolean }[] = [
  { value: "met", label: "Confirm: met", good: true },
  { value: "not_met", label: "I disagree", good: false },
];

const DECIDE_OPTIONS: { value: PointAnswer; label: string; good: boolean }[] = [
  { value: "met", label: "Met", good: true },
  { value: "not_met", label: "Not met", good: false },
];

/** Sets an answer, or takes it back when the same answer is pressed again. */
function toggled<T extends string>(record: Record<string, T>, id: string, value: T): Record<string, T> {
  const next = { ...record };
  if (next[id] === value) delete next[id];
  else next[id] = value;
  return next;
}

/** One line under the step title, for the steps that are not a requirement point. */
function stepHint(step: Step, reviewer: Reviewer): string | null {
  switch (step.kind) {
    case "intro":
      return "See what the reviewer said and how it did when we tested it. Then go through the requirement one point at a time.";
    case "spots":
      return `${prettyModel(reviewer.name)} missed breaks we planted at these places. They are not known bugs, but its silence there is worth nothing, so read them yourself.`;
    case "findings":
      return "These are in the real code, not in our test copies. Say whether each one is a real problem.";
    case "sign":
      return "Your name goes on this decision.";
    default:
      return null;
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
  summary,
  header,
  compare,
  onCompare,
  onReviewer,
  onSign,
  onSaved,
}: {
  exam: Exam;
  reviewer: Reviewer;
  /** Fingerprint of the code on screen. */
  code: string;
  signoffs: SignOff[];
  summary: string;
  header: React.ReactNode;
  compare: boolean;
  onCompare: () => void;
  onReviewer: (name: string) => void;
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
            .map((evidence) => ({ start: evidence.line_start, end: evidence.line_end, tone: "evidence", label: `Cited for ${step.point.id}` }))
        : [];
    return [...blind, ...found, ...cited];
  }, [exam, reviewer, file, step]);

  const spotsLeft = step.kind === "point" || step.kind === "spots" ? step.spots.filter((plant) => !progress.spots[plant.id]).length : 0;
  const hint = stepHint(step, reviewer);
  const shared = { files: exam.change.files, progress, onOpen: showInWhole, onSpot };

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_21.5rem]">
      <section className="flex min-h-0 min-w-0 flex-col">
        {header}

        <div className="border-b-2 border-ink bg-panel px-5 py-2.5">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-soft">
              Step {index + 1} of {steps.length} · {label.eyebrow}
            </p>
            <div className="flex shrink-0 overflow-hidden rounded-md border-2 border-ink text-[12px] font-bold" role="tablist" aria-label="What to show">
              {(["step", "whole"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={view === item}
                  onClick={() => setView(item)}
                  className={`px-2.5 py-1 ${item === "whole" ? "border-l-2 border-ink" : ""} ${view === item ? "bg-ink text-white" : "bg-panel hover:bg-brand-wash"}`}
                >
                  {item === "step" ? (step.kind === "point" ? "Lines for this step" : "This step") : "Whole change"}
                </button>
              ))}
            </div>
          </div>
          <h2 className="mt-1 text-[16.5px] font-bold leading-snug">{label.title}</h2>
          {hint && <p className="mt-0.5 max-w-4xl text-[13px] leading-snug text-soft">{hint}</p>}
        </div>

        {view === "whole" ? (
          <>
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
            <p className="border-t-2 border-ink bg-panel px-5 py-1.5 text-[12px] text-soft">
              <span className="mr-1.5 inline-block h-3 w-1.5 translate-y-0.5 bg-missed" />
              <strong className="text-ink">Red is not a known bug.</strong> {prettyModel(reviewer.name)} failed to notice when we broke the code there, so check it yourself.
              <span className="ml-3 mr-1.5 inline-block h-3 w-1.5 translate-y-0.5 bg-brand" />
              Blue: lines the reviewer cites for this step.
              <span className="ml-3 mr-1.5 inline-block h-3 w-1.5 translate-y-0.5 bg-warn" />
              Yellow: a problem the reviewer reported.
            </p>
          </>
        ) : step.kind === "intro" ? (
          <ReviewerTest exam={exam} reviewer={reviewer} summary={summary} />
        ) : step.kind === "point" ? (
          <PointBody
            key={step.id}
            step={step}
            {...shared}
            onWholeChange={() => setView("whole")}
            lead={
              <div className={`rounded-lg border-2 border-ink px-3 py-2 text-[13px] leading-snug ${TONE[step.tone].wash}`}>
                <p>
                  <span className={`mr-1.5 inline-block rounded border-2 border-ink px-1.5 text-[11px] font-bold ${STATUS[step.point.status].style}`}>
                    Reviewer says: {STATUS[step.point.status].label}
                  </span>
                  {/* The second chip is about our test of the reviewer. Without a "met" or a missed break it would only repeat the first. */}
                  {(step.point.status === "met" || step.spots.length > 0) && (
                    <span className={`mr-1.5 inline-block rounded border-2 border-ink px-1.5 text-[11px] font-bold ${TONE[step.tone].chip}`}>{step.chip}</span>
                  )}
                  <span className="font-medium">{step.why}</span>
                </p>
                {step.point.reason && <p className="mt-1 text-[12.5px] text-soft">The reviewer's reason: “{step.point.reason}”</p>}
              </div>
            }
          />
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
            onSign={(name, decision) =>
              onSign(
                name,
                decision,
                reviewer.read_yourself.filter((id) => progress.spots[id]).map((id) => ({ plant_id: id, verdict: progress.spots[id] })),
              )
            }
          />
        )}

        {step.kind !== "sign" && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t-2 border-ink bg-brand-wash px-5 py-2.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] font-medium leading-snug">
              {step.kind === "intro" && (
                <p>
                  {steps.length} steps. Green points you read and confirm. Yellow and red points you decide yourself. You can take them in any order.
                </p>
              )}
              {step.kind === "point" && (
                <>
                  <p>
                    {spotsLeft > 0
                      ? `First give a verdict on ${spotsLeft === 1 ? "the red spot" : `the ${spotsLeft} red spots`} in the lines for this step.`
                      : step.tone === "verified"
                        ? "The reviewer's answer held up. Do the lines show this is met?"
                        : "Your decision: is this met in the real code?"}
                  </p>
                  <Choice
                    size="large"
                    value={progress.points[step.point.id]}
                    options={step.tone === "verified" ? CONFIRM_OPTIONS : DECIDE_OPTIONS}
                    disabled={spotsLeft > 0}
                    onPick={(answer) => onPoint(step.point.id, answer)}
                  />
                </>
              )}
              {step.kind === "spots" && (
                <p>{spotsLeft > 0 ? `${spotsLeft} of ${step.spots.length} ${step.spots.length === 1 ? "spot" : "spots"} still need a verdict.` : "Every spot has a verdict."}</p>
              )}
              {step.kind === "findings" && (
                <p>{state.done ? "Every reported problem has your answer." : "Say for each reported problem whether it is real."}</p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => goTo(steps[index - 1].id)}
                className="press rounded-md bg-panel px-3 py-1.5 text-[13px] font-bold"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => {
                  if (step.kind === "intro" && !progress.intro) check(() => ({ intro: true }));
                  goTo(steps[index + 1].id);
                }}
                className={`press rounded-md px-3 py-1.5 text-[13px] font-bold ${state.done || step.kind === "intro" ? "bg-warn" : "bg-panel"}`}
              >
                {step.kind === "intro" && !state.done ? "I have read this. Start the checks →" : state.done ? "Next step →" : "Skip for now →"}
              </button>
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
        compare={compare}
        onCompare={onCompare}
        onGoTo={goTo}
        onReviewer={onReviewer}
        onClear={() => {
          setStale(false);
          setProgress(freshProgress(reviewer.run_file, code));
          setView("step");
        }}
      />
    </div>
  );
}
