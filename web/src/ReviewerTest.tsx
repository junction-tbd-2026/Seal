import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Avatar } from "./Changes";
import { DiffView } from "./DiffView";
import { ChevronDown } from "./icons";
import { KIND_LABEL, KIND_MEANING, RESULT_LABEL, RESULT_MEANING, fileName, plural, prettyModel, shortModel } from "./lib";
import type { Exam, Result, Reviewer } from "./types";

const SQUARE: Record<Result, string> = {
  caught: "bg-caught",
  missed: "bg-panel shadow-[inset_0_0_0_2px_var(--color-missed)]",
  left_alone: "bg-caught-wash shadow-[inset_0_0_0_1px_rgb(63_125_88/0.25)]",
  false_alarm: "bg-warn",
  failed: "bg-panel bg-[repeating-linear-gradient(45deg,transparent_0_3px,rgb(0_0_0/0.12)_3px_5px)] shadow-[inset_0_0_0_1px_var(--color-line)]",
  inconclusive: "bg-panel bg-[repeating-linear-gradient(45deg,transparent_0_3px,rgb(0_0_0/0.12)_3px_5px)] shadow-[inset_0_0_0_1px_var(--color-line)]",
};

const RESULT_TEXT: Record<Result, string> = {
  caught: "text-caught",
  missed: "text-missed",
  left_alone: "text-caught",
  false_alarm: "text-warn",
  failed: "text-faint",
  inconclusive: "text-faint",
};

const LEGEND: { result: Result; label: string }[] = [
  { result: "caught", label: "caught" },
  { result: "missed", label: "missed" },
  { result: "left_alone", label: "harmless, left alone" },
  { result: "false_alarm", label: "false alarm" },
];

function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-hair">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between py-3 text-left text-[14px] font-medium">
        {title}
        <ChevronDown size={16} className={`text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-4 text-[13.5px] leading-relaxed text-soft">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The first step: how the AI reviewer did on our test, every planted edit as one square.
 * The verdict of the AI reviewer and the tasks of the audit sit in the side bar.
 */
export function ReviewerTest({ exam, reviewer }: { exam: Exam; reviewer: Reviewer }) {
  const reduced = useReducedMotion() ?? false;
  const [revealed, setRevealed] = useState(exam.plants.length);
  const [picked, setPicked] = useState<string | null>(null);

  // Replay: reveal the squares one at a time.
  useEffect(() => {
    if (revealed >= exam.plants.length) return;
    const timer = window.setTimeout(() => setRevealed((count) => count + 1), reduced ? 40 : 220);
    return () => window.clearTimeout(timer);
  }, [revealed, exam.plants.length, reduced]);

  const pickedPlant = picked ? exam.plants.find((plant) => plant.id === picked) ?? null : null;
  const done = revealed >= exam.plants.length;
  const { counts } = reviewer;
  const model = shortModel(reviewer.name);

  return (
    <div className="max-w-[60rem] space-y-6">
      <section className="rounded-xl border border-line bg-panel">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hair px-5 py-3">
          <span className="flex items-center gap-2 text-[14px] font-medium">
            <Avatar who="examiner" size={20} />
            Our test of {model}
          </span>
          <span className="text-[13px] text-soft">One square per copy of the change with one planted edit. Click a square to see it.</span>
          <button
            type="button"
            onClick={() => {
              setPicked(null);
              setRevealed(0);
            }}
            className="ml-auto text-[13px] text-link hover:underline"
          >
            Replay
          </button>
        </header>
        <div className="px-5 pb-5 pt-4">
          <p className="text-[22px] font-semibold tracking-[-0.01em]">
            {counts.defects_total > 0 ? (
              <>
                Noticed <span className="tabular-nums">{done ? counts.defects_caught : "…"}</span> of {plural(counts.defects_total, "planted mistake")}
              </>
            ) : (
              "Could not be tested"
            )}
          </p>
          <p className="mt-0.5 text-[13.5px] text-soft">
            {counts.harmless_total > 0
              ? `${counts.false_alarms === 0 ? "No false alarm" : plural(counts.false_alarms, "false alarm")} on ${plural(counts.harmless_total, "harmless edit")}.`
              : "False alarms were not measured."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2" role="list" aria-label="Planted edits">
            {exam.plants.map((plant, index) => {
              const result = reviewer.results[plant.id];
              const shown = index < revealed;
              const active = picked === plant.id;
              return (
                <motion.button
                  key={plant.id}
                  role="listitem"
                  type="button"
                  onClick={() => setPicked(active ? null : plant.id)}
                  title={`${KIND_LABEL[plant.kind]}: ${shown ? RESULT_LABEL[result] : "…"}`}
                  aria-label={`${KIND_LABEL[plant.kind]} in ${fileName(plant.file)}, ${shown ? RESULT_LABEL[result] : "not revealed"}`}
                  aria-pressed={active}
                  initial={false}
                  animate={shown ? { scale: [0.6, 1.12, 1], opacity: 1 } : { scale: 1, opacity: 0.3 }}
                  whileHover={reduced ? undefined : { y: -2 }}
                  transition={{ duration: reduced ? 0 : 0.26 }}
                  className={`h-7 w-7 rounded-md ${shown ? SQUARE[result] : "bg-subtle"} ${active ? "outline outline-2 outline-offset-2 outline-link" : ""}`}
                />
              );
            })}
          </div>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-soft">
            {LEGEND.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1.5">
                <i className={`inline-block h-2.5 w-2.5 rounded-[3px] ${SQUARE[item.result]}`} />
                {item.label}
              </span>
            ))}
          </p>
        </div>

        <AnimatePresence initial={false}>
          {pickedPlant && (
            <motion.div
              key={pickedPlant.id}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
              className="overflow-hidden"
            >
              <div className="border-t border-hair px-5 py-4">
                <p className="text-[13px] text-soft">
                  {KIND_LABEL[pickedPlant.kind]} we planted in a copy, in {fileName(pickedPlant.file)} at line {pickedPlant.line_start} ·{" "}
                  <span className={`font-medium ${RESULT_TEXT[reviewer.results[pickedPlant.id]]}`}>{RESULT_LABEL[reviewer.results[pickedPlant.id]]}</span>
                </p>
                <p className="mt-1 text-[14px] leading-snug">{pickedPlant.description}</p>
                <p className="mt-0.5 text-[13px] text-soft">{KIND_MEANING[pickedPlant.kind]}</p>
                {pickedPlant.patch[0] && (
                  <div className="mt-3 overflow-hidden rounded-lg border border-line">
                    <DiffView file={pickedPlant.patch[0]} className="max-h-44 py-1" />
                  </div>
                )}
                <p className="mt-3 flex items-start gap-2 text-[13.5px] leading-snug">
                  <span className="mt-px">
                    <Avatar who="ai" />
                  </span>
                  {reviewer.said[pickedPlant.id] ? (
                    <span>
                      <span className="font-medium">{model}:</span> “{reviewer.said[pickedPlant.id]}”
                    </span>
                  ) : (
                    <span className="text-soft">{RESULT_MEANING[reviewer.results[pickedPlant.id]]}</span>
                  )}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <div className="border-b border-hair">
        <Fold title="How the test of the AI reviewer works">
          <p>
            We planted one mistake in each of several copies of the pull request, and the AI reviewer reviewed every copy without knowing about the test.
            No planted mistake is in the real code. Where the AI reviewer missed a planted mistake, it would also miss a real mistake at the same line, so
            you judge the real code at each of those lines.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>{reviewer.claim}</li>
            <li>
              {reviewer.requirement_flip_changed_verdict === true
                ? "Its verdict changed when we altered the requirement, so it did check against the requirement."
                : reviewer.requirement_flip_changed_verdict === false
                  ? "Its verdict did NOT change when we altered the requirement."
                  : "Whether it reads the requirement was not tested."}
            </li>
            {counts.failed > 0 && (
              <li>
                {plural(counts.failed, "planted copy", "planted copies")} got no answer and {counts.failed === 1 ? "is" : "are"} not scored.
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
  );
}
