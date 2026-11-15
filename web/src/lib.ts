import type { ChangeSummary, Exam, PlantKind, PullList, Result, SignResult, SpotVerdict } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

export const fetchChanges = () => getJson<ChangeSummary[]>("/api/changes");

export const fetchPulls = () => getJson<PullList>("/api/pulls");

/** The change to show for sign-off. It may be a spot-check copy; the page cannot tell and must not try to. */
export const fetchReview = (changeId: string) => getJson<Exam>(`/api/review/${encodeURIComponent(changeId)}`);

export async function postSignOff(body: {
  session: string;
  reviewer: string;
  name: string;
  decision: string;
  spots: { plant_id: string; verdict: SpotVerdict }[];
}): Promise<SignResult> {
  const response = await fetch("/api/signoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? `sign-off was refused (${response.status})`);
  }
  return (await response.json()) as SignResult;
}

/** "google/gemma-4-31B-it" -> "Gemma 4 31B"; "nemotron-3.5-super-vl" -> "Nemotron 3.5 Super VL". */
export function prettyModel(name: string): string {
  const base = name.split("/").pop() ?? name;
  return base
    .replace(/-it$/i, "")
    .split("-")
    .map((word) => (/^[a-z]{1,2}$/.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

export const RESULT_LABEL: Record<Result, string> = {
  caught: "Caught",
  missed: "Missed",
  left_alone: "Left alone",
  false_alarm: "False alarm",
  failed: "No answer",
  inconclusive: "Not scored",
};

/** What each result means for trust, in one line. */
export const RESULT_MEANING: Record<Result, string> = {
  caught: "The reviewer flagged the planted defect.",
  missed: "The reviewer said nothing about the planted defect.",
  left_alone: "A harmless edit, and the reviewer correctly stayed quiet.",
  false_alarm: "A harmless edit that the reviewer wrongly reported as a problem.",
  failed: "The reviewer gave no usable answer for this copy, so it is left out of the score.",
  inconclusive: "The reviewer had already flagged this spot in the real change, so this copy proves nothing.",
};

export const KIND_LABEL: Record<PlantKind, string> = {
  bug: "Bug",
  omission: "Omission",
  harmless: "Harmless",
  historical: "Past bug",
};

export const KIND_MEANING: Record<PlantKind, string> = {
  bug: "A wrong line the reviewer should flag.",
  omission: "Required behaviour taken out of the change.",
  harmless: "A rewrite that changes nothing. The reviewer should stay quiet.",
  historical: "A real bug this project once had, put back in.",
};

/** The reviewer may cite a file by a shorter path than the change uses. */
export function sameFile(a: string, b: string): boolean {
  return a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
}

export function lineRange(start: number, end: number): string {
  return end > start ? `${start}–${end}` : `${start}`;
}

/**
 * The name of a review objective as the page shows it: "O2" for the pipeline's "R2".
 * "R" alone reads as "requirement", and the requirement is the whole issue, not one objective.
 */
export function objectiveName(id: string): string {
  const number = /^R(\d+)$/i.exec(id.trim());
  return number ? `O${number[1]}` : id;
}

/** The family name of a model, for running text: "Nemotron 3.5 Super VL" -> "Nemotron". */
export function shortModel(name: string): string {
  return prettyModel(name).split(" ")[0] ?? name;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

const DECLARATION = [
  // C#, Java, TypeScript members: modifiers, a type, then the name and its parameters.
  /^\s*(?:\[[^\]]*\]\s*)*(?:(?:public|private|protected|internal|static|async|override|virtual|sealed|abstract|readonly|partial|unsafe|extern|new|export|default)\s+)+[\w<>[\],.?\s]*?\b(\w+)\s*(?:<[^>]*>)?\s*\(/,
  /\b(?:class|struct|interface|record|enum|trait|impl)\s+(\w+)/,
  /^\s*(?:async\s+)?def\s+(\w+)\s*\(/,
  /\bfunction\s+(\w+)\s*\(/,
  /^func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/,
  /\bfn\s+(\w+)\s*[<(]/,
];

/** The method, type or heading a run of lines sits in, when one of the lines declares it: "TypeCollector(…)". */
export function symbolOf(lines: string[]): string | null {
  for (const line of lines) {
    const heading = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (heading) return heading[1];
    for (const pattern of DECLARATION) {
      const match = pattern.exec(line);
      if (!match) continue;
      return /\b(?:class|struct|interface|record|enum|trait|impl)\s/.test(line) && !line.includes("(") ? line.trim().replace(/\s*[{:].*$/, "") : `${match[1]}(…)`;
    }
  }
  return null;
}

export function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
