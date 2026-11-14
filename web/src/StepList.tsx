import { useState } from "react";
import { prettyModel } from "./lib";
import { stepLabel, type Step, type StepState, type Tone } from "./progress";
import type { Exam, Reviewer } from "./types";

const TONE_DOT: Record<Tone, string> = { verified: "bg-caught", unproven: "bg-warn", risk: "bg-missed" };

const TONE_CHIP: Record<Tone, string> = {
  verified: "bg-caught text-white",
  unproven: "bg-warn text-ink",
  risk: "bg-missed text-white",
};

function stepTone(step: Step): Tone | null {
  if (step.kind === "point") return step.tone;
  if (step.kind === "spots") return "risk";
  if (step.kind === "findings") return "unproven";
  return null;
}

function stepChip(step: Step): string | null {
  if (step.kind === "point") return step.chip;
  if (step.kind === "spots") return "Missed our breaks";
  if (step.kind === "findings") return "You decide";
  return null;
}

/**
 * The review as a task list. Every step is one quiet line; only the step being worked on
 * is opened up. Any step can be opened at any time.
 */
export function StepList({
  exam,
  reviewer,
  steps,
  states,
  current,
  stale,
  view,
  onView,
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
  /** What the middle of the page shows: the step being worked on, or the whole change. */
  view: "step" | "whole";
  onView: (view: "step" | "whole") => void;
  onGoTo: (stepId: string) => void;
  onReviewer: (name: string) => void;
  onClear: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);

  const done = states.filter((state) => state.done).length;
  const started = states.some((state) => state.done || state.answer != null);

  return (
    <aside className="flex h-full min-h-0 flex-col border-l-2 border-ink bg-panel">
      <div className="px-5 pb-4 pt-4">
        <div className="mb-5 flex overflow-hidden rounded-md border-2 border-ink text-[12.5px] font-bold" role="group" aria-label="What to show">
          {(
            [
              ["step", "Review"],
              ["whole", "Whole change"],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => onView(value)}
              className={`flex-1 px-2 py-1.5 ${value === "whole" ? "border-l-2 border-ink" : ""} ${view === value ? "bg-ink text-white" : "bg-panel hover:bg-canvas"}`}
            >
              {text}
            </button>
          ))}
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-extrabold">Your review</h2>
          <p className="text-[12.5px] font-medium text-soft">
            {done} of {steps.length} done
          </p>
        </div>
        <div className="mt-2.5 flex gap-1" role="progressbar" aria-label="Steps done" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
          {steps.map((step, index) => (
            <span key={step.id} className={`h-1.5 flex-1 rounded-full ${states[index].flagged ? "bg-missed" : states[index].done ? "bg-caught" : "bg-hair"}`} />
          ))}
        </div>
        {stale && (
          <p role="status" className="mt-3 rounded-md bg-warn-wash px-2.5 py-1.5 text-[12px] font-medium leading-snug">
            The code or the reviewer's results changed since your last visit, so your earlier checks were cleared.
          </p>
        )}
      </div>

      <nav aria-label="Review steps" className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <ol className="space-y-1">
          {steps.map((step, index) => {
            const state = states[index];
            const active = step.id === current;
            const label = stepLabel(step);
            const tone = stepTone(step);
            const chip = stepChip(step);
            const title = step.kind === "point" ? `${step.point.id} · ${label.title}` : label.title;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => onGoTo(step.id)}
                  aria-current={active ? "step" : undefined}
                  title={active ? undefined : [title, state.answer].filter(Boolean).join(" — ")}
                  className={`flex w-full items-start gap-2.5 rounded-lg border-2 px-2.5 text-left ${
                    active ? "border-ink bg-warn-wash py-2.5 shadow-[var(--shadow-hard-sm)]" : "border-transparent py-1.5 hover:bg-canvas"
                  }`}
                >
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11.5px] font-extrabold ${
                      state.flagged ? "bg-missed text-white" : state.done ? "bg-caught text-white" : active ? "bg-ink text-white" : "bg-canvas text-soft"
                    }`}
                  >
                    <span aria-hidden="true">{state.flagged ? "!" : state.done ? "✓" : index + 1}</span>
                    <span className="sr-only">{state.flagged ? "Marked wrong" : state.done ? "Done" : `Step ${index + 1}, not done`}</span>
                  </span>
                  {active ? (
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-3 text-[13.5px] font-bold leading-snug">{title}</span>
                      {chip && tone && <span className={`mt-1.5 inline-block rounded-sm px-1.5 py-px text-[10.5px] font-bold ${TONE_CHIP[tone]}`}>{chip}</span>}
                      {state.answer && <span className={`mt-1 block text-[12px] leading-snug ${state.flagged ? "font-bold text-missed" : "text-soft"}`}>{state.answer}</span>}
                    </span>
                  ) : (
                    <>
                      <span className={`min-w-0 flex-1 truncate pt-0.5 text-[13px] leading-snug ${state.done ? "text-soft" : "font-medium"}`}>{title}</span>
                      {tone && !state.done && <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} aria-hidden="true" />}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="space-y-2 border-t border-hair px-5 py-3 text-[12px] text-soft">
        {exam.reviewers.length > 1 ? (
          <label className="flex items-center justify-between gap-2">
            <span className="shrink-0">AI reviewer</span>
            <select
              value={reviewer.name}
              onChange={(event) => onReviewer(event.target.value)}
              className="min-w-0 rounded border border-hair bg-panel px-1.5 py-0.5 text-[12px] font-bold text-ink"
            >
              {exam.reviewers.map((item) => (
                <option key={item.name} value={item.name}>
                  {prettyModel(item.name)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="flex items-center justify-between gap-2">
            <span>AI reviewer</span>
            <span className="font-bold text-ink">{prettyModel(reviewer.name)}</span>
          </p>
        )}
        {confirmClear ? (
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-ink">Clear every check here?</span>
            <button
              type="button"
              onClick={() => {
                onClear();
                setConfirmClear(false);
              }}
              className="rounded bg-missed px-2 py-px font-bold text-white"
            >
              Clear
            </button>
            <button type="button" onClick={() => setConfirmClear(false)} className="rounded border border-hair px-2 py-px font-bold text-ink">
              Keep
            </button>
          </p>
        ) : (
          <p className="flex items-center justify-between gap-2">
            <span title="You can stop and continue later on this device.">Saved in this browser</span>
            {started && (
              <button type="button" onClick={() => setConfirmClear(true)} className="font-bold text-ink underline underline-offset-2">
                Start over
              </button>
            )}
          </p>
        )}
      </div>
    </aside>
  );
}
