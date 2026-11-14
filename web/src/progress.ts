import { sameFile } from "./lib";
import type { ApprovedObjective, EvidenceRef, Exam, FileDiff, Finding, Plant, PointView, Reviewer, Row, SignOff, SpotVerdict } from "./types";

/**
 * The review as a list of steps, and what one person has checked so far.
 *
 * Checks are kept in this browser so a review can be paused and picked up later.
 * They belong to the exact code and reviewer results they were made on: if either
 * changes, the saved checks are thrown away instead of being applied to code the
 * person has not seen.
 */

export type PointAnswer = "met" | "not_met" | "cannot_tell";
export type FindingAnswer = "real" | "not_real";

export type Progress = {
  /** The reviewer run these checks were made against. */
  runFile: string;
  /** Fingerprint of the code that was on screen. */
  code: string;
  /** The step the person was on. */
  step: string;
  intro: boolean;
  points: Record<string, PointAnswer>;
  spots: Record<string, SpotVerdict>;
  findings: Record<string, FindingAnswer>;
  /** Kept so the list of pull requests can show progress without loading the review. */
  done: number;
  total: number;
  savedAt: string;
};

const PREFIX = "reviewer-controls:review:v2:";

/** Checks belong to one person: two people on the same machine never share them. */
export const storageKey = (changeId: string, reviewerName: string, signer: string) =>
  `${PREFIX}${changeId}:${reviewerName}:${signer.trim().toLowerCase()}`;

/** Every saved review of one change, whoever made it. */
export function clearChange(changeId: string): void {
  try {
    const doomed: string[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(`${PREFIX}${changeId}:`)) doomed.push(key);
    }
    doomed.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Nothing to clear.
  }
}

/** The most progress anyone saved on this change in this browser, for the list of pull requests. */
export function savedSummary(changeId: string): { done: number; total: number } | null {
  try {
    let best: { done: number; total: number } | null = null;
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(`${PREFIX}${changeId}:`)) continue;
      const saved = readSaved(key);
      if (saved && saved.total > 0 && (!best || saved.done > best.done)) best = { done: saved.done, total: saved.total };
    }
    return best;
  } catch {
    return null;
  }
}

const SIGNER_KEY = "reviewer-controls:signer";

/** The name of the person reviewing in this browser tab. Kept per tab, so the next person starts fresh. */
export function readSigner(): string {
  try {
    return window.sessionStorage.getItem(SIGNER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeSigner(name: string): void {
  try {
    window.sessionStorage.setItem(SIGNER_KEY, name);
  } catch {
    // The name just has to be typed again next time.
  }
}

export function freshProgress(runFile: string, code: string): Progress {
  return { runFile, code, step: "objectives", intro: false, points: {}, spots: {}, findings: {}, done: 0, total: 0, savedAt: "" };
}

/** True while nothing has been checked, so there is nothing worth keeping. */
export function isBlank(progress: Progress): boolean {
  return (
    !progress.intro &&
    Object.keys(progress.points).length === 0 &&
    Object.keys(progress.spots).length === 0 &&
    Object.keys(progress.findings).length === 0
  );
}

function isRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Storage can be missing or blocked (private windows), so every access is guarded. */
export function readSaved(key: string): Progress | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data)) return null;
    const saved = data as unknown as Partial<Progress>;
    if (typeof saved.runFile !== "string" || typeof saved.code !== "string") return null;
    if (!isRecord(saved.points) || !isRecord(saved.spots) || !isRecord(saved.findings)) return null;
    return {
      runFile: saved.runFile,
      code: saved.code,
      step: typeof saved.step === "string" ? saved.step : "objectives",
      intro: saved.intro === true,
      points: saved.points,
      spots: saved.spots,
      findings: saved.findings,
      done: typeof saved.done === "number" ? saved.done : 0,
      total: typeof saved.total === "number" ? saved.total : 0,
      savedAt: typeof saved.savedAt === "string" ? saved.savedAt : "",
    };
  } catch {
    return null;
  }
}

export function writeSaved(key: string, progress: Progress): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(progress));
  } catch {
    // The review still works without storage; it just cannot be resumed.
  }
}

export function clearSaved(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

/**
 * The saved checks for this review, if they were made on this reviewer run.
 * `stale` says older checks existed and no longer apply. The code on screen is deliberately not
 * compared: it differs only when a spot-check copy is shown, and saying so would give the test away.
 */
export function openProgress(key: string | null, runFile: string, code: string): { progress: Progress; stale: boolean } {
  const saved = key ? readSaved(key) : null;
  if (saved && saved.runFile === runFile) return { progress: { ...saved, code }, stale: false };
  return { progress: freshProgress(runFile, code), stale: saved != null && !isBlank(saved) };
}

/** A short fingerprint of the code on screen (FNV-1a), to tell whether saved checks were made on it. */
export function codeFingerprint(files: FileDiff[]): string {
  let hash = 0x811c9dc5;
  let rows = 0;
  const feed = (text: string) => {
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  for (const file of files) {
    feed(file.path);
    for (const row of file.rows) {
      feed(row.kind);
      feed(row.text);
      feed("\n");
      rows += 1;
    }
  }
  return `${rows}-${(hash >>> 0).toString(16)}`;
}

/** "verified": the reviewer's answer held up. "unproven": nothing backs it. "risk": it failed, or says not met. */
export type Tone = "verified" | "unproven" | "risk";

export type PointStep = {
  id: string;
  kind: "point";
  point: PointView;
  /** Places where the reviewer missed a break we planted against this point. */
  spots: Plant[];
  tone: Tone;
  chip: string;
  /** What the reviewer says and how that answer did on our test. */
  why: string;
  /** What the person is asked to do. */
  todo: string;
};

export type Step =
  | { id: "objectives"; kind: "objectives" }
  | { id: "intro"; kind: "intro" }
  | { id: "proven"; kind: "proven"; points: PointView[] }
  | PointStep
  | { id: string; kind: "added"; objective: ApprovedObjective }
  | { id: "spots"; kind: "spots"; spots: Plant[] }
  | { id: "findings"; kind: "findings"; findings: Finding[] }
  | { id: "sign"; kind: "sign" };

/** The objectives this review answers: the owner's kept ones, or every point the reviewer judged. */
export function keptIds(exam: Exam, reviewer: Reviewer): string[] {
  if (exam.approval) return exam.approval.objectives.filter((item) => item.decision === "keep").map((item) => item.id);
  return reviewer.points.map((point) => point.id);
}

/** One line on where this change stands: objectives, how many the test proved, how many are left for a person. */
export function summaryLine(exam: Exam, reviewer: Reviewer): { objectives: number; proven: number; forYou: number; approved: boolean } {
  const kept = new Set(keptIds(exam, reviewer));
  const proven = reviewer.points.filter((point) => kept.has(point.id) && point.proven).length;
  return { objectives: kept.size, proven, forYou: kept.size - proven, approved: exam.approval != null };
}

/** What the reviewer's verdict is on the approved objectives only. */
export function verdictOnApproved(exam: Exam, reviewer: Reviewer): "meets" | "not_met" | "unclear" | null {
  if (!exam.approval) return null;
  const kept = new Set(keptIds(exam, reviewer));
  const judged = reviewer.points.filter((point) => kept.has(point.id));
  if (judged.some((point) => point.status === "not_met")) return "not_met";
  if (judged.length > 0 && judged.every((point) => point.status === "met") && judged.length === kept.size) return "meets";
  return "unclear";
}

/** How far the reviewer's answer on one point can be believed, and what that asks of the person. */
function describePoint(point: PointView, spots: Plant[]): { tone: Tone; chip: string; why: string; todo: string } {
  const redSpots = spots.length === 1 ? "the red spot" : `the ${spots.length} red spots`;
  if (point.status === "not_met") {
    return {
      tone: "risk",
      chip: "Says not met",
      why: "The reviewer says the change does not do this.",
      todo: spots.length > 0 ? `Check ${redSpots}, then decide whether it is right.` : "Read the lines and decide whether it is right.",
    };
  }
  const missed = spots.length > 0 || point.noticed === "no" || point.noticed === "partly";
  if (missed) {
    const claim = point.status === "met" ? "The reviewer says this is met, but it" : "The reviewer could not tell, and it";
    const tested =
      point.broken_total > 0
        ? `missed ${point.broken_total - point.broken_noticed} of the ${point.broken_total} breaks we planted in the lines it cites.`
        : `missed ${spots.length === 1 ? "a break" : `${spots.length} breaks`} we planted against this point.`;
    return {
      tone: "risk",
      chip: "Missed our breaks",
      why: `${claim} ${tested}`,
      todo: spots.length > 0 ? `Check ${redSpots} yourself, then decide.` : "Read the lines closely, then decide.",
    };
  }
  if (point.status === "cannot_tell") {
    const cited = point.broad_evidence
      ? " Its citations covered too many lines to count."
      : point.dropped_evidence
        ? " It cited lines that are not in this change."
        : "";
    return { tone: "unproven", chip: "Can't tell", why: `The reviewer could not decide this point.${cited}`, todo: "Decide it yourself." };
  }
  if (point.noticed === "unstable") {
    return {
      tone: "unproven",
      chip: "Unstable answer",
      why: "The reviewer says this is met, but it answered differently on two identical reviews.",
      todo: "Read the lines and decide yourself.",
    };
  }
  if (point.tests_only) {
    return {
      tone: "unproven",
      chip: "Only a test as proof",
      why: "The reviewer says this is met, but every line it cites is in a test, and the tests were not run.",
      todo: "Read the lines and decide yourself.",
    };
  }
  if (point.proven) {
    return {
      tone: "verified",
      chip: "Proven",
      why: `The reviewer says this is met. When we broke the lines it cites, it took back "met" every time (${point.broken_total} of ${point.broken_total}), and it stayed quiet on ${point.harmless_near === 1 ? "the harmless edit" : `all ${point.harmless_near} harmless edits`} there.`,
      todo: "No reading needed.",
    };
  }
  if (point.noticed === "yes") {
    const gaps = [
      point.broken_total < 2 ? `only ${point.broken_total === 1 ? "one break was" : `${point.broken_total} breaks were`} planted here` : null,
      (point.broken_withdrew ?? 0) < point.broken_total ? "it flagged the line but still called the point met" : null,
      !point.harmless_near ? "no harmless edit was tested here" : (point.harmless_near_alarms ?? 0) > 0 ? "it also raised the alarm on a harmless edit here" : null,
    ].filter(Boolean);
    return {
      tone: "unproven",
      chip: `Noticed ${point.broken_noticed} of ${point.broken_total}, not proven`,
      why: `The reviewer says this is met and reacted to every break we planted in the lines it cites, but ${gaps.join("; ") || "the test was too small"}.`,
      todo: "Read the lines and decide yourself.",
    };
  }
  return {
    tone: "unproven",
    chip: "Not tested",
    why: point.aimed_elsewhere
      ? "The reviewer says this is met, but our breaks fell outside the lines it cites, so that answer is untested."
      : "The reviewer says this is met, but we planted nothing against this point, so that answer is untested.",
    todo: "Read the lines and decide yourself.",
  };
}

/**
 * The review as steps, in the order of three questions: what does done mean (the owner's objectives),
 * can the AI be believed (the reviewer's test), and what is left for a person (everything the test did not
 * prove, the reviewer's findings, then the sign-off). Proven objectives share one step: trust earned is
 * reading saved.
 */
export function buildSteps(exam: Exam, reviewer: Reviewer): Step[] {
  const plants = new Map(exam.plants.map((plant) => [plant.id, plant]));
  const blind = reviewer.read_yourself.map((id) => plants.get(id)).filter((plant): plant is Plant => Boolean(plant));
  const kept = new Set(keptIds(exam, reviewer));
  const points = reviewer.points.filter((point) => kept.has(point.id));

  const steps: Step[] = [
    { id: "objectives", kind: "objectives" },
    { id: "intro", kind: "intro" },
  ];
  const proven = points.filter((point) => point.proven);
  if (proven.length > 0) steps.push({ id: "proven", kind: "proven", points: proven });
  const attached = new Set<string>();
  for (const point of points.filter((item) => !item.proven)) {
    // A blind spot belongs to a point only when the break sat in lines this reviewer cited for it.
    const spots = blind.filter((plant) => point.missed_plants.includes(plant.id));
    spots.forEach((plant) => attached.add(plant.id));
    steps.push({ id: `point:${point.id}`, kind: "point", point, spots, ...describePoint(point, spots) });
  }
  for (const objective of exam.approval?.objectives.filter((item) => item.added && item.decision === "keep") ?? []) {
    steps.push({ id: `added:${objective.id}`, kind: "added", objective });
  }
  const loose = blind.filter((plant) => !attached.has(plant.id));
  if (loose.length > 0) steps.push({ id: "spots", kind: "spots", spots: loose });
  if (reviewer.findings.length > 0) steps.push({ id: "findings", kind: "findings", findings: reviewer.findings });
  steps.push({ id: "sign", kind: "sign" });
  return steps;
}

export type StepState = {
  done: boolean;
  /** The person found something wrong here, so the change cannot be accepted. */
  flagged: boolean;
  /** What the person said, for the step list and the sign-off summary. */
  answer: string | null;
};

const DECISION_TEXT: Record<string, string> = { accept: "Accepted", full_read: "Sent for a full read", reject: "Rejected" };

export function decisionText(decision: string): string {
  return DECISION_TEXT[decision] ?? decision;
}

function spotsState(spots: Plant[], progress: Progress): { left: number; wrong: number } {
  return {
    left: spots.filter((plant) => !progress.spots[plant.id]).length,
    wrong: spots.filter((plant) => progress.spots[plant.id] === "wrong").length,
  };
}

const ANSWER_TEXT: Record<PointAnswer, string> = { met: "You say it is met", not_met: "You say it is not met", cannot_tell: "You can't tell: risk you accept" };

export function stepState(step: Step, progress: Progress, signed: SignOff | null, exam?: Exam): StepState {
  switch (step.kind) {
    case "objectives":
      return {
        done: exam?.approval != null,
        flagged: false,
        answer: exam?.approval ? `Approved by ${exam.approval.name}` : null,
      };
    case "intro":
      return { done: progress.intro, flagged: false, answer: progress.intro ? "Seen" : null };
    case "proven": {
      const accepted = step.points.every((point) => progress.points[point.id] === "met");
      return { done: accepted, flagged: false, answer: accepted ? "Accepted as proven" : null };
    }
    case "added": {
      const answer = progress.points[step.objective.id];
      return { done: answer != null, flagged: answer === "not_met", answer: answer ? ANSWER_TEXT[answer] : null };
    }
    case "point": {
      const { left, wrong } = spotsState(step.spots, progress);
      const answer = progress.points[step.point.id];
      const said = answer ? ANSWER_TEXT[answer] : null;
      const spotNote = wrong > 0 ? `${wrong} ${wrong === 1 ? "spot looks" : "spots look"} wrong` : null;
      return {
        done: left === 0 && answer != null,
        flagged: wrong > 0 || answer === "not_met",
        answer: [said, spotNote].filter(Boolean).join(" · ") || null,
      };
    }
    case "spots": {
      const { left, wrong } = spotsState(step.spots, progress);
      const decided = step.spots.length - left;
      return {
        done: left === 0,
        flagged: wrong > 0,
        answer: decided === 0 ? null : wrong > 0 ? `${wrong} ${wrong === 1 ? "spot looks" : "spots look"} wrong` : left === 0 ? "All look right" : `${decided} of ${step.spots.length} checked`,
      };
    }
    case "findings": {
      const answers = step.findings.map((_, index) => progress.findings[String(index)]);
      const real = answers.filter((answer) => answer === "real").length;
      const decided = answers.filter(Boolean).length;
      return {
        done: decided === answers.length,
        flagged: real > 0,
        answer:
          decided === 0
            ? null
            : real > 0
              ? `${real} real ${real === 1 ? "problem" : "problems"}`
              : decided === answers.length
                ? "No real problem"
                : `${decided} of ${answers.length} checked`,
      };
    }
    case "sign":
      return { done: signed != null, flagged: false, answer: signed ? `${decisionText(signed.decision)} by ${signed.name}` : null };
  }
}

/** What a step is called in the list and in its header. */
export function stepLabel(step: Step): { eyebrow: string; title: string } {
  switch (step.kind) {
    case "objectives":
      return { eyebrow: "The owner", title: "What does done mean?" };
    case "intro":
      return { eyebrow: "Before you start", title: "Can the AI reviewer be believed on this change?" };
    case "proven":
      return {
        eyebrow: "Proven by our test",
        title: `${step.points.length === 1 ? "One objective" : `${step.points.length} objectives`} the AI's answer held up on`,
      };
    case "added":
      return { eyebrow: `Added by the owner · ${step.objective.id}`, title: step.objective.text };
    case "point":
      return { eyebrow: `Requirement ${step.point.id}`, title: step.point.text };
    case "spots":
      return { eyebrow: "Other blind spots", title: `${step.spots.length === 1 ? "A spot" : `${step.spots.length} spots`} where the reviewer missed our breaks` };
    case "findings":
      return {
        eyebrow: "Reviewer's findings",
        title: `${step.findings.length === 1 ? "A problem" : `${step.findings.length} problems`} the reviewer reported in the real code`,
      };
    case "sign":
      return { eyebrow: "Last step", title: "Sign off" };
  }
}

/** One block of code to show for a step: cited lines, with any blind spots that sit on them. */
export type Card = { file: string; start: number; end: number; cited: EvidenceRef | null; spots: Plant[] };

const overlaps = (a: { file: string; line_start: number; line_end: number }, b: { file: string; line_start: number; line_end: number }) =>
  sameFile(a.file, b.file) && a.line_start <= b.line_end && a.line_end >= b.line_start;

/** Everything to read for one requirement point: each citation once, and each blind spot once. */
export function pointCards(step: PointStep): Card[] {
  const placed = new Set<string>();
  const cards: Card[] = step.point.evidence.map((cited) => {
    const spots = step.spots.filter((plant) => !placed.has(plant.id) && overlaps(plant, cited));
    spots.forEach((plant) => placed.add(plant.id));
    return {
      file: cited.file,
      start: Math.min(cited.line_start, ...spots.map((plant) => plant.line_start)),
      end: Math.max(cited.line_end, ...spots.map((plant) => plant.line_end)),
      cited,
      spots,
    };
  });
  for (const plant of step.spots) {
    if (!placed.has(plant.id)) cards.push({ file: plant.file, start: plant.line_start, end: plant.line_end, cited: null, spots: [plant] });
  }
  return cards;
}

export function findFile(files: FileDiff[], path: string): FileDiff | undefined {
  return files.find((file) => sameFile(file.path, path));
}

/** The rows of a file around a line range, with a few lines of context and any lines removed just before it. */
export function excerptRows(file: FileDiff, start: number, end: number, context = 3): Row[] {
  let first = -1;
  let last = -1;
  file.rows.forEach((row, index) => {
    if (row.n == null || row.n < start - context || row.n > end + context) return;
    if (first < 0) first = index;
    last = index;
  });
  if (first < 0) return [];
  while (first > 0 && file.rows[first - 1].kind === "del") first -= 1;
  return file.rows.slice(first, last + 1);
}
