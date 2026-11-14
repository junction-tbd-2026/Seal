import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { ArrowRight, CheckIcon, RepoIcon } from "./icons";
import { formatWhen, plural, prettyModel } from "./lib";
import { readSaved, storageKey, type Progress } from "./progress";
import type { Pull, PullList } from "./types";

/**
 * Where a pull request stands for the person signing:
 * "ready" to audit, "checking" while the AI check has no results yet, or "signed" and closed.
 *
 * The AI check runs by hand for now, so the page cannot tell a check that is running from one that
 * has not started: every pull request without results counts as "checking". A server that starts the
 * check when a pull request opens would report the real state.
 */
export type PullKind = "ready" | "checking" | "signed";

export function pullKind(pull: Pull): PullKind {
  return pull.status === "signed" ? "signed" : pull.status === "untested" ? "checking" : "ready";
}

const DECISION: Record<string, { label: string; border: string; text: string; wash: string; dot: string }> = {
  accept: { label: "Accepted", border: "border-caught", text: "text-caught", wash: "bg-caught-wash", dot: "bg-caught" },
  reject: { label: "Rejected", border: "border-missed", text: "text-missed", wash: "bg-missed-wash", dot: "bg-missed" },
  full_read: { label: "Full read requested", border: "border-warn", text: "text-warn", wash: "bg-warn-wash", dot: "bg-warn" },
};
const SIGNED = { label: "Signed", border: "border-line", text: "text-soft", wash: "bg-canvas", dot: "bg-soft" };

export const decisionOf = (pull: Pull) => DECISION[pull.signed?.decision ?? ""] ?? SIGNED;

/** A swirl for work that is still running. */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full border-2 border-black/10 border-t-ai motion-safe:animate-spin"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/** The audit this person started on a pull request and has not signed, for whichever AI reviewer got furthest. */
function savedAudit(pull: Pull): Progress | null {
  if (pullKind(pull) !== "ready") return null;
  let best: Progress | null = null;
  for (const reviewer of pull.reviewers) {
    const saved = readSaved(storageKey(pull.change_id, reviewer));
    if (saved && saved.done > 0 && saved.total > 0 && (!best || saved.done > best.done)) best = saved;
  }
  return best;
}

/** One line on where a pull request stands, and the colour of its dot. */
function statusOf(pull: Pull): { text: string; dot: string } {
  switch (pull.status) {
    case "needs_you":
      return { text: `AI reviewer missed planted mistakes at ${plural(pull.lines_to_read, "line")}`, dot: "bg-missed" };
    // Not "ready to sign": the steps come first, whatever the reviewer caught.
    case "clear":
      return pull.planted_defects ? { text: "AI reviewer noticed every planted mistake", dot: "bg-caught" } : { text: "AI reviewer could not be tested", dot: "bg-warn" };
    case "untested":
      return { text: "AI check running", dot: "" };
    case "signed": {
      const decision = decisionOf(pull);
      return { text: `${decision.label} by ${pull.signed?.name ?? "someone"}${pull.signed ? `, ${formatWhen(pull.signed.signed_at)}` : ""}`, dot: decision.dot };
    }
  }
}

const CLOSED_TITLE: Record<Exclude<PullKind, "ready">, string> = {
  checking: "The AI check of this pull request has not finished. It opens once the results are in.",
  signed: "This pull request is signed. A sign-off cannot be changed.",
};

/** One pull request in a compact list: the menu at the top and the side bar. Only a pull request ready to audit opens. */
function PullRow({ pull, active, inMenu, onSelect }: { pull: Pull; active: boolean; inMenu: boolean; onSelect: () => void }) {
  const kind = pullKind(pull);
  const status = statusOf(pull);
  const saved = savedAudit(pull);
  const detail = saved ? `Your audit: ${saved.done} of ${saved.total} steps done` : status.text;
  return (
    <button
      type="button"
      role={inMenu ? "menuitem" : undefined}
      onClick={onSelect}
      disabled={kind !== "ready"}
      aria-current={active ? "true" : undefined}
      title={kind === "ready" ? undefined : CLOSED_TITLE[kind]}
      className={`relative w-full rounded-lg px-3 py-2 text-left disabled:cursor-default ${active ? "bg-canvas" : "enabled:hover:bg-canvas"}`}
    >
      <span className={`flex items-start gap-2 ${kind === "ready" ? "" : "opacity-60"}`}>
        {kind === "checking" ? (
          <span className="mt-[3px]">
            <Spinner size={14} />
          </span>
        ) : (
          <i className={`mt-[7px] inline-block h-2 w-2 shrink-0 rounded-full ${status.dot}`} aria-hidden="true" />
        )}
        <span className="shrink-0 text-[13px] font-medium leading-[21px] text-soft">#{pull.number}</span>
        <span className="line-clamp-2 min-w-0 text-[14px] font-medium leading-[21px]">{pull.title}</span>
        {active && <CheckIcon size={14} className="ml-auto mt-[4px] shrink-0 text-soft" />}
      </span>
      <span className={`mt-0.5 line-clamp-2 block pl-4 text-[12.5px] leading-snug ${kind === "signed" ? decisionOf(pull).text : "text-soft"}`}>{detail}</span>
      {saved && (
        <span className="ml-4 mt-1.5 block h-[3px] overflow-hidden rounded-full bg-black/[0.08]" aria-hidden="true">
          <span className="block h-full rounded-full bg-done" style={{ width: `${Math.round((saved.done / saved.total) * 100)}%` }} />
        </span>
      )}
    </button>
  );
}

export function PullGroups({
  pulls,
  selected,
  inMenu = false,
  onSelect,
}: {
  pulls: PullList;
  selected: number | null;
  inMenu?: boolean;
  onSelect: (number: number) => void;
}) {
  const groups: [string, Pull[]][] = [
    ["Waiting for your audit", pulls.pull_requests.filter((item) => pullKind(item) === "ready")],
    ["AI check running", pulls.pull_requests.filter((item) => pullKind(item) === "checking")],
    ["Signed", pulls.pull_requests.filter((item) => pullKind(item) === "signed")],
  ];
  return (
    <div className="space-y-3">
      {groups.map(
        ([title, items]) =>
          items.length > 0 && (
            <div key={title}>
              <p className="px-3 pb-1 pt-1 text-[12.5px] text-soft">
                {title} · {items.length}
              </p>
              {items.map((item) => (
                <PullRow key={item.number} pull={item} active={item.number === selected} inMenu={inMenu} onSelect={() => onSelect(item.number)} />
              ))}
            </div>
          ),
      )}
    </div>
  );
}

export function SpotNote({ pulls }: { pulls: PullList }) {
  const spot = pulls.spot_checks;
  return (
    <div className="space-y-1.5 px-3 text-[12.5px] leading-snug text-soft">
      {spot.enabled && (
        <p title="Now and then the code shown for sign-off is a copy with a planted mistake. Accepting it is recorded.">
          {spot.rate != null && spot.rate < 1 ? `About ${Math.round(spot.rate * 100)}% of first sign-offs are spot-checks.` : "Sign-offs are spot-checked."}
          {spot.checked > 0 && ` People caught ${spot.caught} of ${spot.checked}.`}
        </p>
      )}
      <a
        href={pulls.repository_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 font-mono text-[12px] hover:text-ink"
        title="The repository this tool is watching"
      >
        <RepoIcon size={13} />
        {pulls.repository}
      </a>
    </div>
  );
}

/** Ready first, then the ones the AI is still checking, then the signed ones, the newest sign-off last. */
function ordered(pulls: Pull[], holdBack: number | null): Pull[] {
  const rank = (pull: Pull) => {
    // Right after a sign-off the pull request starts where it was, then moves down.
    const kind = pull.number === holdBack ? "ready" : pullKind(pull);
    return kind === "ready" ? 0 : kind === "checking" ? 1 : 2;
  };
  return [...pulls].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (rank(a) === 2) return (a.signed?.signed_at ?? "").localeCompare(b.signed?.signed_at ?? "");
    return a.number - b.number;
  });
}

function LandingRow({ pull, index, fresh, onOpen }: { pull: Pull; index: number; fresh: boolean; onOpen: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const kind = pullKind(pull);
  const status = statusOf(pull);
  const saved = savedAudit(pull);
  const decision = decisionOf(pull);
  return (
    <motion.li
      layout={reduced ? false : "position"}
      initial={{ opacity: 0, y: reduced ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04, layout: { type: "spring", stiffness: 260, damping: 30 } }}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={kind !== "ready"}
        title={kind === "ready" ? undefined : CLOSED_TITLE[kind]}
        aria-label={`Pull request ${pull.number}: ${pull.title}. ${saved ? `Your audit: ${saved.done} of ${saved.total} steps done` : status.text}`}
        className={`group relative flex w-full items-center gap-4 rounded-xl px-4 py-3.5 text-left transition-[box-shadow,border-color,transform,background-color] duration-150 ${
          kind === "ready"
            ? "border border-hair bg-panel shadow-[var(--shadow-card)] hover:-translate-y-px hover:border-line hover:shadow-[0_6px_20px_rgb(0_0_0/0.06)]"
            : kind === "checking"
              ? "cursor-progress border border-hair bg-panel/70"
              : `cursor-default border-[1.5px] bg-panel/60 ${decision.border}`
        }`}
      >
        {fresh && (
          <motion.span
            className={`pointer-events-none absolute -inset-[1.5px] rounded-xl border-2 ${decision.border}`}
            initial={{ opacity: 1, scale: 1 }}
            animate={{ opacity: 0, scale: 1.03 }}
            transition={{ duration: 1.6, delay: 0.9, ease: "easeOut" }}
            aria-hidden="true"
          />
        )}
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[13px] font-semibold ${
            kind === "signed" ? `${decision.wash} ${decision.text}` : "bg-canvas text-soft group-hover:text-ink"
          }`}
        >
          #{pull.number}
        </span>
        <span className={`min-w-0 flex-1 ${kind === "ready" ? "" : "opacity-60"}`}>
          <span className="block truncate text-[15px] font-medium">{pull.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-soft">
            {kind !== "checking" && (
              <span className="inline-flex items-center gap-1.5">
                <i className={`inline-block h-1.5 w-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
                {saved ? `Your audit: ${saved.done} of ${saved.total} steps done` : status.text}
              </span>
            )}
            <span>
              {pull.author} · {plural(pull.files, "file")}
            </span>
            {pull.reviewers.length > 0 && <span className="truncate">{pull.reviewers.map(prettyModel).join(", ")}</span>}
          </span>
          {saved && (
            <span className="mt-2 block h-[3px] w-48 max-w-full overflow-hidden rounded-full bg-black/[0.08]" aria-hidden="true">
              <span className="block h-full rounded-full bg-done" style={{ width: `${Math.round((saved.done / saved.total) * 100)}%` }} />
            </span>
          )}
        </span>
        <span className="shrink-0">
          {kind === "ready" ? (
            <span className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-soft group-hover:text-ink">
              {saved ? "Continue audit" : "Start audit"}
              <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
            </span>
          ) : kind === "checking" ? (
            <span className="inline-flex items-center gap-2 text-[13px] text-soft">
              <Spinner size={18} />
              <span className="hidden sm:inline">AI check running</span>
            </span>
          ) : (
            <span className={`inline-flex h-6 items-center rounded-md px-2 text-[12.5px] font-medium ${decision.wash} ${decision.text}`}>{decision.label}</span>
          )}
        </span>
      </button>
    </motion.li>
  );
}

/**
 * The landing page: every pull request in one list in the middle of the screen. A pull request
 * opens as an audit when it is ready; after the sign-off the page comes back here, and the signed
 * pull request settles at the bottom, greyed, with the colour of the decision around it.
 */
export function Landing({ pulls, justSigned, onOpen }: { pulls: PullList; justSigned: number | null; onOpen: (number: number) => void }) {
  // Show the pull request just signed in its old place for a moment, then let it move down.
  const [holdBack, setHoldBack] = useState(justSigned);
  useEffect(() => {
    if (holdBack == null) return;
    const timer = window.setTimeout(() => setHoldBack(null), 650);
    return () => window.clearTimeout(timer);
  }, [holdBack]);

  const list = ordered(pulls.pull_requests, holdBack);
  const count = (kind: PullKind) => pulls.pull_requests.filter((pull) => pullKind(pull) === kind).length;
  const summary = [
    count("ready") > 0 && `${count("ready")} waiting for you`,
    count("checking") > 0 && `${count("checking")} AI check running`,
    count("signed") > 0 && `${count("signed")} signed`,
  ].filter(Boolean);

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-[46rem] px-4 pb-16 pt-[7vh]">
        <div className="flex items-center gap-4">
          <img src="/seal.svg" alt="" className="h-14 w-14 shrink-0 drop-shadow-[0_2px_4px_rgb(0_0_0/0.06)]" />
          <div>
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.015em]">Pull requests to audit</h1>
            <p className="mt-1 text-[14px] text-soft">Open one to audit its AI review, then sign. Signed pull requests move to the bottom.</p>
          </div>
        </div>
        <p className="mt-8 px-1 text-[13px] text-soft">{summary.join(" · ") || "No pull requests yet."}</p>
        <ol className="mt-2.5 space-y-2.5">
          {list.map((pull, index) => (
            <LandingRow key={pull.number} pull={pull} index={index} fresh={pull.number === justSigned} onOpen={() => onOpen(pull.number)} />
          ))}
        </ol>
        <div className="mt-8">
          <SpotNote pulls={pulls} />
        </div>
      </div>
    </div>
  );
}
