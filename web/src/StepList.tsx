import { useState } from "react";
import { prettyModel } from "./lib";
import { stepLabel, type Step, type StepState, type Tone } from "./progress";
import type { Exam, Reviewer } from "./types";

const TONE_CHIP: Record<Tone, string> = {
  verified: "bg-caught text-white",
  unproven: "bg-warn text-ink",
  risk: "bg-missed text-white",
};

/** What is still asked of the person on a step they have not finished. */
function todo(step: Step, ready: boolean): string {
  switch (step.kind) {
    case "intro":
      return "Read this first";
    case "point":
      if (step.spots.length > 0) return `Check ${step.spots.length === 1 ? "the red spot" : `${step.spots.length} red spots`}, then decide`;
      return step.tone === "verified" ? "Read the lines and confirm" : "Needs your decision";
    case "spots":
      return "Give a verdict on each spot";
    case "findings":
      return "Say whether each one is real";
    case "sign":
      return ready ? "Ready for your name" : "Reject or full read any time";
  }
}

/**
 * The review as a task list: every step, where the person stands, and what each still needs.
 * Any step can be opened at any time.
 */
export function StepList({
  exam,
  reviewer,
  steps,
  states,
  current,
  stale,
  compare,
  onCompare,
  onGoTo,
  onReviewer,
  onClear,
}: {
  exam: Exam;
  reviewer: Reviewer;
  steps: Step[];
  states: StepState[];
  current: string;
  /** Older saved checks were dropped because the code or the reviewer's results changed. */
  stale: boolean;
  /** Show every reviewer as a tab, to switch between their results. */
  compare: boolean;
  onCompare: () => void;
  onGoTo: (stepId: string) => void;
  onReviewer: (name: string) => void;
  onClear: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);

  const done = states.filter((state) => state.done).length;
  const started = states.some((state) => state.done || state.answer != null);
  const ready = states.every((state, index) => steps[index].kind === "sign" || (state.done && !state.flagged));

  return (
    <aside className="flex h-full min-h-0 flex-col border-l-2 border-ink bg-panel">
      {!compare || exam.reviewers.length < 2 ? (
        <div className="flex items-center justify-between gap-3 border-b-2 border-ink bg-ink px-4 py-2 text-white">
          <p className="text-[13px] font-bold leading-tight">
            <span className="block text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/60">AI reviewer</span>
            {prettyModel(reviewer.name)}
          </p>
          {exam.reviewers.length > 1 && (
            <button type="button" onClick={onCompare} className="rounded border-2 border-white/50 px-2 py-0.5 text-[11.5px] font-bold hover:border-white">
              Compare reviewers
            </button>
          )}
        </div>
      ) : (
        <div className="flex border-b-2 border-ink" role="tablist" aria-label="Reviewer">
          {exam.reviewers.map((item) => (
            <button
              key={item.name}
              role="tab"
              type="button"
              aria-selected={item.name === reviewer.name}
              onClick={() => onReviewer(item.name)}
              title={item.name}
              className={`flex-1 border-r-2 border-ink px-3 py-2.5 text-left text-[13px] font-bold leading-tight last:border-r-0 ${
                item.name === reviewer.name ? "bg-ink text-white" : "bg-panel hover:bg-canvas"
              }`}
            >
              {prettyModel(item.name)}
              <span className={`block text-[11px] font-medium ${item.name === reviewer.name ? "text-white/70" : "text-faint"}`}>
                noticed {item.counts.defects_caught} of {item.counts.defects_total}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="border-b-2 border-ink bg-canvas px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-soft">Your review</h2>
          <p className="text-[13px] font-bold">
            {done} of {steps.length} steps done
          </p>
        </div>
        <div
          className="mt-2 flex gap-1"
          role="progressbar"
          aria-label="Steps done"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
        >
          {steps.map((step, index) => (
            <span
              key={step.id}
              className={`h-2.5 flex-1 rounded-sm border-2 border-ink ${
                states[index].flagged ? "bg-missed" : states[index].done ? "bg-caught" : "bg-panel"
              }`}
            />
          ))}
        </div>
        {stale && (
          <p role="status" className="mt-2 rounded-md border-2 border-ink bg-warn-wash px-2 py-1 text-[12px] font-medium leading-snug">
            The code or the reviewer's results changed since your last visit, so your earlier checks were cleared.
          </p>
        )}
      </div>

      <nav aria-label="Review steps" className="thin-scroll min-h-0 flex-1 overflow-y-auto p-3">
        <ol className="space-y-2">
          {steps.map((step, index) => {
            const state = states[index];
            const active = step.id === current;
            const label = stepLabel(step);
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => onGoTo(step.id)}
                  aria-current={active ? "step" : undefined}
                  className={`flex w-full items-start gap-2.5 rounded-lg border-2 border-ink px-2.5 py-2 text-left transition-[transform,box-shadow] ${
                    active ? "-translate-x-0.5 -translate-y-0.5 bg-warn-wash shadow-[var(--shadow-hard)]" : "bg-panel hover:bg-canvas"
                  }`}
                >
                  <span
                    className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded border-2 border-ink text-[12px] font-extrabold ${
                      state.flagged ? "bg-missed text-white" : state.done ? "bg-caught text-white" : "bg-panel"
                    }`}
                  >
                    <span aria-hidden="true">{state.done ? (state.flagged ? "!" : "✓") : index + 1}</span>
                    <span className="sr-only">{state.done ? (state.flagged ? "Done, marked wrong" : "Done") : `Step ${index + 1}, not done`}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-soft">{label.eyebrow}</span>
                      {step.kind === "point" && (
                        <span className={`rounded-sm border-2 border-ink px-1 text-[10px] font-bold leading-[1.45] ${TONE_CHIP[step.tone]}`}>{step.chip}</span>
                      )}
                      {(step.kind === "spots" || step.kind === "findings") && (
                        <span className={`rounded-sm border-2 border-ink px-1 text-[10px] font-bold leading-[1.45] ${TONE_CHIP[step.kind === "spots" ? "risk" : "unproven"]}`}>
                          {step.kind === "spots" ? "Reviewer missed our breaks" : "You decide"}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[13px] font-bold leading-snug">{label.title}</span>
                    <span className={`mt-0.5 block text-[12px] leading-snug ${state.flagged ? "font-bold text-missed" : "text-soft"}`}>
                      {state.answer ?? todo(step, ready)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="border-t-2 border-ink bg-canvas px-4 py-2.5 text-[12px] leading-snug text-soft">
        {confirmClear ? (
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-ink">Clear every check on this pull request?</span>
            <button
              type="button"
              onClick={() => {
                onClear();
                setConfirmClear(false);
              }}
              className="rounded border-2 border-ink bg-missed px-2 py-px font-bold text-white"
            >
              Clear
            </button>
            <button type="button" onClick={() => setConfirmClear(false)} className="rounded border-2 border-ink bg-panel px-2 py-px font-bold text-ink">
              Keep
            </button>
          </p>
        ) : (
          <p>
            Your checks are saved in this browser, so you can stop and continue later.
            {started && (
              <>
                {" "}
                <button type="button" onClick={() => setConfirmClear(true)} className="font-bold text-ink underline decoration-2 underline-offset-2">
                  Start over
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </aside>
  );
}
