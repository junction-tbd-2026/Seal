import { stepLabel, type Step, type StepState } from "./progress";

export type View = "step" | "whole";

const VIEWS: [View, string][] = [
  ["step", "Review"],
  ["whole", "Full change"],
];

/**
 * The progress indicator and the view switch, side by side. Every segment of the indicator is
 * a step and opens that step, so the indicator is also how the person moves around the audit.
 */
export function StepNav({
  steps,
  states,
  current,
  view,
  onView,
  onGoTo,
}: {
  steps: Step[];
  states: StepState[];
  current: string;
  /** What the page shows: the step being worked on, or the full change. */
  view: View;
  onView: (view: View) => void;
  onGoTo: (stepId: string) => void;
}) {
  const done = states.filter((state) => state.done).length;
  return (
    <div className="flex items-center gap-5">
      <nav aria-label="Audit steps" className="min-w-0 flex-1">
        <ol className="flex gap-1.5">
          {steps.map((step, index) => {
            const state = states[index];
            const active = step.id === current;
            const label = stepLabel(step);
            const status = state.flagged ? "marked wrong" : state.done ? "done" : "open";
            return (
              <li key={step.id} className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onGoTo(step.id)}
                  aria-current={active ? "step" : undefined}
                  aria-label={`Step ${index + 1}, ${label.eyebrow}, ${status}`}
                  title={[`${label.eyebrow}: ${label.title}`, state.answer].filter(Boolean).join(" — ")}
                  className="group block w-full pt-1 text-left"
                >
                  <span
                    className={`block h-1.5 rounded-full ${state.flagged ? "bg-missed" : state.done ? "bg-caught" : "bg-hair group-hover:bg-faint"} ${
                      active ? "outline outline-2 outline-offset-2 outline-ink" : ""
                    }`}
                  />
                  <span className={`mt-1.5 block truncate text-[11.5px] leading-none ${active ? "font-extrabold text-ink" : "font-medium text-soft group-hover:text-ink"}`}>
                    {state.flagged ? "! " : state.done ? "✓ " : ""}
                    {label.short}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <p className="shrink-0 text-[12px] text-soft" title="The audit is saved in this browser. You can stop and continue later.">
        {done} of {steps.length} steps done
      </p>
      <div className="flex shrink-0 overflow-hidden rounded-md border-2 border-ink text-[12.5px] font-bold" role="group" aria-label="What the page shows">
        {VIEWS.map(([value, text]) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => onView(value)}
            className={`px-3 py-1 ${value === "whole" ? "border-l-2 border-ink" : ""} ${view === value ? "bg-ink text-white" : "bg-panel hover:bg-canvas"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
