import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, CheckIcon, RepoIcon } from "./icons";
import { formatWhen, plural, prettyModel } from "./lib";
import { readSaved, storageKey, type Progress } from "./progress";
import type { Pull, PullList } from "./types";

/**
 * Where a pull request stands for the person signing:
 * "ready" to audit, "checking" while the AI check has no results yet,
 * "followup" once signed as rejected or sent for a full read, "done" once signed as accepted.
 *
 * The AI check runs by hand for now, so the page cannot tell a check that is running from one that
 * has not started: every pull request without results counts as "checking". A server that starts the
 * check when a pull request opens would report the real state.
 */
export type Stage = "ready" | "checking" | "followup" | "done";

export function stageOf(pull: Pull): Stage {
  if (pull.status === "untested") return "checking";
  if (pull.status !== "signed") return "ready";
  return pull.signed?.decision === "accept" ? "done" : "followup";
}

/** Only a pull request ready to audit opens. A signed one is closed for good. */
export const canOpen = (pull: Pull) => stageOf(pull) === "ready";

type Decision = { label: string; next: string; border: string; text: string; wash: string; dot: string };

const DECISION: Record<string, Decision> = {
  accept: { label: "Accepted", next: "", border: "border-caught/50", text: "text-caught", wash: "bg-caught-wash", dot: "bg-caught" },
  reject: {
    label: "Rejected",
    next: "Back to the AI agent: it fixes the change, then the AI check runs again.",
    border: "border-missed",
    text: "text-missed",
    wash: "bg-missed-wash",
    dot: "bg-missed",
  },
  full_read: {
    label: "Full read requested",
    next: "A person reads the whole change on GitHub before anything is merged.",
    border: "border-warn",
    text: "text-warn",
    wash: "bg-warn-wash",
    dot: "bg-warn",
  },
};
const SIGNED: Decision = { label: "Signed", next: "", border: "border-line", text: "text-soft", wash: "bg-canvas", dot: "bg-soft" };

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
  if (!canOpen(pull)) return null;
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

const CLOSED_TITLE: Record<Exclude<Stage, "ready">, string> = {
  checking: "The AI check of this pull request has not finished. It opens once the results are in.",
  followup: "This pull request is signed. A sign-off cannot be changed.",
  done: "This pull request is signed and accepted. A sign-off cannot be changed.",
};

/** One pull request in a compact list: the menu at the top and the side bar. Only a pull request ready to audit opens. */
function PullRow({ pull, active, inMenu, onSelect }: { pull: Pull; active: boolean; inMenu: boolean; onSelect: () => void }) {
  const stage = stageOf(pull);
  const status = statusOf(pull);
  const saved = savedAudit(pull);
  const detail = saved ? `Your audit: ${saved.done} of ${saved.total} steps done` : status.text;
  return (
    <button
      type="button"
      role={inMenu ? "menuitem" : undefined}
      onClick={onSelect}
      disabled={stage !== "ready"}
      aria-current={active ? "true" : undefined}
      title={stage === "ready" ? undefined : CLOSED_TITLE[stage]}
      className={`relative w-full rounded-lg px-3 py-2 text-left disabled:cursor-default ${active ? "bg-canvas" : "enabled:hover:bg-canvas"}`}
    >
      <span className={`flex items-start gap-2 ${stage === "ready" ? "" : "opacity-60"}`}>
        {stage === "checking" ? (
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
      <span className={`mt-0.5 line-clamp-2 block pl-4 text-[12.5px] leading-snug ${pull.status === "signed" ? decisionOf(pull).text : "text-soft"}`}>{detail}</span>
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
    ["Waiting for your audit", pulls.pull_requests.filter((item) => stageOf(item) === "ready")],
    ["AI check running", pulls.pull_requests.filter((item) => stageOf(item) === "checking")],
    ["Needs follow-up", pulls.pull_requests.filter((item) => stageOf(item) === "followup")],
    ["Accepted", pulls.pull_requests.filter((item) => stageOf(item) === "done")],
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

function GitHubLink({ pull, strong }: { pull: Pull; strong?: boolean }) {
  return (
    <a
      href={pull.url}
      target="_blank"
      rel="noreferrer"
      title={`Open pull request #${pull.number} on GitHub`}
      className={
        strong
          ? "btn h-8 px-3 text-[13px]"
          : "inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-soft hover:bg-canvas hover:text-ink"
      }
    >
      {strong ? "Read on GitHub" : "GitHub"}
      <ArrowUpRight size={14} />
    </a>
  );
}

function LandingRow({ pull, index, fresh, onOpen }: { pull: Pull; index: number; fresh: boolean; onOpen: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const stage = stageOf(pull);
  const status = statusOf(pull);
  const saved = savedAudit(pull);
  const decision = decisionOf(pull);
  const quiet = stage === "checking" || stage === "done";

  const shell =
    stage === "ready"
      ? "border border-hair bg-panel shadow-[var(--shadow-card)] hover:-translate-y-px hover:border-line hover:shadow-[0_6px_20px_rgb(0_0_0/0.06)]"
      : stage === "checking"
        ? "cursor-progress border border-hair bg-panel/70"
        : stage === "followup"
          ? `border-[1.5px] bg-panel ${decision.border}`
          : `border-[1.5px] bg-panel/60 ${decision.border}`;

  const body = (
    <>
      {fresh && (
        <motion.span
          className={`pointer-events-none absolute -inset-[1.5px] rounded-xl border-2 ${decision.border.replace("/50", "")}`}
          initial={{ opacity: 1, scale: 1 }}
          animate={{ opacity: 0, scale: 1.03 }}
          transition={{ duration: 1.6, delay: 1, ease: "easeOut" }}
          aria-hidden="true"
        />
      )}
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[13px] font-semibold ${
          pull.status === "signed" ? `${decision.wash} ${decision.text}` : "bg-canvas text-soft group-hover:text-ink"
        }`}
      >
        {stage === "done" ? <CheckIcon size={16} strokeWidth={2.4} /> : `#${pull.number}`}
      </span>
      <span className={`min-w-0 flex-1 ${quiet ? "opacity-60" : ""}`}>
        <span className="line-clamp-2 block text-[15px] font-medium">
          {stage === "done" && <span className="mr-1.5 text-soft">#{pull.number}</span>}
          {pull.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-soft">
          {stage !== "checking" && (
            <span className={`inline-flex items-center gap-1.5 ${pull.status === "signed" ? decision.text : ""}`}>
              <i className={`inline-block h-1.5 w-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
              {saved ? `Your audit: ${saved.done} of ${saved.total} steps done` : status.text}
            </span>
          )}
          <span>
            {pull.author} · {plural(pull.files, "file")}
          </span>
          {stage !== "followup" && pull.reviewers.length > 0 && <span className="truncate">{pull.reviewers.map(prettyModel).join(", ")}</span>}
        </span>
        {stage === "followup" && decision.next && <span className="mt-1 block text-[13px] text-ink">{decision.next}</span>}
        {saved && (
          <span className="mt-2 block h-[3px] w-48 max-w-full overflow-hidden rounded-full bg-black/[0.08]" aria-hidden="true">
            <span className="block h-full rounded-full bg-done" style={{ width: `${Math.round((saved.done / saved.total) * 100)}%` }} />
          </span>
        )}
      </span>
    </>
  );

  let action: ReactNode;
  if (stage === "ready") {
    action = (
      <span className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-soft group-hover:text-ink">
        {saved ? "Continue audit" : "Start audit"}
        <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    );
  } else if (stage === "checking") {
    action = (
      <span className="inline-flex items-center gap-2 text-[13px] text-soft">
        <Spinner size={18} />
        <span className="hidden sm:inline">AI check running</span>
      </span>
    );
  } else if (pull.signed?.decision === "full_read") {
    action = <GitHubLink pull={pull} strong />;
  } else if (stage === "followup") {
    action = (
      <span className="flex items-center gap-1">
        <span className={`inline-flex h-6 items-center rounded-md px-2 text-[12.5px] font-medium ${decision.wash} ${decision.text}`}>Back to the AI agent</span>
        <GitHubLink pull={pull} />
      </span>
    );
  } else {
    action = <GitHubLink pull={pull} />;
  }

  const row = "group relative flex w-full items-center gap-4 rounded-xl px-4 py-3.5 text-left transition-[box-shadow,border-color,transform,background-color] duration-150";

  return (
    <motion.li
      layoutId={reduced ? undefined : `pull-${pull.number}`}
      initial={{ opacity: 0, y: reduced ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04, layout: { type: "spring", stiffness: 260, damping: 30 } }}
    >
      {stage === "ready" ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Pull request ${pull.number}: ${pull.title}. ${saved ? `Your audit: ${saved.done} of ${saved.total} steps done` : status.text}`}
          className={`${row} ${shell}`}
        >
          {body}
          <span className="shrink-0">{action}</span>
        </button>
      ) : (
        <div title={CLOSED_TITLE[stage]} className={`${row} ${shell}`}>
          {body}
          <span className="shrink-0">{action}</span>
        </div>
      )}
    </motion.li>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="mt-9 first:mt-8">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 px-1">
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        <p className="text-[12.5px] text-faint">{hint}</p>
      </header>
      <ol className="mt-2.5 space-y-2.5">{children}</ol>
    </section>
  );
}

/**
 * The landing page: every pull request in one list in the middle of the screen, in three parts.
 * At the top what is ready for a person (and what the AI is still checking), then what was signed
 * but needs follow-up (rejected, or sent for a full read), and at the bottom an archive of what was
 * accepted. After a sign-off the page comes back here and the signed pull request moves to its part.
 */
export function Landing({ pulls, justSigned, onOpen }: { pulls: PullList; justSigned: number | null; onOpen: (number: number) => void }) {
  // Show the pull request just signed at the top for a moment, then let it move to where it belongs.
  const [holdBack, setHoldBack] = useState(justSigned);
  useEffect(() => {
    if (holdBack == null) return;
    const timer = window.setTimeout(() => setHoldBack(null), 700);
    return () => window.clearTimeout(timer);
  }, [holdBack]);

  const placed = (pull: Pull): Stage => (pull.number === holdBack ? "ready" : stageOf(pull));
  const byNumber = (a: Pull, b: Pull) => a.number - b.number;
  // The newest sign-off last, so a pull request just signed lands at the very bottom of its part.
  const bySignedAt = (a: Pull, b: Pull) => (a.signed?.signed_at ?? "").localeCompare(b.signed?.signed_at ?? "");
  const all = pulls.pull_requests;
  const waiting = [
    ...all.filter((pull) => placed(pull) === "ready").sort(byNumber),
    ...all.filter((pull) => placed(pull) === "checking").sort(byNumber),
  ];
  const followup = all.filter((pull) => placed(pull) === "followup").sort(bySignedAt);
  const done = all.filter((pull) => placed(pull) === "done").sort(bySignedAt);
  const checking = all.filter((pull) => stageOf(pull) === "checking").length;
  const ready = waiting.length - checking;

  let index = 0;
  const rows = (list: Pull[]) =>
    list.map((pull) => <LandingRow key={pull.number} pull={pull} index={index++} fresh={pull.number === justSigned} onOpen={() => onOpen(pull.number)} />);

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-[46rem] px-4 pb-16 pt-[7vh]">
        <div className="flex items-center gap-4">
          <img src="/seal.svg" alt="" className="h-14 w-14 shrink-0 drop-shadow-[0_2px_4px_rgb(0_0_0/0.06)]" />
          <div>
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.015em]">Pull requests to audit</h1>
            <p className="mt-1 text-[14px] text-soft">Open one to audit its AI review, then sign. Signed pull requests move down the list.</p>
          </div>
        </div>

        <LayoutGroup>
          <Section
            title="Ready for your audit"
            hint={[ready > 0 && `${ready} checked by the AI`, checking > 0 && `${checking} AI check running`].filter(Boolean).join(" · ") || "Nothing waiting"}
          >
            {waiting.length > 0 ? (
              rows(waiting)
            ) : (
              <li className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-[13.5px] text-soft">Nothing is waiting for you.</li>
            )}
          </Section>
          {followup.length > 0 && (
            <Section title="Needs follow-up" hint="Rejected, or sent for a full human read">
              {rows(followup)}
            </Section>
          )}
          {done.length > 0 && (
            <Section title="Accepted" hint="Signed and done">
              {rows(done)}
            </Section>
          )}
        </LayoutGroup>

        <div className="mt-10">
          <SpotNote pulls={pulls} />
        </div>
      </div>
    </div>
  );
}
