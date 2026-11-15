import { objectiveName, sameFile } from "./lib";
import type { EvidenceRef, Exam, FileDiff, Finding, Plant, PointView, Reviewer, Row, SignOff, SpotVerdict } from "./types";

/**
 * The review as a list of steps, and what one person has checked so far.
 *
 * Checks are kept in this browser so a review can be paused and picked up later.
 * They belong to the exact code and reviewer results they were made on: if either
 * changes, the saved checks are thrown away instead of being applied to code the
 * person has not seen.
 */

export type PointAnswer = "met" | "not_met";
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

const PREFIX = "reviewer-controls:review:v1:";

export const storageKey = (changeId: string, reviewerName: string) => `${PREFIX}${changeId}:${reviewerName}`;

export function freshProgress(runFile: string, code: string): Progress {
  return { runFile, code, step: "intro", intro: false, points: {}, spots: {}, findings: {}, done: 0, total: 0, savedAt: "" };
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
      step: typeof saved.step === "string" ? saved.step : "intro",
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
 * The saved checks for this review, if they were made on this code and this reviewer run.
 * `stale` says older checks existed and no longer apply.
 */
export function openProgress(key: string, runFile: string, code: string): { progress: Progress; stale: boolean } {
  const saved = readSaved(key);
  if (saved && saved.runFile === runFile && saved.code === code) return { progress: saved, stale: false };
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

/** "verified": the AI reviewer's claim passed our test. "unproven": nothing backs the claim. "risk": the claim failed the test, or is "not met". */
export type Tone = "verified" | "unproven" | "risk";

/** How the AI reviewer's claim on one objective did when we broke the code it cites. */
export type ClaimTest = { verdict: string; detail: string };

export type PointStep = {
  id: string;
  kind: "point";
  point: PointView;
  /** Lines where the AI reviewer missed a mistake we planted against this objective. */
  spots: Plant[];
  tone: Tone;
  /** What the AI reviewer claims about the objective. */
  claim: string;
  /** Whether the claim is one the person audits against cited code ("met"), or there is no such claim. */
  claimsMet: boolean;
  test: ClaimTest;
};

export type Step =
  | { id: "intro"; kind: "intro" }
  | PointStep
  | { id: "spots"; kind: "spots"; spots: Plant[] }
  | { id: "findings"; kind: "findings"; findings: Finding[] }
  | { id: "sign"; kind: "sign" };

const breaks = (count: number) => `${count} planted ${count === 1 ? "mistake" : "mistakes"}`;

/** The AI reviewer's claim on one objective, and how that claim did on our test. */
function describePoint(point: PointView, spots: Plant[]): Pick<PointStep, "tone" | "claim" | "claimsMet" | "test"> {
  const objective = objectiveName(point.id);
  if (point.status === "not_met") {
    return {
      tone: "risk",
      claim: `The change does not meet ${objective}.`,
      claimsMet: false,
      test: { verdict: "Not tested", detail: "Only “met” claims are tested with planted mistakes." },
    };
  }
  const claimsMet = point.status === "met";
  const claim = claimsMet ? `The change meets ${objective}.` : `No claim. The AI reviewer could not decide ${objective}.`;
  const missed = spots.length > 0 || point.noticed === "no" || point.noticed === "partly";
  if (missed) {
    return {
      tone: "risk",
      claim,
      claimsMet,
      test: {
        verdict: "Failed",
        detail:
          point.broken_total > 0
            ? `Planted ${breaks(point.broken_total)} in the lines it cites. It missed ${point.broken_total - point.broken_noticed}.`
            : `Missed ${breaks(spots.length)} aimed at ${objective}.`,
      },
    };
  }
  if (!claimsMet) {
    return {
      tone: "unproven",
      claim,
      claimsMet,
      test: {
        verdict: "Nothing to test",
        detail: point.broad_evidence
          ? "Its citations covered too many lines to count as evidence."
          : point.dropped_evidence
            ? "It cited lines that are not part of the change."
            : "It cited no code.",
      },
    };
  }
  if (point.noticed === "unstable") {
    return {
      tone: "unproven",
      claim,
      claimsMet,
      test: { verdict: "Unreliable", detail: "It gave two different answers in two identical reviews." },
    };
  }
  if (point.tests_only) {
    return {
      tone: "unproven",
      claim,
      claimsMet,
      test: { verdict: "Weak evidence", detail: "Every cited line is test code, and the tests were not run." },
    };
  }
  if (point.noticed === "yes") {
    return {
      tone: "verified",
      claim,
      claimsMet,
      test: {
        verdict: "Passed",
        detail: `Planted ${breaks(point.broken_total)} in the lines it cites. It missed none.`,
      },
    };
  }
  return {
    tone: "unproven",
    claim,
    claimsMet,
    test: {
      verdict: "Not tested",
      detail: point.aimed_elsewhere ? "No planted mistake landed inside the cited lines." : `No mistake was planted against ${objective}.`,
    },
  };
}

/** The review as steps: the reviewer's test, each requirement point, anything left over, then the sign-off. */
export function buildSteps(exam: Exam, reviewer: Reviewer): Step[] {
  const plants = new Map(exam.plants.map((plant) => [plant.id, plant]));
  const blind = reviewer.read_yourself.map((id) => plants.get(id)).filter((plant): plant is Plant => Boolean(plant));
  const pointIds = new Set(reviewer.points.map((point) => point.id));

  const steps: Step[] = [{ id: "intro", kind: "intro" }];
  for (const point of reviewer.points) {
    const spots = blind.filter((plant) => plant.breaks === point.id);
    steps.push({ id: `point:${point.id}`, kind: "point", point, spots, ...describePoint(point, spots) });
  }
  const loose = blind.filter((plant) => !plant.breaks || !pointIds.has(plant.breaks));
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

export function stepState(step: Step, progress: Progress, signed: SignOff | null): StepState {
  switch (step.kind) {
    case "intro":
      return { done: progress.intro, flagged: false, answer: progress.intro ? "Read" : null };
    case "point": {
      const { left, wrong } = spotsState(step.spots, progress);
      const answer = progress.points[step.point.id];
      const objective = objectiveName(step.point.id);
      const said = answer === "met" ? `Your verdict: ${objective} is met` : answer === "not_met" ? `Your verdict: ${objective} is not met` : null;
      const spotNote = wrong > 0 ? `${wrong} red ${wrong === 1 ? "line" : "lines"} judged wrong` : null;
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
        answer:
          decided === 0
            ? null
            : wrong > 0
              ? `${wrong} red ${wrong === 1 ? "line" : "lines"} judged wrong`
              : left === 0
                ? "All red lines judged correct"
                : `${decided} of ${step.spots.length} red lines judged`,
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
              ? `${real} reported ${real === 1 ? "problem" : "problems"} judged real`
              : decided === answers.length
                ? "No reported problem judged real"
                : `${decided} of ${answers.length} reported problems judged`,
      };
    }
    case "sign":
      return { done: signed != null, flagged: false, answer: signed ? `${decisionText(signed.decision)} by ${signed.name}` : null };
  }
}

/** What a step is called: a short name for the progress indicator, and its heading. */
export function stepLabel(step: Step): { short: string; eyebrow: string; title: string } {
  switch (step.kind) {
    case "intro":
      return { short: "Test", eyebrow: "Start of the audit", title: "You are auditing the AI reviewer" };
    case "point":
      return { short: objectiveName(step.point.id), eyebrow: `Review objective ${objectiveName(step.point.id)}`, title: step.point.text };
    case "spots":
      return {
        short: "Missed",
        eyebrow: "Missed planted mistakes",
        title: `Judge ${step.spots.length === 1 ? "the line" : `the ${step.spots.length} lines`} where the AI reviewer missed a planted mistake`,
      };
    case "findings":
      return {
        short: "Reported",
        eyebrow: "Reported problems",
        title: `Judge ${step.findings.length === 1 ? "the problem" : `the ${step.findings.length} problems`} the AI reviewer reported`,
      };
    case "sign":
      return { short: "Sign", eyebrow: "Sign-off", title: "Sign your audit" };
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
