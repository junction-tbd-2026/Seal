import type { Approval, ChangeSummary, Exam, Judgement, Ledger, PlantKind, PullList, Result, SignResult, SpotVerdict } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as T;
}

export const fetchChanges = () => getJson<ChangeSummary[]>("/api/changes");

export const fetchPulls = () => getJson<PullList>("/api/pulls");

/** The change to show for sign-off. It may be a spot-check copy; the page cannot tell and must not try to. */
export const fetchReview = (changeId: string) => getJson<Exam>(`/api/review/${encodeURIComponent(changeId)}`);

async function postJson<T>(url: string, body: unknown, what: string): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(typeof detail?.detail === "string" ? detail.detail : `${what} was refused (${response.status})`);
  }
  return (await response.json()) as T;
}

export const postSignOff = (body: {
  session: string;
  reviewer: string;
  name: string;
  decision: string;
  spots: { plant_id: string; verdict: SpotVerdict }[];
  points: Record<string, string>;
  findings: Record<string, string>;
}) => postJson<SignResult>("/api/signoff", body, "The sign-off");

export const postApproval = (
  changeId: string,
  body: { name: string; objectives: { id: string; decision: string; risk: string }[]; added: { text: string; risk: string }[] },
) => postJson<Approval>(`/api/objectives/${encodeURIComponent(changeId)}`, body, "The approval");

export const fetchLedger = () => getJson<Ledger>("/api/ledger");

/** What each judgement means, in plain words. */
export const JUDGEMENT: Record<Judgement, { word: string; meaning: string; tone: string }> = {
  sharp: { word: "Sharp", meaning: "noticed the breaks and stayed quiet on harmless edits", tone: "bg-caught text-white" },
  jumpy: { word: "Jumpy", meaning: "reacted to harmless edits about as often as to real breaks", tone: "bg-warn text-ink" },
  blind: { word: "Blind", meaning: "noticed almost none of the breaks", tone: "bg-missed text-white" },
  mixed: { word: "Mixed", meaning: "missed breaks and raised false alarms", tone: "bg-warn text-ink" },
  untested: { word: "Too few tests", meaning: "too few planted edits to judge", tone: "bg-canvas text-ink" },
};

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

export function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
