import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Brief, Dots, type BriefNode, type BriefTask } from "./Brief";
import { ChangeDrawer, Changes, blockMarks, layoutChanges, type Cite, type Lens } from "./Changes";
import type { Mark } from "./DiffView";
import { ArrowLeft, ArrowRight, ArrowUpRight, CheckIcon, PanelIcon, SkipIcon, XIcon } from "./icons";
import { fileName, lineRange, objectiveName, plural, prettyModel, sameFile, shortModel } from "./lib";
import { Prose, inline } from "./Prose";
import {
  buildSteps,
  clearSaved,
  freshProgress,
  isBlank,
  openProgress,
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
import { StepBar } from "./StepBar";
import type { Exam, FileDiff, Plant, Reviewer, SignOff, SpotVerdict } from "./types";

const TONE_TEXT: Record<Tone, string> = { verified: "text-caught", unproven: "text-soft", risk: "text-missed" };

/** How long a finished step stays on screen before the next step opens by itself. */
const ADVANCE_MS = 450;

const EASE = [0.25, 0.1, 0.25, 1] as const;

/** Sets an answer, or takes it back when the same answer is pressed again. */
function toggled<T extends string>(record: Record<string, T>, id: string, value: T): Record<string, T> {
  const next = { ...record };
  if (next[id] === value) delete next[id];
  else next[id] = value;
  return next;
}

const lines = (start: number, end: number) => (end > start ? `lines ${lineRange(start, end)}` : `line ${start}`);

const overlaps = (a: { file: string; line_start: number; line_end: number }, b: { file: string; line_start: number; line_end: number }) =>
  sameFile(a.file, b.file) && a.line_start <= b.line_end && a.line_end >= b.line_start;

/** What the person reads in the change for one step: the cited lines, the blind spots, the reported problems. */
function lensFor(step: Step, exam: Exam, reviewer: Reviewer): Lens | null {
  const model = shortModel(reviewer.name);
  const missedAt = (plant: Plant) => {
    const at = exam.plants.filter((other) => other.kind !== "harmless" && reviewer.results[other.id] === "missed" && overlaps(other, plant));
    return at.length > 0 ? at : [plant];
  };
  switch (step.kind) {
    case "point": {
      const { point } = step;
      const objective = objectiveName(point.id);
      const cites: Cite[] = point.evidence.map((evidence) => {
        const aimed = exam.plants.filter((plant) => plant.kind !== "harmless" && plant.breaks === point.id && overlaps(plant, evidence));
        const caught = aimed.filter((plant) => reviewer.results[plant.id] === "caught").length;
        const missed = aimed.filter((plant) => reviewer.results[plant.id] === "missed").length;
        return {
          file: evidence.file,
          start: evidence.line_start,
          end: evidence.line_end,
          planted: aimed.length,
          caught,
          // Two different answers to the same review mean nothing held up, whatever was caught.
          outcome: missed > 0 ? "missed" : caught > 0 && point.noticed !== "unstable" ? "held" : "untested",
        };
      });
      return { objective, model, cites, blind: step.spots, missedAt, findings: [], quiet: `not cited for ${objective}`, readAll: cites.length === 0 };
    }
    case "spots":
      return { objective: null, model, cites: [], blind: step.spots, missedAt, findings: [], quiet: "no blind spot", readAll: false };
    case "findings":
      return { objective: null, model, cites: [], blind: [], missedAt, findings: step.findings.map((finding, index) => ({ index, finding })), quiet: "nothing reported", readAll: false };
    default:
      return null;
  }
}

/** The question in the floating bar: exactly what the person rules on. */
function auditQuestion(step: PointStep, cited: number): string {
  const objective = objectiveName(step.point.id);
  return step.claimsMet && cited > 0 ? `Does the cited code prove that the change meets ${objective}?` : `Does the change meet ${objective}?`;
}

/** The one instruction under the title of a step that is not an objective. */
function stepTask(step: Step, exam: Exam, reviewer: Reviewer): string {
  const model = prettyModel(reviewer.name);
  switch (step.kind) {
    case "intro":
      return `An AI agent wrote the pull request. ${model} reviewed it against the requirement (issue ${exam.change.requirement_id}). We tested ${shortModel(reviewer.name)} by planting mistakes in copies of the change. You check whether its review can be trusted, then you sign.`;
    case "spots":
      return "In test copies, the AI reviewer missed a planted mistake at each of these lines. The code below is the real code. Judge whether it is correct.";
    case "findings":
      return "The AI reviewer reported these problems in the real code. Judge whether each one is real.";
    case "sign":
      return "Decide on the pull request and put your name on the decision.";
    case "point":
      return "";
  }
}

/** A requirement, beside the page. */
function RequirementSheet({ exam, onClose }: { exam: Exam; onClose: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const totals = exam.change.files.reduce((sum, item) => ({ added: sum.added + item.added, removed: sum.removed + item.removed }), { added: 0, removed: 0 });
  const body = exam.change.requirement_text.split("\n").slice(1).join("\n").replace(/^\s*Source:.*$/m, "").trim();
  const source = /^\s*Source:\s*(\S+)/m.exec(exam.change.requirement_text)?.[1];
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="requirement-title">
      <motion.div
        className="absolute inset-0 bg-ink/20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0 : 0.18 }}
        onClick={onClose}
      />
      <motion.aside
        initial={reduced ? { opacity: 0 } : { x: "100%" }}
        animate={reduced ? { opacity: 1 } : { x: 0 }}
        exit={reduced ? { opacity: 0 } : { x: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        className="absolute inset-y-2 right-2 flex w-[min(40rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-hair bg-panel shadow-[var(--shadow-pop)]"
      >
        <header className="flex items-start gap-3 border-b border-hair px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-soft">
              Requirement · issue {exam.change.requirement_id}
              {source && (
                <>
                  {" · "}
                  <a href={source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-link hover:underline">
                    Open the issue <ArrowUpRight size={13} />
                  </a>
                </>
              )}
            </p>
            <h2 id="requirement-title" className="mt-1 text-[18px] font-semibold leading-snug">
              {exam.change.requirement_title}
            </h2>
            <p className="mt-1 text-[13px] text-soft">
              An AI agent wrote the pull request to resolve the issue: {plural(exam.change.files.length, "file")},{" "}
              <span className="text-caught">+{totals.added}</span> <span className="text-missed">−{totals.removed}</span>. The review objectives come from the issue text.
            </p>
          </div>
          <button ref={close} type="button" onClick={onClose} className="btn h-8 w-8 shrink-0 !p-0" aria-label="Close">
            <XIcon size={16} />
          </button>
        </header>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <Prose text={body} />
        </div>
      </motion.aside>
    </div>
  );
}

/**
 * One pull request as a guided audit of its AI review. The step being worked on fills the panel,
 * how the step got here sits in the side bar, and the question of the step floats at the bottom.
 * It is remounted when the code or the AI reviewer changes, so checks never carry over to
 * something the person has not looked at.
 */
export function Workspace({
  exam,
  reviewer,
  code,
  signoffs,
  briefSlot,
  onSign,
  onSaved,
}: {
  exam: Exam;
  reviewer: Reviewer;
  /** Fingerprint of the code on screen. */
  code: string;
  signoffs: SignOff[];
  /** Where the side bar wants the audit brief. */
  briefSlot: HTMLElement | null;
  onSign: (name: string, decision: string, spots: { plant_id: string; verdict: SpotVerdict }[]) => Promise<void>;
  /** Called after the saved checks change, so the list of pull requests can show progress. */
  onSaved: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const key = storageKey(exam.change.id, reviewer.name);
  const steps = useMemo(() => buildSteps(exam, reviewer), [exam, reviewer]);
  const [opened] = useState(() => openProgress(key, reviewer.run_file, code));
  const [progress, setProgress] = useState<Progress>(opened.progress);
  const [stale, setStale] = useState(opened.stale);
  const [jump, setJump] = useState<{ id: string; token: number } | null>(null);
  const [showRequirement, setShowRequirement] = useState(false);
  const [full, setFull] = useState<{ path: string; line: number | null } | null>(null);
  /** The answer just given, which the next step offers to take back for a few seconds. */
  const [undo, setUndo] = useState<{ stepId: string; pointId: string; text: string } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(timer);
  }, [undo]);
  const scroller = useRef<HTMLDivElement>(null);

  const model = shortModel(reviewer.name);
  const mine = signoffs.filter((entry) => entry.reviewer === reviewer.name);
  const signed = mine[mine.length - 1] ?? null;
  const states: StepState[] = steps.map((item) => stepState(item, progress, signed));
  const done = states.filter((state) => state.done).length;
  const index = Math.max(0, steps.findIndex((item) => item.id === progress.step));
  const step = steps[index];
  const state = states[index];
  const label = stepLabel(step);

  const lens = useMemo(() => lensFor(step, exam, reviewer), [step, exam, reviewer]);
  const layout = useMemo(() => (lens ? layoutChanges(exam.change.files, lens) : null), [exam, lens]);
  const citedBlocks = useMemo(() => (layout ? layout.files.flatMap((item) => item.blocks).filter((block) => block.cites.length > 0) : []), [layout]);

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

  // A new step starts at its top.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [step.id]);

  const check = (change: (current: Progress) => Partial<Progress>) => {
    setStale(false);
    setProgress((current) => ({ ...current, ...change(current) }));
  };
  const goTo = (stepId: string) => setProgress((current) => ({ ...current, step: stepId }));
  const onSpot = (plantId: string, verdict: SpotVerdict) => check((current) => ({ spots: toggled(current.spots, plantId, verdict) }));
  const onFinding = (findingId: string, answer: FindingAnswer) => check((current) => ({ findings: toggled(current.findings, findingId, answer) }));
  const jumpTo = (id: string) => setJump({ id, token: Date.now() });

  const spotsLeft = step.kind === "point" || step.kind === "spots" ? step.spots.filter((plant) => !progress.spots[plant.id]) : [];

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

  const forget = (pointId: string) =>
    check((current) => {
      const points = { ...current.points };
      delete points[pointId];
      return { points };
    });

  /**
   * The verdict on an objective. Nothing is settled before the sign-off: pressing the chosen answer
   * again takes it back. A key only ever sets an answer, so a stray key press cannot clear one.
   */
  const answer = (value: PointAnswer, from: "click" | "key") => {
    if (step.kind !== "point" || spotsLeft.length > 0) return;
    const id = step.point.id;
    if (progress.points[id] === value) {
      if (from === "click") {
        forget(id);
        setUndo(null);
      }
      return;
    }
    check((current) => ({ points: { ...current.points, [id]: value } }));
    // A first answer moves on by itself; the next step offers to take it back, in case it was a slip.
    if (!state.done) setUndo({ stepId: step.id, pointId: id, text: `${objectiveName(id)}: ${value === "met" ? "Yes" : "No"}` });
  };

  const takeBack = () => {
    if (!undo) return;
    forget(undo.pointId);
    goTo(undo.stepId);
    setUndo(null);
  };

  const start = () => {
    if (!progress.intro) check(() => ({ intro: true }));
    goTo(nextOpen.id);
  };

  // Y and N answer the question of an objective; Enter starts the audit.
  const keys = useRef({ answer, start, step, spotsLeft: spotsLeft.length });
  keys.current = { answer, start, step, spotsLeft: spotsLeft.length };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable=true]") || target.closest("[role=dialog]"))) return;
      const { step: current, spotsLeft: left } = keys.current;
      if (current.kind === "point" && left === 0) {
        if (event.key === "y" || event.key === "Y") keys.current.answer("met", "key");
        if (event.key === "n" || event.key === "N") keys.current.answer("not_met", "key");
      }
      if (current.kind === "intro" && event.key === "Enter" && !(target && target.closest("button, a"))) keys.current.start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const clear = () => {
    setStale(false);
    setProgress(freshProgress(reviewer.run_file, code));
  };

  const closeRequirement = useCallback(() => setShowRequirement(false), []);
  const closeFull = useCallback(() => setFull(null), []);
  const openFile = useCallback((path: string, line: number | null) => setFull({ path, line }), []);

  // The full change marks every blind spot and every reported problem of the review, and the lines cited in this step.
  const marksFor = useCallback(
    (file: FileDiff): Mark[] => [
      ...exam.plants
        .filter((plant) => reviewer.read_yourself.includes(plant.id) && sameFile(file.path, plant.file))
        .map((plant) => ({ start: plant.line_start, end: plant.line_end, tone: "blind" as const })),
      ...reviewer.findings
        .filter((finding) => sameFile(file.path, finding.file))
        .map((finding) => ({ start: finding.line_start, end: finding.line_end, tone: "finding" as const })),
      ...(lens?.cites ?? [])
        .filter((cite) => sameFile(file.path, cite.file))
        .map((cite) => ({ start: cite.start, end: cite.end, tone: cite.outcome === "held" ? ("held" as const) : ("cited" as const) })),
    ],
    [exam, reviewer, lens],
  );
  const fullFiles = layout ? layout.files.map((item) => item.file) : exam.change.files;
  // Open the full change where the review needs a reader most: the first blind spot, else the first file.
  const firstBlind = exam.plants.find((plant) => reviewer.read_yourself.includes(plant.id));
  const fullStart = (): { path: string; line: number | null } => {
    const first = layout?.marked ? layout.files[0] : undefined;
    const starts = first ? first.blocks.flatMap(blockMarks).map((mark) => mark.start) : [];
    if (first && starts.length > 0) return { path: first.file.path, line: Math.min(...starts) };
    if (firstBlind) return { path: firstBlind.file, line: firstBlind.line_start };
    return { path: fullFiles[0]?.path ?? "", line: null };
  };

  // ---- The audit brief in the side bar ----
  const counts = reviewer.counts;
  const defectResults = exam.plants
    .filter((plant) => plant.kind !== "harmless")
    .map((plant) => (reviewer.results[plant.id] === "caught" ? "caught" : reviewer.results[plant.id] === "missed" ? "missed" : "other") as "caught" | "missed" | "other");
  const verdictTitle = reviewer.review_failed
    ? "Gave no usable answer"
    : reviewer.verdict === true
      ? "Says the change meets the requirement"
      : reviewer.verdict === false
        ? "Says the change does not meet the requirement"
        : "Could not tell";
  const aiOverall: BriefNode = {
    who: "ai",
    meta: `${model} · AI reviewer`,
    title: verdictTitle,
    detail: reviewer.review_failed
      ? "Treat the pull request as unreviewed."
      : reviewer.findings.length > 0
        ? `Reported ${plural(reviewer.findings.length, "problem")} in the real code.`
        : "Reported no problems. The verdict is an opinion, not proof.",
  };
  const examinerOverall: BriefNode = {
    who: "examiner",
    meta: "Examiner AI · our test",
    title:
      counts.defects_total > 0 ? (
        <span className={counts.defects_caught === counts.defects_total ? "text-caught" : "text-missed"}>
          Noticed {counts.defects_caught} of {plural(counts.defects_total, "planted mistake")}
        </span>
      ) : (
        <span className="text-soft">Could not be tested</span>
      ),
    detail:
      counts.defects_total > 0 ? (
        <>
          <Dots results={defectResults} />
          {counts.harmless_total > 0 && (
            <span className="mt-1.5 block">
              {counts.false_alarms === 0 ? "No false alarm" : plural(counts.false_alarms, "false alarm")} on {plural(counts.harmless_total, "harmless edit")}.
            </span>
          )}
        </>
      ) : undefined,
  };
  const spotTask = (plant: Plant): BriefTask => ({
    text: `Judge the blind spot, ${lines(plant.line_start, plant.line_end)}`,
    done: progress.spots[plant.id] != null,
    flagged: progress.spots[plant.id] === "wrong",
    onClick: () => jumpTo(`spot-${plant.id}`),
  });

  let nodes: BriefNode[];
  if (step.kind === "point") {
    const { point } = step;
    const objective = objectiveName(point.id);
    const answerNow = progress.points[point.id];
    const tasks: BriefTask[] = [];
    if (citedBlocks.length > 0) tasks.push({ text: `Read the ${plural(citedBlocks.length, "cited block")}`, onClick: () => jumpTo(citedBlocks[0].id) });
    else tasks.push({ text: "Read the full change", onClick: () => layout?.files[0]?.blocks[0] && jumpTo(layout.files[0].blocks[0].id) });
    tasks.push(...step.spots.map(spotTask));
    tasks.push({ text: `Decide whether ${objective} was met`, done: answerNow != null, flagged: answerNow === "not_met" });
    const results: ("caught" | "missed")[] = [
      ...Array<"caught">(point.broken_noticed).fill("caught"),
      ...Array<"missed">(Math.max(0, point.broken_total - point.broken_noticed)).fill("missed"),
    ];
    nodes = [
      {
        who: "ai",
        meta: `${model} · AI reviewer`,
        title: point.status === "met" ? `Claims ${objective} is met` : point.status === "not_met" ? `Claims ${objective} is not met` : `Could not decide ${objective}`,
        fold: point.reason ? { label: "Read full reasoning", body: `“${point.reason}”` } : undefined,
      },
      {
        who: "examiner",
        meta: "Examiner AI · our test",
        title: (
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className={TONE_TEXT[step.tone]}>{step.test.verdict}</span>
            {results.length > 0 && <Dots results={results} />}
          </span>
        ),
        detail: step.test.detail,
      },
      { who: "you", meta: "You · auditor", title: "Audit the claim", tasks },
    ];
  } else if (step.kind === "spots") {
    nodes = [
      { who: "ai", meta: `${model} · AI reviewer`, title: `Missed ${plural(step.spots.length, "planted mistake")}`, detail: "At lines that belong to no single objective." },
      { who: "examiner", meta: "Examiner AI · our test", title: <span className="text-missed">Blind spots</span>, detail: "We planted them in test copies. None is in the real code." },
      { who: "you", meta: "You · auditor", title: "Judge the real code", tasks: step.spots.map(spotTask) },
    ];
  } else if (step.kind === "findings") {
    nodes = [
      { who: "ai", meta: `${model} · AI reviewer`, title: `Reported ${plural(step.findings.length, "problem")}` },
      { who: "examiner", meta: "Examiner AI · our test", title: <span className="text-soft">Not tested</span>, detail: "We test claims, not reported problems." },
      {
        who: "you",
        meta: "You · auditor",
        title: "Judge each problem",
        tasks: step.findings.map((finding, number) => ({
          text: `${fileName(finding.file)}, ${lines(finding.line_start, finding.line_end)}`,
          done: progress.findings[String(number)] != null,
          flagged: progress.findings[String(number)] === "real",
          onClick: () => jumpTo(`finding-${number}`),
        })),
      },
    ];
  } else if (step.kind === "sign") {
    const flagged = states.filter((item) => item.flagged).length;
    nodes = [
      aiOverall,
      examinerOverall,
      {
        who: "you",
        meta: "You · auditor",
        title: "Sign the audit",
        tasks: [
          { text: `${done - (signed ? 1 : 0)} of ${steps.length - 1} steps done`, done: done - (signed ? 1 : 0) === steps.length - 1 },
          ...(flagged > 0 ? [{ text: `${plural(flagged, "step")} marked wrong`, flagged: true }] : []),
          { text: "Accept, ask for a full read, or reject", done: signed != null },
        ],
      },
    ];
  } else {
    const objectives = steps.filter((item) => item.kind === "point").length;
    const blind = reviewer.read_yourself.length;
    nodes = [
      aiOverall,
      examinerOverall,
      {
        who: "you",
        meta: "You · auditor",
        title: "Audit the review",
        tasks: [
          ...(objectives > 0 ? [{ text: `Audit ${plural(objectives, "review objective")}` }] : []),
          ...(blind > 0 ? [{ text: `Judge ${plural(blind, "blind spot")}` }] : []),
          ...(reviewer.findings.length > 0 ? [{ text: `Judge ${plural(reviewer.findings.length, "reported problem")}` }] : []),
          { text: "Sign: accept, ask for a full read, or reject" },
        ],
      },
    ];
  }

  // ---- The floating question bar ----
  const next = stepLabel(nextOpen);
  let question: ReactNode = null;
  let actions: ReactNode = null;
  let questionKey = step.id;
  if (step.kind === "intro") {
    questionKey = "intro";
    question = <>The audit has {plural(steps.length - 2, "step")} before you sign.</>;
    actions = (
      <button type="button" onClick={start} className="btn btn-dark h-9 px-3.5 text-[14px]">
        {progress.intro ? "Continue the audit" : "Start the audit"}
        <ArrowRight size={15} />
      </button>
    );
  } else if (step.kind === "point") {
    const chosen = progress.points[step.point.id];
    const blocked = spotsLeft.length > 0;
    questionKey = blocked ? `${step.id}-spots` : `${step.id}-ask`;
    question = blocked ? (
      <button type="button" onClick={() => jumpTo(`spot-${spotsLeft[0].id}`)} className="inline-flex items-center gap-2 text-left hover:underline">
        <i className="inline-block h-2 w-2 shrink-0 rounded-full bg-missed" aria-hidden="true" />
        First judge the blind spot at {lines(spotsLeft[0].line_start, spotsLeft[0].line_end)}
      </button>
    ) : (
      auditQuestion(step, citedBlocks.length)
    );
    actions = (
      <>
        <button
          type="button"
          disabled={blocked}
          onClick={() => answer("not_met", "click")}
          aria-pressed={chosen === "not_met"}
          title={chosen === "not_met" ? "Press again to take your answer back" : undefined}
          className={`btn h-9 px-3 text-[14px] ${chosen === "not_met" ? "!border-missed/40 !bg-missed-wash !text-missed" : ""}`}
        >
          {chosen === "not_met" && <XIcon size={14} />}
          No
          <span className="kbd">N</span>
        </button>
        <button
          type="button"
          disabled={blocked}
          onClick={() => answer("met", "click")}
          aria-pressed={chosen === "met"}
          title={chosen === "met" ? "Press again to take your answer back" : undefined}
          className="btn btn-dark h-9 px-3 text-[14px]"
        >
          {chosen === "met" && <CheckIcon size={14} />}
          {chosen || state.done ? "Yes" : nextOpen.kind === "sign" ? "Yes, then sign" : `Yes, next ${next.short}`}
          <span className="kbd">Y</span>
        </button>
      </>
    );
  } else if (step.kind === "spots" || step.kind === "findings") {
    questionKey = `${step.id}-${state.done}`;
    question = state.done ? (
      <span className="inline-flex items-center gap-2 text-caught">
        <CheckIcon size={15} /> Step done
      </span>
    ) : step.kind === "spots" ? (
      `Judge ${spotsLeft.length === 1 ? "the blind spot" : `the ${spotsLeft.length} blind spots`} above.`
    ) : (
      "Judge every reported problem above."
    );
    actions = state.done ? (
      <button type="button" onClick={() => goTo(nextOpen.id)} className="btn btn-dark h-9 px-3.5 text-[14px]">
        Next: {next.short}
        <ArrowRight size={15} />
      </button>
    ) : null;
  }

  const showBar = step.kind !== "sign";
  const title = step.kind === "point" ? inline(step.point.text) : step.kind === "intro" ? `You are auditing ${prettyModel(reviewer.name)}` : label.title;

  const brief = (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={step.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
        <Brief nodes={nodes} />
      </motion.div>
    </AnimatePresence>
  );

  return (
    <div className="relative h-full">
      {briefSlot && createPortal(brief, briefSlot)}

      <div ref={scroller} className="thin-scroll h-full overflow-y-auto">
        {/* The step bar stays in reach while the person scrolls through the code. */}
        <header className="sticky top-0 z-10 bg-white/85 px-6 pb-3 pt-4 backdrop-blur-md sm:px-10">
          <StepBar steps={steps} states={states} current={step.id} onGoTo={goTo} />
        </header>
        {stale && (
          <p role="status" className="mx-6 mt-2 rounded-lg bg-warn-wash px-3 py-2 text-[13px] sm:mx-10">
            The code or the results of the AI reviewer changed since your last visit. Your earlier audit was cleared.
          </p>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : -4 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            <div className="border-b border-hair px-6 pb-7 pt-4 sm:px-10">
              <p className="flex flex-wrap items-center gap-x-1.5 text-[13.5px] text-soft">
                {label.eyebrow}
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => setShowRequirement(true)} className="inline-flex items-center gap-0.5 text-link hover:underline">
                  Read the requirement (issue {exam.change.requirement_id})
                  <ArrowUpRight size={14} />
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => setFull(fullStart())}
                  className="inline-flex items-center gap-1 text-link hover:underline"
                >
                  See the full change
                  <PanelIcon size={14} />
                </button>
              </p>
              <h1 className="mt-2 max-w-[60rem] text-[18px] font-semibold leading-[1.3] tracking-[-0.01em] sm:text-[22px]">{title}</h1>
              {step.kind !== "point" && <p className="mt-2 max-w-[46rem] text-[14px] leading-relaxed text-soft">{stepTask(step, exam, reviewer)}</p>}
            </div>

            <div className="px-6 pb-36 pt-7 sm:px-10">
              {step.kind === "intro" ? (
                <ReviewerTest exam={exam} reviewer={reviewer} />
              ) : step.kind === "sign" ? (
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
              ) : (
                layout &&
                lens && (
                  <Changes
                    layout={layout}
                    lens={lens}
                    spots={progress.spots}
                    findingAnswers={progress.findings}
                    onSpot={onSpot}
                    onFinding={onFinding}
                    jump={jump}
                    onOpenFile={openFile}
                  />
                )
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {showBar && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-3 sm:px-6 sm:pb-6">
          <motion.div
            initial={{ opacity: 0, y: reduced ? 0 : 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="pointer-events-auto mx-auto max-w-[66rem] rounded-[18px] border-[5px] border-white/70 bg-white/80 shadow-[var(--shadow-float)] backdrop-blur-xl"
          >
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[13px] px-4 py-2 sm:px-5">
              <div className="flex shrink-0 items-center gap-5 text-[14px] text-soft">
                {index > 0 && (
                  <button type="button" onClick={() => goTo(steps[index - 1].id)} className="inline-flex items-center gap-2 hover:text-ink">
                    <ArrowLeft size={15} />
                    Previous step
                  </button>
                )}
                {step.kind !== "intro" && !state.done && index < steps.length - 1 && (
                  <button type="button" onClick={() => goTo(steps[index + 1].id)} className="inline-flex items-center gap-2 hover:text-ink">
                    Skip the step
                    <SkipIcon size={16} />
                  </button>
                )}
                {step.kind === "point" && state.done && (
                  <button type="button" onClick={() => goTo(nextOpen.id)} className="inline-flex items-center gap-2 hover:text-ink">
                    Next step
                    <ArrowRight size={15} />
                  </button>
                )}
                <AnimatePresence>
                  {undo && undo.stepId !== step.id && (
                    <motion.span
                      key={undo.stepId}
                      initial={{ opacity: 0, x: reduced ? 0 : -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="inline-flex h-8 items-center gap-2 rounded-lg bg-canvas px-2.5 text-[13px] text-ink"
                    >
                      <CheckIcon size={13} className="text-soft" />
                      {undo.text}
                      <button type="button" onClick={takeBack} className="font-medium text-link hover:underline">
                        Undo
                      </button>
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-5 gap-y-2">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={questionKey}
                    initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reduced ? 0 : -6 }}
                    transition={{ duration: 0.16 }}
                    className="min-w-0 text-[15.5px] font-medium leading-snug"
                  >
                    {question}
                  </motion.div>
                </AnimatePresence>
                {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <AnimatePresence>{showRequirement && <RequirementSheet key="requirement" exam={exam} onClose={closeRequirement} />}</AnimatePresence>
      <AnimatePresence>
        {full && (
          <ChangeDrawer
            key="full"
            files={fullFiles}
            marksFor={marksFor}
            start={full}
            model={model}
            objective={step.kind === "point" ? objectiveName(step.point.id) : null}
            onClose={closeFull}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
