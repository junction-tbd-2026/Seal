import { useState } from "react";
import { formatWhen } from "./lib";
import { decisionText, stepLabel, type Step, type StepState } from "./progress";
import type { SignOff } from "./types";

const DECISIONS = [
  { value: "accept", label: "Accept", style: "bg-caught text-white" },
  { value: "full_read", label: "Full read", style: "bg-warn" },
  { value: "reject", label: "Reject", style: "bg-missed text-white" },
];

/**
 * The last step: what the person checked, and their name on a decision.
 * Accept needs every earlier step done and nothing marked wrong. Reject and full read are always open.
 */
export function SignOffStep({
  steps,
  states,
  mine,
  onGoTo,
  onSign,
}: {
  /** Every step before this one, with its state at the same index. */
  steps: Step[];
  states: StepState[];
  /** Earlier sign-offs on this reviewer's results. */
  mine: SignOff[];
  onGoTo: (stepId: string) => void;
  onSign: (name: string, decision: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = steps.filter((_, index) => !states[index].done);
  const flagged = steps.filter((_, index) => states[index].flagged);
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
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-canvas p-4">
      <div className="mx-auto max-w-2xl space-y-3">
        <section className="rounded-lg border-2 border-ink bg-panel">
          <h3 className="border-b-2 border-ink px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-soft">What you checked</h3>
          <ul>
            {steps.map((step, index) => {
              const state = states[index];
              const label = stepLabel(step);
              return (
                <li key={step.id} className="border-b border-hair last:border-b-0">
                  <button type="button" onClick={() => onGoTo(step.id)} className="flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-canvas">
                    <span
                      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border-2 border-ink text-[11px] font-extrabold ${
                        state.flagged ? "bg-missed text-white" : state.done ? "bg-caught text-white" : "bg-panel"
                      }`}
                      aria-hidden="true"
                    >
                      {state.flagged ? "!" : state.done ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold leading-snug">
                        {step.kind === "point" && <span className="mr-1.5 font-mono text-[11px] text-faint">{step.point.id}</span>}
                        {label.title}
                      </span>
                      <span className={`block text-[12px] ${state.flagged ? "font-bold text-missed" : state.done ? "text-soft" : "font-bold text-ink"}`}>
                        {state.answer ?? "Not checked yet"}
                        {!state.done && state.answer ? " · not finished" : ""}
                      </span>
                    </span>
                    {!state.done && <span className="shrink-0 text-[11.5px] font-bold text-brand underline decoration-2 underline-offset-2">Go to step</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-lg border-2 border-ink bg-brand-wash px-4 py-4 shadow-[var(--shadow-hard)]">
          {mine.length > 0 && (
            <ul className="mb-3 space-y-0.5 border-b-2 border-ink pb-3 text-[12.5px]">
              {mine.slice(-3).map((entry, index) => (
                <li key={`${entry.signed_at}-${index}`}>
                  <span className="font-bold">{decisionText(entry.decision)}</span> by {entry.name}, {formatWhen(entry.signed_at)}
                </li>
              ))}
            </ul>
          )}
          <label htmlFor="signer" className="text-[11px] font-bold uppercase tracking-[0.12em] text-soft">
            I own this decision
          </label>
          <p className="text-[12px] leading-snug text-soft">The code shown may be a spot-check copy with a planted mistake.</p>
          <input
            id="signer"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            placeholder="Your name"
            className="mt-1.5 w-full rounded-md border-2 border-ink bg-panel px-2.5 py-1.5 text-[14px] font-medium placeholder:text-faint"
          />
          <div className="mt-2 grid grid-cols-3 gap-2">
            {DECISIONS.map((decision) => (
              <button
                key={decision.value}
                type="button"
                disabled={busy || !name.trim() || (decision.value === "accept" && blocked)}
                title={decision.value === "accept" && blocked ? "Finish every step first, with nothing marked wrong" : undefined}
                onClick={() => sign(decision.value)}
                className={`press rounded-md px-2 py-2 text-[14px] font-bold ${decision.style}`}
              >
                {decision.label}
              </button>
            ))}
          </div>
          {flagged.length > 0 ? (
            <p className="mt-2 text-[12.5px] font-medium leading-snug">
              You marked something as wrong in {flagged.length === 1 ? "one step" : `${flagged.length} steps`}, so this cannot be accepted. Reject it or ask for
              a full read.
            </p>
          ) : open.length > 0 ? (
            <p className="mt-2 text-[12.5px] font-medium leading-snug">
              Accept unlocks once {open.length === 1 ? "the remaining step is" : `the ${open.length} remaining steps are`} done.{" "}
              <button type="button" onClick={() => onGoTo(open[0].id)} className="font-bold text-brand underline decoration-2 underline-offset-2">
                Go to the next open step
              </button>
              . You can reject or ask for a full read at any time.
            </p>
          ) : (
            <p className="mt-2 text-[12.5px] font-medium leading-snug">Every step is done and nothing is marked wrong. You can accept.</p>
          )}
          {error && (
            <p role="alert" className="mt-2 text-[12.5px] font-medium text-missed">
              {error}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
