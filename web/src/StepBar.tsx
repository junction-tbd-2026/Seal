import { motion, useReducedMotion } from "motion/react";
import { CheckIcon } from "./icons";
import { stepLabel, type Step, type StepState } from "./progress";

/**
 * The steps of the audit as short bars that fill as each step is done. Every bar opens its
 * step, so the bar is also how the person moves around the audit.
 */
export function StepBar({ steps, states, current, onGoTo }: { steps: Step[]; states: StepState[]; current: string; onGoTo: (stepId: string) => void }) {
  const reduced = useReducedMotion() ?? false;
  const done = states.filter((state) => state.done).length;
  return (
    <nav aria-label="Audit steps" title={`${done} of ${steps.length} steps done. The audit is saved in this browser.`}>
      <ol className="flex gap-1.5">
        {steps.map((step, index) => {
          const state = states[index];
          const active = step.id === current;
          const label = stepLabel(step);
          const status = state.flagged ? "marked wrong" : state.done ? "done" : "open";
          return (
            <li key={step.id} className="min-w-0 max-w-[104px] flex-1">
              <button
                type="button"
                onClick={() => onGoTo(step.id)}
                aria-current={active ? "step" : undefined}
                aria-label={`Step ${index + 1}, ${label.eyebrow}, ${status}`}
                title={[`${label.eyebrow}: ${label.title}`, state.answer].filter(Boolean).join(" — ")}
                className="group block w-full text-left"
              >
                <span
                  className={`flex items-center gap-1 truncate text-[14px] leading-5 ${
                    active ? "font-semibold text-ink" : state.done || state.flagged ? "text-soft group-hover:text-ink" : "text-faint group-hover:text-soft"
                  }`}
                >
                  {state.flagged ? (
                    <span className="font-bold text-missed">!</span>
                  ) : state.done ? (
                    <CheckIcon size={14} strokeWidth={2.6} className="shrink-0 text-done" />
                  ) : null}
                  {label.short}
                </span>
                <span
                  className={`relative mt-2 block h-1 overflow-hidden rounded-full ${
                    active && !state.done && !state.flagged ? "shadow-[inset_0_0_0_1px_var(--color-done)]" : "bg-black/[0.14] group-hover:bg-black/20"
                  }`}
                >
                  <motion.span
                    className={`absolute inset-0 origin-left rounded-full ${state.flagged ? "bg-missed" : "bg-done"}`}
                    initial={false}
                    animate={{ scaleX: state.done || state.flagged ? 1 : 0 }}
                    transition={{ duration: reduced ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
