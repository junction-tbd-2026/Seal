import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, BotIcon, BranchIcon, CheckIcon, ClockIcon, GitHubMark, InfoIcon, RepoIcon } from "./icons";
import { formatWhen, plural, prettyModel } from "./lib";
import { readSaved, storageKey, type Progress } from "./progress";
import type { Pull, PullList } from "./types";

/**
 * Where a pull request stands for the person signing:
 * "ready" to audit, "checking" while the AI check has no results yet,
 * "rework" once rejected, while the AI agent fixes the change and the AI checks it again,
 * "followup" once sent for a full read by a person, "done" once accepted.
 *
 * The AI check runs by hand for now, so the page cannot tell a check that is running from one that
 * has not started: every pull request without results counts as "checking". A server that starts the
 * check when a pull request opens would report the real state.
 */
export type Stage = "ready" | "checking" | "rework" | "followup" | "done";

export function stageOf(pull: Pull): Stage {
  if (pull.status === "untested") return "checking";
  if (pull.status !== "signed") return "ready";
  const decision = pull.signed?.decision;
  return decision === "accept" ? "done" : decision === "reject" ? "rework" : "followup";
}


/** Only a pull request ready to audit opens. A signed one is closed for good. */
export const canOpen = (pull: Pull) => stageOf(pull) === "ready";

type Decision = { label: string; next: string; border: string; text: string; wash: string; dot: string };

const DECISION: Record<string, Decision> = {
  accept: { label: "Accepted", next: "", border: "border-caught/50", text: "text-caught", wash: "bg-caught-wash", dot: "bg-caught" },
  reject: {
    label: "Rejected",
    next: "Back with the AI agent: it fixes the change, then the AI checks it again.",
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
  rework: "Rejected and back with the AI agent. It opens again once the AI has checked the fixed change.",
  followup: "Full review required: a person reads the whole change on GitHub. A sign-off cannot be changed.",
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
        {stage === "checking" || stage === "rework" ? (
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
    ["AI check running", pulls.pull_requests.filter((item) => stageOf(item) === "checking" || stageOf(item) === "rework")],
    ["Full review required", pulls.pull_requests.filter((item) => stageOf(item) === "followup")],
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

/** The repository Seal is watching. */
export function RepoLink({ pulls }: { pulls: PullList }) {
  return (
    <a
      href={pulls.repository_url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-soft hover:text-ink"
      title="The repository Seal is watching"
    >
      <RepoIcon size={13} className="shrink-0" />
      <span className="truncate">{pulls.repository}</span>
    </a>
  );
}

/**
 * Who is signed in. A stand-in until Seal signs people in with GitHub: the account that owns the
 * repository Seal is watching. A real sign-in would also put a verified name on every sign-off.
 */
export function Account({ pulls, compact = false }: { pulls: PullList; compact?: boolean }) {
  const login = pulls.repository.split("/")[0] || "you";
  return (
    <span className="flex shrink-0 items-center gap-2" title={`Signed in with GitHub as ${login}`}>
      <span
        className="grid h-7 w-7 place-items-center rounded-full bg-ink text-[12px] font-semibold uppercase text-white ring-2 ring-panel"
        aria-hidden="true"
      >
        {login.charAt(0)}
      </span>
      <span className={compact ? "sr-only" : "hidden text-[13.5px] font-medium sm:inline"}>{login}</span>
    </span>
  );
}

/** A full read happens on GitHub, where the person reads the whole change. */
function GitHubButton({ pull }: { pull: Pull }) {
  return (
    <a href={pull.url} target="_blank" rel="noreferrer" title={`Open pull request #${pull.number} on GitHub`} className="btn h-8 px-3 text-[13px]">
      <GitHubMark size={15} />
      Read on GitHub
    </a>
  );
}

/** The pull request itself, one click away. */
function GitHubIconLink({ pull }: { pull: Pull }) {
  return (
    <a
      href={pull.url}
      target="_blank"
      rel="noreferrer"
      title={`Open pull request #${pull.number} on GitHub`}
      aria-label={`Open pull request #${pull.number} on GitHub`}
      className="pointer-events-auto relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-soft transition-colors hover:bg-canvas hover:text-ink"
    >
      <GitHubMark size={17} />
    </a>
  );
}

/** The way into an audit. Pointing at it sweeps a colour to the right, the way the audit moves on. */
function StartButton({ saved, onOpen }: { saved: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/start pointer-events-auto relative z-10 ml-auto inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-lg border border-line px-3 text-[13px] font-medium text-ink transition-colors duration-300 hover:border-transparent focus-visible:border-transparent"
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 origin-left scale-x-0 bg-gradient-to-r from-ai via-[#5a6be0] to-link transition-transform duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/start:scale-x-100 group-focus-visible/start:scale-x-100 motion-reduce:transition-none"
      />
      <span className="relative transition-colors duration-200 group-hover/start:text-white group-focus-visible/start:text-white">
        {saved ? "Continue audit" : "Start audit"}
      </span>
      <ArrowRight
        size={15}
        className="relative transition-[transform,color] duration-300 group-hover/start:translate-x-1 group-hover/start:text-white group-focus-visible/start:translate-x-1 group-focus-visible/start:text-white motion-reduce:transition-none"
      />
    </button>
  );
}

/**
 * How long ago, roughly: "less than a minute", "12 min", "5 h", "3 days", "4 months". Measured against the
 * clock of the computer showing the page. No seconds: a queue that counts seconds is only restless.
 */
function age(iso: string | undefined, now: number): string | null {
  const then = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.floor((now - then) / 60000));
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 60) return plural(days, "day");
  return plural(Math.floor(days / 30), "month");
}

/**
 * A short explanation shown on hover or keyboard focus. It is drawn on top of the page, so the
 * scrolling columns of the board cannot cut it off.
 */
function Hint({ text, children }: { text: string; children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  const show = () => setBox(anchor.current?.getBoundingClientRect() ?? null);
  const hide = () => setBox(null);
  return (
    <>
      <span
        ref={anchor}
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-label={text}
        className="inline-flex cursor-help items-start gap-1 rounded outline-offset-2"
      >
        {children}
        <InfoIcon size={13} className="mt-[3px] shrink-0 opacity-70" />
      </span>
      {box &&
        createPortal(
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none fixed z-[60] block w-max max-w-[17rem] rounded-lg bg-ink px-2.5 py-1.5 text-[12.5px] leading-snug text-white shadow-[var(--shadow-pop)]"
            style={{ left: Math.max(8, Math.min(box.left, window.innerWidth - 280)), top: box.bottom + 6 }}
          >
            {text}
          </motion.span>,
          document.body,
        )}
    </>
  );
}

/** One pull request on the board. Everything a row of the list showed, stacked to fit a column. */
function Card({ pull, index, now, fresh, onOpen }: { pull: Pull; index: number; now: number; fresh: boolean; onOpen: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const stage = stageOf(pull);
  const status = statusOf(pull);
  const saved = savedAudit(pull);
  const decision = decisionOf(pull);
  // Greyed while there is nothing for a person to do: the AI is at work, or it is done.
  const quiet = stage === "checking" || stage === "rework" || stage === "done";

  const shell =
    stage === "ready"
      ? "border border-hair bg-panel shadow-[var(--shadow-card)] hover:border-line"
      : stage === "checking"
        ? "cursor-progress border border-hair bg-panel/70"
        : stage === "rework"
          ? "cursor-progress border-[1.5px] border-missed/40 bg-panel/70"
          : stage === "followup"
            ? `border-[1.5px] bg-panel ${decision.border}`
            : `border-[1.5px] bg-panel/60 ${decision.border}`;

  const statusText = saved ? `Your audit: ${saved.done} of ${saved.total} steps done` : status.text;
  const statusLine = (pull.status === "signed" || saved != null) && (
    <span className={`flex items-start gap-1.5 ${pull.status === "signed" ? decision.text : "text-soft"}`}>
      <i className={`mt-[6px] inline-block h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} aria-hidden="true" />
      {decision.next ? <Hint text={decision.next}>{statusText}</Hint> : statusText}
    </span>
  );

  const body = (
    <>
      {fresh && (
        <motion.span
          className={`pointer-events-none absolute -inset-[1.5px] rounded-xl border-2 ${decision.border.replace("/50", "")}`}
          initial={{ opacity: 1, scale: 1 }}
          animate={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 1.6, delay: 1, ease: "easeOut" }}
          aria-hidden="true"
        />
      )}
      <span className="flex items-start gap-3">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[12.5px] font-semibold ${
            pull.status === "signed" ? `${decision.wash} ${decision.text}` : "bg-canvas text-soft group-hover:text-ink"
          }`}
        >
          {stage === "done" ? <CheckIcon size={15} strokeWidth={2.4} /> : `#${pull.number}`}
        </span>
        <span className={`min-w-0 flex-1 ${quiet ? "opacity-60" : ""}`}>
          <span className="line-clamp-2 block text-[14px] font-medium leading-snug">
            {stage === "done" && <span className="mr-1 text-soft">#{pull.number}</span>}
            {pull.title}
          </span>
          <span className="mt-1.5 block space-y-0.5 text-[12.5px] leading-snug">
            {/* The branch: the name engineers know the change by, and can check out. */}
            <span className="flex items-center gap-1 font-mono text-[11.5px] text-soft" title={`Branch ${pull.change_id}`}>
              <BranchIcon size={12} className="shrink-0" />
              <span className="truncate">{pull.change_id}</span>
            </span>
            {statusLine}
            {/* One AI reviewer per line, so a model name never breaks in the middle. */}
            {pull.reviewers.length > 0 && (
              <span className="flex items-start gap-1 text-soft" title="The AI reviewers tested on this pull request">
                <BotIcon size={12} className="mt-[3px] shrink-0" />
                <span className="flex min-w-0 flex-col">
                  {pull.reviewers.map((name) => (
                    <span key={name} className="truncate">
                      {prettyModel(name)}
                    </span>
                  ))}
                </span>
              </span>
            )}
          </span>
          {saved && (
            <span className="mt-2 block h-[3px] overflow-hidden rounded-full bg-black/[0.08]" aria-hidden="true">
              <span className="block h-full rounded-full bg-done" style={{ width: `${Math.round((saved.done / saved.total) * 100)}%` }} />
            </span>
          )}
        </span>
      </span>
    </>
  );

  // Not signed yet: how long it has waited for review, next to what happens next. The exact opening time is on hover.
  const waitedFor = pull.status !== "signed" ? age(pull.opened_at, now) : null;
  const waiting = waitedFor && (
    <span
      className="inline-flex items-center gap-1 text-[12.5px] text-soft"
      title={pull.opened_at ? `Opened ${new Date(pull.opened_at).toLocaleString()}` : undefined}
    >
      <ClockIcon size={12} className="shrink-0" />
      Waiting {waitedFor}
    </span>
  );

  let action: ReactNode = null;
  if (stage === "ready") {
    action = (
      <>
        <GitHubIconLink pull={pull} />
        {waiting}
        <StartButton saved={saved != null} onOpen={onOpen} />
      </>
    );
  } else if (stage === "checking" || stage === "rework") {
    action = (
      <>
        <span className="inline-flex items-center gap-2 text-[12.5px] text-soft">
          <Spinner size={15} />
          Check running
        </span>
        {waiting && <span className="ml-auto">{waiting}</span>}
      </>
    );
  } else if (stage === "followup") {
    action = (
      <span className="ml-auto">
        <GitHubButton pull={pull} />
      </span>
    );
  }

  const card = "group relative block w-full rounded-xl px-3.5 py-3 text-left transition-[box-shadow,border-color,background-color] duration-150";
  // Same columns as the card above: the gap matches the one between the number badge and the title.
  const footer = action && <span className="pointer-events-none relative mt-3 flex items-center gap-3 border-t border-hair pt-2.5 [&>*]:pointer-events-auto">{action}</span>;

  return (
    <motion.li
      layoutId={reduced ? undefined : `pull-${pull.number}`}
      initial={{ opacity: 0, y: reduced ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04, layout: { type: "spring", stiffness: 260, damping: 30 } }}
    >
      {stage === "ready" ? (
        // The whole card opens the audit; the GitHub mark and the start button sit on top of it.
        <div className={`${card} ${shell} cursor-pointer`}>
          <button type="button" onClick={onOpen} tabIndex={-1} aria-hidden="true" className="absolute inset-0 rounded-xl" />
          <span className="pointer-events-none block">{body}</span>
          {footer}
        </div>
      ) : (
        <div className={`${card} ${shell}`}>
          {body}
          {footer}
        </div>
      )}
    </motion.li>
  );
}

/** How many accepted cards show before the rest fold away. */
const ACCEPTED_SHOWN = 5;

function Column({
  title,
  count,
  focus = false,
  empty,
  children,
  more,
}: {
  title: string;
  count: number;
  /** The one column where the person acts. */
  focus?: boolean;
  empty: string;
  children: ReactNode;
  more?: ReactNode;
}) {
  return (
    <section
      className={`flex min-h-0 w-[19rem] shrink-0 snap-start flex-col rounded-2xl p-2.5 lg:w-auto ${
        focus ? "border border-line bg-panel shadow-[var(--shadow-card)]" : "bg-black/[0.03]"
      }`}
    >
      {/* The count sits right after the name, in grey: how many, not which step. */}
      <header className="flex items-baseline gap-2 px-1.5 pb-2.5 pt-1">
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        <span className="text-[13px] tabular-nums text-faint" title={plural(count, "pull request")}>
          {count}
        </span>
      </header>
      <ol className="thin-scroll -mx-1 min-h-0 flex-1 space-y-2.5 overflow-y-auto px-1 pb-1">
        {count > 0 ? (
          children
        ) : (
          <li className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-[12.5px] leading-snug text-faint">{empty}</li>
        )}
        {more}
      </ol>
    </section>
  );
}

/**
 * The landing page: a board with one column per step. The AI checks a pull request, a person
 * audits it, and it ends accepted, under a human's full read, or back with the AI. Cards move
 * between columns as their state changes; only the cards ready for an audit open.
 */
export function Landing({ pulls, justSigned, onOpen }: { pulls: PullList; justSigned: number | null; onOpen: (number: number) => void }) {
  // Show the pull request just signed in the audit column for a moment, then let it move to its column.
  const [holdBack, setHoldBack] = useState(justSigned);
  const [allAccepted, setAllAccepted] = useState(false);
  // "Waiting 3 days" follows the clock: redraw every minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (holdBack == null) return;
    const timer = window.setTimeout(() => setHoldBack(null), 700);
    return () => window.clearTimeout(timer);
  }, [holdBack]);

  const placed = (pull: Pull): Stage => (pull.number === holdBack ? "ready" : stageOf(pull));
  const byNumber = (a: Pull, b: Pull) => a.number - b.number;
  const newestFirst = (a: Pull, b: Pull) => (b.signed?.signed_at ?? "").localeCompare(a.signed?.signed_at ?? "");
  const all = pulls.pull_requests;
  const checking = [
    ...all.filter((pull) => placed(pull) === "checking").sort(byNumber),
    ...all.filter((pull) => placed(pull) === "rework").sort(newestFirst),
  ];
  const ready = all.filter((pull) => placed(pull) === "ready").sort(byNumber);
  const humanReview = all.filter((pull) => placed(pull) === "followup").sort(newestFirst);
  const accepted = all.filter((pull) => placed(pull) === "done").sort(newestFirst);
  const acceptedShown = allAccepted ? accepted : accepted.slice(0, ACCEPTED_SHOWN);
  const hidden = accepted.length - acceptedShown.length;

  let index = 0;
  const cards = (list: Pull[]) =>
    list.map((pull) => <Card key={pull.number} pull={pull} index={index++} now={now} fresh={pull.number === justSigned} onOpen={() => onOpen(pull.number)} />);

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-[96rem] px-4 pb-5 pt-8 sm:px-6">
        <h1 className="px-1 text-[26px] font-semibold leading-tight tracking-[-0.015em]">Pull requests to audit</h1>
      </div>
      <LayoutGroup>
        {/* Four columns side by side on a wide screen; narrower screens scroll the board sideways. */}
        <div className="thin-scroll mx-auto flex min-h-0 w-full max-w-[96rem] flex-1 snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pb-6 sm:scroll-px-6 sm:px-6 lg:grid lg:grid-cols-4 lg:overflow-x-visible">
          <Column title="Pending" count={checking.length} empty="Nothing is pending.">
            {cards(checking)}
          </Column>
          <Column title="Ready for your audit" count={ready.length} focus empty="Nothing is waiting for you.">
            {cards(ready)}
          </Column>
          <Column title="Full review required" count={humanReview.length} empty="Pull requests that need a full human read show up here.">
            {cards(humanReview)}
          </Column>
          <Column
            title="Accepted"
            count={accepted.length}
            empty="Accepted pull requests show up here."
            more={
              hidden > 0 || allAccepted ? (
                <li>
                  <button
                    type="button"
                    onClick={() => setAllAccepted(!allAccepted)}
                    className="w-full rounded-lg py-1.5 text-center text-[12.5px] text-soft hover:bg-black/[0.04] hover:text-ink"
                  >
                    {allAccepted ? "Show fewer" : `Show ${hidden} more`}
                  </button>
                </li>
              ) : null
            }
          >
            {cards(acceptedShown)}
          </Column>
        </div>
      </LayoutGroup>
    </div>
  );
}
