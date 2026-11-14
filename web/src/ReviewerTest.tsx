import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { DiffView } from "./DiffView";
import { KIND_LABEL, KIND_MEANING, RESULT_LABEL, RESULT_MEANING, fileName, prettyModel } from "./lib";
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

function Block({ title, children, tone = "bg-panel" }: { title: string; children: React.ReactNode; tone?: string }) {
  return (
    <section className={`rounded-lg border-2 border-ink px-4 py-4 ${tone}`}>
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-soft">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The first step: what the AI reviewer said about the real code, and how it did when we
 * tested it on copies with planted mistakes. Read before the checks, so the person knows
 * how much the reviewer's answers are worth.
 */
export function ReviewerTest({ exam, reviewer, summary }: { exam: Exam; reviewer: Reviewer; summary: string }) {
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

  const verdict = reviewer.review_failed
    ? { text: "No usable answer", tone: "bg-warn" }
    : reviewer.verdict === true
      ? { text: "Meets the requirement", tone: "bg-caught-wash" }
      : reviewer.verdict === false
        ? { text: "Does not meet the requirement", tone: "bg-missed-wash" }
        : { text: "Could not tell", tone: "bg-warn-wash" };

  return (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-canvas p-4">
      <p className="rounded-lg border-2 border-ink bg-warn-wash px-4 py-2.5 text-[14px] font-medium leading-snug">{summary}</p>

      <div className="mt-3 grid items-start gap-3 min-[1380px]:grid-cols-2">
        <div className="space-y-3">
          <Block title="What the AI reviewer found in the real code" tone={verdict.tone}>
            <p className="text-[19px] font-bold leading-tight">{verdict.text}</p>
            {reviewer.findings.length > 0 ? (
              <ul className="mt-2 space-y-1.5 text-[13px]">
                {reviewer.findings.map((finding, index) => (
                  <li key={index}>
                    <span className="font-mono text-[11.5px] font-bold">
                      {fileName(finding.file)}:{finding.line_start}
                    </span>{" "}
                    {finding.message}
                  </li>
                ))}
              </ul>
            ) : (
              !reviewer.review_failed && (
                <p className="mt-1 text-[13px] text-soft">
                  It reported no problems. That is its opinion, not proof: the test beside this shows how much that opinion is worth.
                </p>
              )
            )}
          </Block>

          <details className="group rounded-lg border-2 border-ink bg-panel px-4 py-3 text-[12.5px]">
            <summary className="cursor-pointer list-none text-[11px] font-bold uppercase tracking-[0.12em] text-soft">
              Not decided, not checked <span className="group-open:hidden">+</span>
              <span className="hidden group-open:inline">−</span>
            </summary>
            {reviewer.refused_to_decide.length > 0 && (
              <>
                <p className="mt-2 font-bold">The reviewer refused to decide</p>
                <ul className="list-disc space-y-1 pl-4">
                  {reviewer.refused_to_decide.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-2 font-bold">Not checked</p>
            <ul className="list-disc space-y-1 pl-4 text-soft">
              {!exam.build_checked && <li>Planted copies were not compiled or run, so some may not be real defects.</li>}
              <li>Design-level mistakes, and anything outside this change.</li>
              <li>Planted defects are usually easier to catch than real ones, so the figures lean optimistic.</li>
            </ul>
            <p className="mt-2 text-faint">
              {reviewer.reviews} reviews · {reviewer.tokens_in.toLocaleString()} tokens in, {reviewer.tokens_out.toLocaleString()} out · {Math.round(reviewer.seconds)} s ·
              planted by {prettyModel(exam.planter)}
            </p>
          </details>
        </div>

        <Block title="Can we believe it? We tested the reviewer">
          <p className="mb-3 text-[12.5px] leading-snug text-soft">
            We hid mistakes of our own in copies of this change and asked the same reviewer to review each copy.{" "}
            <strong className="text-ink">None of these mistakes are in the real code.</strong>
          </p>
          <div className="flex items-end justify-between gap-3">
            <p className="text-[34px] font-extrabold leading-none tracking-tight">
              {done ? reviewer.counts.defects_caught : "–"}
              <span className="text-faint">/{reviewer.counts.defects_total}</span>
            </p>
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                setRevealed(0);
              }}
              className="press rounded-md bg-panel px-2.5 py-1 text-[12px] font-bold"
            >
              Replay
            </button>
          </div>
          <p className="mt-1 text-[13px] font-medium">times it noticed when we broke the code</p>

          <div className="mt-3 flex flex-wrap gap-1.5" role="list" aria-label="Planted edits">
            {exam.plants.map((plant, index) => {
              const result = reviewer.results[plant.id];
              const shown = index < revealed;
              return (
                <motion.button
                  key={plant.id}
                  role="listitem"
                  type="button"
                  onClick={() => setPicked(picked === plant.id ? null : plant.id)}
                  title={`${KIND_LABEL[plant.kind]}: ${shown ? RESULT_LABEL[result] : "…"}`}
                  aria-label={`${KIND_LABEL[plant.kind]}, ${shown ? RESULT_LABEL[result] : "not revealed"}`}
                  aria-pressed={picked === plant.id}
                  initial={false}
                  animate={shown ? { scale: [0.6, 1.15, 1], opacity: 1 } : { scale: 1, opacity: 0.25 }}
                  transition={{ duration: reduced ? 0 : 0.28 }}
                  className={`h-7 w-7 rounded-[5px] border-2 border-ink ${shown ? SQUARE[result] : "bg-canvas"} ${
                    picked === plant.id ? "shadow-[0_0_0_3px_var(--color-brand)]" : ""
                  }`}
                />
              );
            })}
          </div>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-soft">
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-[2px] border border-ink bg-caught align-[-1px]" />caught</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-[2px] border border-ink bg-missed align-[-1px]" />missed</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-[2px] border border-ink bg-caught-wash align-[-1px]" />harmless, left alone</span>
            <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-[2px] border border-ink bg-warn align-[-1px]" />false alarm</span>
          </p>

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
                <div className="mt-3 rounded-md border-2 border-ink bg-canvas p-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.1em]">
                    {KIND_LABEL[pickedPlant.kind]} ·{" "}
                    <span className={RESULT_TEXT[reviewer.results[pickedPlant.id]]}>{RESULT_LABEL[reviewer.results[pickedPlant.id]]}</span>
                  </p>
                  <p className="mt-1 text-[13px]">{pickedPlant.description}</p>
                  <p className="mt-1 text-[12px] text-soft">{KIND_MEANING[pickedPlant.kind]}</p>
                  {pickedPlant.patch[0] && (
                    <div className="mt-2 overflow-hidden rounded border-2 border-ink">
                      <DiffView file={pickedPlant.patch[0]} className="max-h-40" />
                    </div>
                  )}
                  <p className="mt-2 text-[12.5px]">
                    {reviewer.said[pickedPlant.id] ? (
                      <>
                        <span className="font-bold">Reviewer:</span> “{reviewer.said[pickedPlant.id]}”
                      </>
                    ) : (
                      <span className="text-soft">{RESULT_MEANING[reviewer.results[pickedPlant.id]]}</span>
                    )}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <ul className="mt-3 space-y-1 text-[12.5px]">
            <li>{reviewer.claim}</li>
            <li>
              {reviewer.counts.harmless_total > 0
                ? `${reviewer.counts.false_alarms} of ${reviewer.counts.harmless_total} harmless edits wrongly reported.`
                : "False alarms were not measured."}
            </li>
            <li>
              {reviewer.requirement_flip_changed_verdict === true
                ? "Verdict changed when the requirement was altered, so it did check against the requirement."
                : reviewer.requirement_flip_changed_verdict === false
                  ? "Verdict did NOT change when the requirement was altered."
                  : "Requirement check was not tested."}
            </li>
            {reviewer.counts.failed > 0 && (
              <li>
                {reviewer.counts.failed} planted {reviewer.counts.failed === 1 ? "copy" : "copies"} got no answer and {reviewer.counts.failed === 1 ? "is" : "are"} not scored.
              </li>
            )}
          </ul>
        </Block>
      </div>
    </div>
  );
}
