import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { DiffView } from "./DiffView";
import { COLUMN, KIND_LABEL, KIND_MEANING, RESULT_LABEL, RESULT_MEANING, prettyModel } from "./lib";
import type { Step } from "./progress";
import type { Exam, Reviewer, Result } from "./types";

const SQUARE: Record<Result, string> = {
  caught: "bg-caught",
  missed: "bg-missed",
  left_alone: "bg-caught-wash",
  false_alarm: "bg-warn",
  failed: "bg-panel bg-[repeating-linear-gradient(45deg,transparent_0_3px,var(--color-hair)_3px_5px)]",
  inconclusive: "bg-panel bg-[repeating-linear-gradient(45deg,transparent_0_3px,var(--color-hair)_3px_5px)]",
};

const RESULT_TEXT: Record<Result, string> = {
  caught: "text-caught",
  missed: "text-missed",
  left_alone: "text-caught",
  false_alarm: "text-ink",
  failed: "text-faint",
  inconclusive: "text-faint",
};

const LEGEND: { style: string; label: string }[] = [
  { style: "bg-caught", label: "caught" },
  { style: "bg-missed", label: "missed" },
  { style: "bg-caught-wash", label: "harmless, left alone" },
  { style: "bg-warn", label: "false alarm" },
];

function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group border-t border-hair py-3 text-[13px] leading-relaxed">
      <summary className="flex cursor-pointer list-none items-center justify-between font-bold">
        {title}
        <span className="text-faint group-open:hidden" aria-hidden="true">
          +
        </span>
        <span className="hidden text-faint group-open:inline" aria-hidden="true">
          −
        </span>
      </summary>
      <div className="mt-2 text-soft">{children}</div>
    </details>
  );
}

/**
 * The first step: the verdict of the AI reviewer, how the AI reviewer did on our test, and
 * what the audit asks of the person. Three facts up front; the rest is folded away.
 */
export function ReviewerTest({ exam, reviewer, steps }: { exam: Exam; reviewer: Reviewer; steps: Step[] }) {
  const reduced = useReducedMotion() ?? false;
  const [revealed, setRevealed] = useState(exam.plants.length);
  const [picked, setPicked] = useState<string | null>(null);

  // Replay: reveal the squares one at a time.
  useEffect(() => {
    if (revealed >= exam.plants.length) return;
    const timer = window.setTimeout(() => setRevealed((count) => count + 1), reduced ? 40 : 260);
    return () => window.clearTimeout(timer);
  }, [revealed, exam.plants.length, reduced]);

  const pickedPlant = picked ? exam.plants.find((plant) => plant.id === picked) ?? null : null;
  const done = revealed >= exam.plants.length;
  const { counts } = reviewer;
  const problems = reviewer.findings.length;
  const objectives = steps.filter((step) => step.kind === "point").length;
  const redLines = reviewer.read_yourself.length;
  const tasks = [
    objectives > 0 &&
      `Audit ${objectives === 1 ? "the review objective" : `each of the ${objectives} review objectives`}: the claim of the AI reviewer, and the code the AI reviewer cites as evidence.`,
    redLines > 0 && `Judge the real code at ${redLines === 1 ? "the 1 line" : `the ${redLines} lines`} where the AI reviewer missed a planted mistake.`,
    problems > 0 && `Judge ${problems === 1 ? "the 1 problem" : `the ${problems} problems`} the AI reviewer reported.`,
    "Sign: accept the pull request, ask for a full human read, or reject the pull request.",
  ].filter((task): task is string => Boolean(task));

  const verdict = reviewer.review_failed
    ? { text: "No usable answer", tone: "bg-warn-wash" }
    : reviewer.verdict === true
      ? { text: "Meets the requirement", tone: "bg-caught-wash" }
      : reviewer.verdict === false
        ? { text: "Does not meet the requirement", tone: "bg-missed-wash" }
        : { text: "Could not tell", tone: "bg-warn-wash" };

  return (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-canvas">
      <div className={`${COLUMN} space-y-4 py-6`}>
        <div className="grid items-stretch gap-4 lg:grid-cols-3">
          <section className={`rounded-lg border-2 border-ink px-5 py-5 ${verdict.tone}`}>
            <h3 className="text-[12px] font-bold text-soft">1 · Verdict of {prettyModel(reviewer.name)}</h3>
            <p className="mt-2 text-[24px] font-extrabold leading-tight tracking-tight">{verdict.text}</p>
            <p className="mt-3 text-[13px] leading-snug text-soft">
              {reviewer.review_failed
                ? "Treat the pull request as unreviewed."
                : problems > 0
                  ? `The AI reviewer reported ${problems === 1 ? "1 problem" : `${problems} problems`} in the real code.`
                  : "The AI reviewer reported no problems. The verdict is an opinion, not proof."}
            </p>
          </section>

          <section className="rounded-lg border-2 border-ink bg-panel px-5 py-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[12px] font-bold text-soft">2 · Our test of the AI reviewer</h3>
              <button
                type="button"
                onClick={() => {
                  setPicked(null);
                  setRevealed(0);
                }}
                className="text-[12px] font-medium text-faint underline underline-offset-2 hover:text-ink"
              >
                Replay
              </button>
            </div>
            <p className="mt-2 text-[24px] font-extrabold leading-tight tracking-tight">
              {counts.defects_total > 0 ? (
                <>
                  Noticed {done ? counts.defects_caught : "…"} of {counts.defects_total} planted mistakes
                </>
              ) : (
                "Could not be tested"
              )}
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5" role="list" aria-label="Planted edits">
              {exam.plants.map((plant, index) => {
                const result = reviewer.results[plant.id];
                const shown = index < revealed;
                return (
                  <motion.button
                    key={plant.id}
                    role="listitem"
                    type="button"
                    onClick={() => setPicked(picked === plant.id ? null : plant.id)}
                    title={`${KIND_LABEL[plant.kind]}: ${shown ? RESULT_LABEL[result] : "…"}. Click to see it.`}
                    aria-label={`${KIND_LABEL[plant.kind]}, ${shown ? RESULT_LABEL[result] : "not revealed"}`}
                    aria-pressed={picked === plant.id}
                    initial={false}
                    animate={shown ? { scale: [0.6, 1.15, 1], opacity: 1 } : { scale: 1, opacity: 0.25 }}
                    transition={{ duration: reduced ? 0 : 0.28 }}
                    className={`h-6 w-6 rounded-[5px] border-2 border-ink ${shown ? SQUARE[result] : "bg-canvas"} ${
                      picked === plant.id ? "shadow-[0_0_0_3px_var(--color-brand)]" : ""
                    }`}
                  />
                );
              })}
            </div>
            <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-faint">
              {LEGEND.map((item) => (
                <span key={item.label}>
                  <i className={`mr-1 inline-block h-2 w-2 rounded-[2px] border border-ink align-[-0.5px] ${item.style}`} />
                  {item.label}
                </span>
              ))}
            </p>
          </section>

          <section className="rounded-lg border-2 border-ink bg-warn-wash px-5 py-5">
            <h3 className="text-[12px] font-bold text-soft">3 · Your audit</h3>
            <ol className="mt-2 list-decimal space-y-2 pl-4 text-[13.5px] font-medium leading-snug">
              {tasks.map((task) => (
                <li key={task}>{task}</li>
              ))}
            </ol>
            <p className="mt-3 text-[12px] text-soft">The audit is saved in this browser. You can stop and continue later.</p>
          </section>
        </div>

        <AnimatePresence initial={false}>
          {pickedPlant && (
            <motion.div
              key={pickedPlant.id}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden"
            >
              <div className="rounded-lg border-2 border-ink bg-panel p-4">
                <p className="text-[12px] font-bold">
                  {KIND_LABEL[pickedPlant.kind]} we planted in a copy ·{" "}
                  <span className={RESULT_TEXT[reviewer.results[pickedPlant.id]]}>{RESULT_LABEL[reviewer.results[pickedPlant.id]]}</span>
                </p>
                <p className="mt-1 text-[13.5px]">{pickedPlant.description}</p>
                <p className="mt-0.5 text-[12.5px] text-soft">{KIND_MEANING[pickedPlant.kind]}</p>
                {pickedPlant.patch[0] && (
                  <div className="mt-3 overflow-hidden rounded border border-hair">
                    <DiffView file={pickedPlant.patch[0]} className="max-h-40" />
                  </div>
                )}
                <p className="mt-3 text-[13px]">
                  {reviewer.said[pickedPlant.id] ? (
                    <>
                      <span className="font-bold">AI reviewer:</span> “{reviewer.said[pickedPlant.id]}”
                    </>
                  ) : (
                    <span className="text-soft">{RESULT_MEANING[reviewer.results[pickedPlant.id]]}</span>
                  )}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="max-w-3xl border-b border-hair">
          <Fold title="How the test of the AI reviewer works">
            <p>
              We planted one mistake in each of several copies of the pull request, and the AI reviewer reviewed every copy without knowing about the test.
              No planted mistake is in the real code. Where the AI reviewer missed a planted mistake, the AI reviewer would also miss a real mistake at the
              same line, so you judge the real code at each of those lines.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>{reviewer.claim}</li>
              <li>
                {counts.harmless_total > 0
                  ? `${counts.false_alarms} of ${counts.harmless_total} harmless edits wrongly reported.`
                  : "False alarms were not measured."}
              </li>
              <li>
                {reviewer.requirement_flip_changed_verdict === true
                  ? "The verdict of the AI reviewer changed when we altered the requirement, so the AI reviewer did check against the requirement."
                  : reviewer.requirement_flip_changed_verdict === false
                    ? "The verdict of the AI reviewer did NOT change when we altered the requirement."
                    : "Whether the AI reviewer reads the requirement was not tested."}
              </li>
              {counts.failed > 0 && (
                <li>
                  {counts.failed} planted {counts.failed === 1 ? "copy" : "copies"} got no answer and {counts.failed === 1 ? "is" : "are"} not scored.
                </li>
              )}
            </ul>
          </Fold>
          <Fold title="What was not checked">
            <ul className="list-disc space-y-1 pl-4">
              {reviewer.refused_to_decide.map((item, index) => (
                <li key={index}>The AI reviewer refused to decide: {item}</li>
              ))}
              {!exam.build_checked && <li>Planted copies were not compiled or run, so some may not be real defects.</li>}
              <li>Design-level mistakes, and anything outside the pull request.</li>
              <li>Planted defects are usually easier to catch than real ones, so the figures lean optimistic.</li>
            </ul>
            <p className="mt-2 text-faint">
              {reviewer.reviews} reviews · {reviewer.tokens_in.toLocaleString()} tokens in, {reviewer.tokens_out.toLocaleString()} out · {Math.round(reviewer.seconds)} s ·
              planted by {prettyModel(exam.planter)}
            </p>
          </Fold>
        </div>
      </div>
    </div>
  );
}
