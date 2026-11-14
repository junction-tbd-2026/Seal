import { useState } from "react";
import { COLUMN, formatWhen, objectiveName } from "./lib";
import { decisionText, stepLabel, type Step, type StepState } from "./progress";
import type { SignOff } from "./types";

const DECISIONS = [
  { value: "accept", label: "Accept the pull request", style: "bg-caught text-white" },
  { value: "full_read", label: "Ask for a full human read", style: "bg-warn" },
  { value: "reject", label: "Reject the pull request", style: "bg-missed text-white" },
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
      <button type="button" onClick={() => onGoTo(step.id)} className="group flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left hover:bg-canvas">
        <span
          className={`grid h-5 w-5 shrink-0 translate-y-1 place-items-center rounded-full text-[10.5px] font-extrabold ${
            state.flagged ? "bg-missed text-white" : state.done ? "bg-caught text-white" : "bg-canvas text-soft"
          }`}
          aria-hidden="true"
        >
          {state.flagged ? "!" : state.done ? "✓" : ""}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{name}</span>
        <span className={`shrink-0 text-[12.5px] ${state.flagged ? "font-bold text-missed" : "text-soft"}`}>
          {state.answer ?? <span className="font-bold text-brand group-hover:underline">Open the step →</span>}
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
  const started = rowsStarted(states);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = steps.map((step, index) => ({ step, state: states[index] }));
  const open = rows.filter((row) => !row.state.done);
  const flagged = rows.filter((row) => row.state.flagged);
  const finished = rows.filter((row) => row.state.done && !row.state.flagged);
  const blocked = open.length > 0 || flagged.length > 0;

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
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-canvas">
      <div className={`${COLUMN} py-6`}>
        <div className="max-w-2xl space-y-4">
        {mine.length > 0 && (
          <ul className="rounded-lg border-2 border-ink bg-caught-wash px-5 py-3 text-[13.5px]">
            {mine.slice(-3).map((entry, index) => (
              <li key={`${entry.signed_at}-${index}`}>
                <span className="font-bold">{decisionText(entry.decision)}</span> by {entry.name}, {formatWhen(entry.signed_at)}
              </li>
            ))}
          </ul>
        )}

        {blocked && (
          <section className="rounded-lg border-2 border-ink bg-panel px-5 py-4">
            <h3 className="text-[15px] font-bold">
              {flagged.length > 0
                ? `You marked ${flagged.length === 1 ? "1 step" : `${flagged.length} steps`} as wrong. The pull request cannot be accepted.`
                : `${open.length === 1 ? "1 step is" : `${open.length} steps are`} open. Finish every step to unlock “Accept the pull request”.`}
            </h3>
            <ul className="-mx-2 mt-2">
              {(flagged.length > 0 ? flagged : open).map((row) => (
                <StepRow key={row.step.id} {...row} onGoTo={onGoTo} />
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-lg border-2 border-ink bg-panel px-5 py-5 shadow-[var(--shadow-hard)]">
          <label htmlFor="signer" className="text-[15px] font-bold">
            {blocked ? "Decide without accepting" : "Every step is done. Your decision on the pull request:"}
          </label>
          <input
            id="signer"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            placeholder="Your name"
            className="mt-3 w-full rounded-md border-2 border-ink bg-panel px-3 py-2 text-[14.5px] font-medium placeholder:text-faint"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {DECISIONS.filter((decision) => decision.value !== "accept" || !blocked).map((decision) => (
              <button
                key={decision.value}
                type="button"
                disabled={busy || !name.trim()}
                onClick={() => sign(decision.value)}
                className={`press rounded-md px-4 py-2 text-[14px] font-bold ${decision.style} ${decision.value === "accept" ? "flex-1" : ""}`}
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
          <details className="group text-[13px]" open={!blocked}>
            <summary className="cursor-pointer list-none px-1 font-bold text-soft hover:text-ink">
              Steps you finished ({finished.length}) <span className="group-open:hidden">+</span>
              <span className="hidden group-open:inline">−</span>
            </summary>
            <ul className="mt-1">
              {finished.map((row) => (
                <StepRow key={row.step.id} {...row} onGoTo={onGoTo} />
              ))}
            </ul>
          </details>
        )}

        {started &&
          (confirmClear ? (
            <p className="flex flex-wrap items-center gap-2 px-1 text-[12.5px]">
              <span className="font-bold">Clear every check of the audit?</span>
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setConfirmClear(false);
                }}
                className="rounded bg-missed px-2 py-px font-bold text-white"
              >
                Clear the audit
              </button>
              <button type="button" onClick={() => setConfirmClear(false)} className="rounded border border-hair bg-panel px-2 py-px font-bold">
                Keep the audit
              </button>
            </p>
          ) : (
            <button type="button" onClick={() => setConfirmClear(true)} className="px-1 text-[12.5px] font-medium text-soft underline underline-offset-2 hover:text-ink">
              Clear the audit and start over
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
