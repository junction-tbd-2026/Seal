import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Avatar } from "./Changes";
import { ArrowRight, CheckIcon, ChevronDown } from "./icons";
import { formatWhen, objectiveName } from "./lib";
import { decisionText, stepLabel, type Step, type StepState } from "./progress";
import type { SignOff } from "./types";

const DECISIONS = [
  { value: "accept", label: "Accept the pull request", style: "!border-caught !bg-caught !text-white hover:!bg-[#356b4b]" },
  { value: "full_read", label: "Ask for a full human read", style: "" },
  { value: "reject", label: "Reject the pull request", style: "!border-missed/40 !bg-missed-wash !text-missed" },
];

/** True once the person has checked anything, so there is something to clear. */
function rowsStarted(states: StepState[]): boolean {
  return states.some((state) => state.done || state.answer != null);
}

function StepRow({ step, state, onGoTo }: { step: Step; state: StepState; onGoTo: (stepId: string) => void }) {
  const title = stepLabel(step).title;
  const name = step.kind === "point" ? `${objectiveName(step.point.id)} · ${title}` : title;
  return (
    <li>
      <button type="button" onClick={() => onGoTo(step.id)} className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-canvas">
        <span
          className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full ${
            state.flagged ? "bg-missed text-white" : state.done ? "bg-done text-white" : "border-[1.5px] border-line"
          }`}
          aria-hidden="true"
        >
          {state.flagged ? <span className="text-[11px] font-bold leading-none">!</span> : state.done ? <CheckIcon size={11} strokeWidth={3} /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px]">{name}</span>
        <span className={`shrink-0 text-[13px] ${state.flagged ? "font-medium text-missed" : "text-soft"}`}>
          {state.answer ?? (
            <span className="inline-flex items-center gap-1 text-link group-hover:underline">
              Open the step <ArrowRight size={13} />
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/**
 * The last step. It shows only what stands between the person and a decision:
 * the steps still open, or what they marked wrong. What is already done is folded away.
 * Accept needs every earlier step done and nothing marked wrong. Reject and full read are always open.
 */
export function SignOffStep({
  steps,
  states,
  mine,
  onGoTo,
  onClear,
  onSign,
}: {
  /** Every step before this one, with its state at the same index. */
  steps: Step[];
  states: StepState[];
  /** Earlier sign-offs on this reviewer's results. */
  mine: SignOff[];
  onGoTo: (stepId: string) => void;
  /** Throws away every check of the audit, to start again. */
  onClear: () => void;
  onSign: (name: string, decision: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [showFinished, setShowFinished] = useState<boolean | null>(null);
  const started = rowsStarted(states);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = steps.map((step, index) => ({ step, state: states[index] }));
  const open = rows.filter((row) => !row.state.done);
  const flagged = rows.filter((row) => row.state.flagged);
  const finished = rows.filter((row) => row.state.done && !row.state.flagged);
  const blocked = open.length > 0 || flagged.length > 0;
  const finishedOpen = showFinished ?? !blocked;

  const sign = async (decision: string) => {
    setBusy(true);
    setError(null);
    try {
      await onSign(name, decision);
      setName("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The sign-off could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      {mine.length > 0 && (
        <ul className="rounded-xl border border-caught/25 bg-caught-soft px-5 py-3 text-[14px]">
          {mine.slice(-3).map((entry, index) => (
            <li key={`${entry.signed_at}-${index}`} className="flex items-center gap-2">
              <CheckIcon size={14} className="text-caught" />
              <span className="font-medium">{decisionText(entry.decision)}</span> by {entry.name}, {formatWhen(entry.signed_at)}
            </li>
          ))}
        </ul>
      )}

      {blocked && (
        <section className={`rounded-xl border bg-panel px-4 py-4 ${flagged.length > 0 ? "border-missed/40" : "border-line"}`}>
          <h3 className="px-2 text-[15px] font-medium">
            {flagged.length > 0
              ? `You marked ${flagged.length === 1 ? "1 step" : `${flagged.length} steps`} as wrong. The pull request cannot be accepted.`
              : `${open.length === 1 ? "1 step is" : `${open.length} steps are`} open. Finish every step to unlock “Accept the pull request”.`}
          </h3>
          <ul className="mt-2">
            {(flagged.length > 0 ? flagged : open).map((row) => (
              <StepRow key={row.step.id} {...row} onGoTo={onGoTo} />
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-line bg-panel px-5 py-5 shadow-[var(--shadow-card)]">
        <label htmlFor="signer" className="flex items-center gap-2.5 text-[15px] font-medium">
          <Avatar who="you" size={22} />
          {blocked ? "Decide without accepting" : "Every step is done. Your decision on the pull request:"}
        </label>
        <input
          id="signer"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          placeholder="Your name"
          className="mt-4 h-10 w-full rounded-lg border border-line bg-panel px-3 text-[14.5px] outline-none transition-shadow placeholder:text-faint focus:border-link/60 focus:shadow-[0_0_0_3px_rgb(35_131_226/0.15)]"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {DECISIONS.filter((decision) => decision.value !== "accept" || !blocked).map((decision) => (
            <button
              key={decision.value}
              type="button"
              disabled={busy || !name.trim()}
              onClick={() => sign(decision.value)}
              className={`btn h-10 px-4 text-[14px] ${decision.style} ${decision.value === "accept" ? "flex-1" : ""}`}
            >
              {decision.label}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-[13px] font-medium text-missed">
            {error}
          </p>
        )}
      </section>

      {finished.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowFinished(!finishedOpen)}
            aria-expanded={finishedOpen}
            className="inline-flex items-center gap-1 px-1 text-[13.5px] font-medium text-soft hover:text-ink"
          >
            Steps you finished ({finished.length})
            <ChevronDown size={15} className={`transition-transform duration-200 ${finishedOpen ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence initial={false}>
            {finishedOpen && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden pt-1"
              >
                {finished.map((row) => (
                  <StepRow key={row.step.id} {...row} onGoTo={onGoTo} />
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}

      {started &&
        (confirmClear ? (
          <p className="flex flex-wrap items-center gap-2 px-1 text-[13px]">
            <span className="font-medium">Clear every check of the audit?</span>
            <button
              type="button"
              onClick={() => {
                onClear();
                setConfirmClear(false);
              }}
              className="btn h-7 !border-missed/40 !bg-missed-wash px-2.5 text-[13px] !text-missed"
            >
              Clear the audit
            </button>
            <button type="button" onClick={() => setConfirmClear(false)} className="btn h-7 px-2.5 text-[13px]">
              Keep the audit
            </button>
          </p>
        ) : (
          <button type="button" onClick={() => setConfirmClear(true)} className="px-1 text-[13px] text-soft underline-offset-2 hover:text-ink hover:underline">
            Clear the audit and start over
          </button>
        ))}
    </div>
  );
}
