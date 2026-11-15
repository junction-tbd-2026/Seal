import type { PullList, ServerPullList, SignOff, SpotPolicy, SpotRecord } from "./types";

/**
 * What this browser has done: its sign-offs and how it did on spot-checks. It lives in the
 * browser only, so a large audience can try the demo at once without signing for each other.
 * The server keeps none of it; the page tells it what it needs with each request.
 */
const KEY = "seal:local:v1";

type SpotEntry = { change_id: string; caught: boolean; spotted: boolean; decided_at: string };
type Local = { visitor: string; signoffs: SignOff[]; spotChecks: SpotEntry[] };

/** Used when storage is blocked (some private windows). Lasts until the page reloads. */
let memory: Local | null = null;

function newVisitor(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function isSignOff(value: unknown): value is SignOff {
  return (
    isObject(value) &&
    typeof value.change_id === "string" &&
    typeof value.reviewer === "string" &&
    typeof value.name === "string" &&
    typeof value.decision === "string" &&
    typeof value.signed_at === "string"
  );
}

function isSpotEntry(value: unknown): value is SpotEntry {
  return isObject(value) && typeof value.change_id === "string" && typeof value.caught === "boolean";
}

function read(): Local | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!isObject(data)) return null;
    return {
      visitor: typeof data.visitor === "string" && data.visitor ? data.visitor : newVisitor(),
      signoffs: Array.isArray(data.signoffs) ? data.signoffs.filter(isSignOff) : [],
      spotChecks: Array.isArray(data.spotChecks) ? data.spotChecks.filter(isSpotEntry) : [],
    };
  } catch {
    return null;
  }
}

function save(local: Local): void {
  memory = local;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(local));
  } catch {
    // Kept in memory for this visit only.
  }
}

/** Read fresh each time, so two tabs of the same browser agree. */
function load(): Local {
  const saved = read();
  if (saved) return (memory = saved);
  if (!memory) save({ visitor: newVisitor(), signoffs: [], spotChecks: [] });
  return memory!;
}

/** A random id this browser made up. The server uses it only to keep a spot-check in place across reloads. */
export const visitorId = (): string => load().visitor;

export const signoffsFor = (changeId: string): SignOff[] => load().signoffs.filter((entry) => entry.change_id === changeId);

export function addSignoff(entry: SignOff): void {
  const local = load();
  save({ ...local, signoffs: [...local.signoffs, entry] });
}

/** Whether this browser has signed the spot-check of this pull request, so the real change comes next. */
export const spotChecked = (changeId: string): boolean => load().spotChecks.some((entry) => entry.change_id === changeId);

export function spotRecord(policy: SpotPolicy): SpotRecord {
  const { spotChecks } = load();
  return { ...policy, checked: spotChecks.length, caught: spotChecks.filter((entry) => entry.caught).length };
}

/** Keeps how a spot-check went and returns this browser's record including it. */
export function addSpotCheck(entry: SpotEntry, policy: SpotPolicy): SpotRecord {
  const local = load();
  save({ ...local, spotChecks: [...local.spotChecks, entry] });
  return spotRecord(policy);
}

/** The server's list of pull requests, with this browser's sign-offs and spot-check record laid over it. */
export function withLocal(list: ServerPullList): PullList {
  const { signoffs } = load();
  return {
    ...list,
    pull_requests: list.pull_requests.map((pull) => {
      if (pull.status === "untested") return pull;
      const mine = signoffs.filter((entry) => entry.change_id === pull.change_id);
      const signed = mine[mine.length - 1];
      return signed ? { ...pull, status: "signed", signed } : pull;
    }),
    spot_checks: spotRecord(list.spot_checks),
  };
}
