import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { DiffView } from "./DiffView";
import { JUDGEMENT, KIND_LABEL, KIND_MEANING, RESULT_LABEL, RESULT_MEANING, prettyModel } from "./lib";
import { verdictOnApproved } from "./progress";
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
 * The first step: what the AI reviewer said about the real code, and how it did when we
 * tested it on copies with planted mistakes. Two facts up front; the rest is folded away.
 */
export function ReviewerTest({
  exam,
  reviewer,
  signer,
  nameDraft,
  onNameDraft,
}: {
  exam: Exam;
  reviewer: Reviewer;
  /** The person reviewing; empty until they type their name. */
  signer: string;
  nameDraft: string;
  onNameDraft: (name: string) => void;
}) {
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
  const judgement = JUDGEMENT[reviewer.judgement ?? "untested"];
  const onApproved = verdictOnApproved(exam, reviewer);
  const others = exam.reviewers.filter((item) => item.name !== reviewer.name);

  const verdict = reviewer.review_failed
    ? { text: "No usable answer", tone: "bg-warn-wash" }
    : reviewer.verdict === true
      ? { text: "Meets the requirement", tone: "bg-caught-wash" }
      : reviewer.verdict === false
        ? { text: "Does not meet the requirement", tone: "bg-missed-wash" }
        : { text: "Could not tell", tone: "bg-warn-wash" };

  return (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-canvas">
      <div className="max-w-3xl space-y-4 px-8 py-6">
        <div className="grid items-stretch gap-4 sm:grid-cols-2">
          <section className={`rounded-lg border-2 border-ink px-5 py-5 ${verdict.tone}`}>
            <h3 className="text-[12px] font-bold text-soft">{prettyModel(reviewer.name)} says</h3>
            <p className="mt-2 text-[24px] font-extrabold leading-tight tracking-tight">{verdict.text}</p>
            <p className="mt-3 text-[13px] leading-snug text-soft">
              {reviewer.review_failed
                ? "Treat the change as unreviewed."
                : problems > 0
                  ? `It reported ${problems === 1 ? "a problem" : `${problems} problems`} in the real code. You judge ${problems === 1 ? "it" : "them"} in a later step.`
                  : "It reported no problems. That is an opinion, not proof."}
            </p>
            {onApproved && (
              <p className="mt-2 border-t border-hair pt-2 text-[13px] font-bold leading-snug">
                On the objectives the owner approved:{" "}
                {onApproved === "meets" ? "every one met, in its view." : onApproved === "not_met" ? "at least one not met." : "it could not decide every one."}
              </p>
            )}
          </section>

          <section className="rounded-lg border-2 border-ink bg-panel px-5 py-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[12px] font-bold text-soft">We tested that opinion</h3>
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
            {counts.defects_total > 0 ? (
              <>
                <p className="mt-2 text-[21px] font-extrabold leading-tight tracking-tight">
                  Noticed {done ? counts.defects_caught : "…"} of {counts.defects_total} breaks
                </p>
                <p className="text-[21px] font-extrabold leading-tight tracking-tight">
                  {counts.harmless_total > 0
                    ? `Alarmed on ${done ? counts.false_alarms : "…"} of ${counts.harmless_total} harmless edits`
                    : "False alarms not measured"}
                </p>
                <p className="mt-2 text-[13px] leading-snug">
                  <span className={`mr-1.5 rounded-sm px-1.5 py-px text-[11.5px] font-bold ${judgement.tone}`}>{judgement.word}</span>
                  <span className="text-soft">On this change it {judgement.meaning}.</span>
                </p>
              </>
            ) : (
              <p className="mt-2 text-[24px] font-extrabold leading-tight tracking-tight">Could not be tested</p>
            )}
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
        </div>

        {others.length > 0 && (
          <p className="rounded-lg border-2 border-ink bg-panel px-4 py-2.5 text-[13px] leading-snug">
            <span className="font-bold">Same planted copies, other reviewer{others.length > 1 ? "s" : ""}: </span>
            {others.map((item, index) => (
              <span key={item.name}>
                {index > 0 && "; "}
                {prettyModel(item.name)} noticed {item.counts.defects_caught} of {item.counts.defects_total} breaks and alarmed on {item.counts.false_alarms} of{" "}
                {item.counts.harmless_total} harmless edits ({JUDGEMENT[item.judgement ?? "untested"].word.toLowerCase()})
              </span>
            ))}
            . A reviewer's record on one change says little about the next one; that is why it is tested on every change.
          </p>
        )}

        {!signer && (
          <section className="rounded-lg border-2 border-ink bg-warn-wash px-5 py-4">
            <label htmlFor="reviewer-name" className="text-[14px] font-bold">
              Your name: you are the engineer who signs this change
            </label>
            <input
              id="reviewer-name"
              value={nameDraft}
              onChange={(event) => onNameDraft(event.target.value)}
              autoComplete="name"
              placeholder="Your name"
              className="mt-2 w-full max-w-sm rounded-md border-2 border-ink bg-panel px-3 py-1.5 text-[14px] placeholder:text-faint"
            />
            <p className="mt-1.5 text-[12px] text-soft">Your checks are saved under your name in this browser, so someone else on this machine starts fresh.</p>
          </section>
        )}

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
                {pickedPlant.hidden ? (
                  <p className="mt-1 text-[13.5px]">
                    What we planted here stays hidden until you sign: it is one of the spots you are asked to judge, and seeing it would make that
                    meaningless.
                  </p>
                ) : (
                  <p className="mt-1 text-[13.5px]">{pickedPlant.description}</p>
                )}
                <p className="mt-0.5 text-[12.5px] text-soft">{KIND_MEANING[pickedPlant.kind]}</p>
                {!pickedPlant.hidden && pickedPlant.patch[0] && (
                  <div className="mt-3 overflow-hidden rounded border border-hair">
                    <DiffView file={pickedPlant.patch[0]} className="max-h-40" />
                  </div>
                )}
                <p className="mt-3 text-[13px]">
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

        <div className="border-b border-hair">
          <Fold title="How the test works">
            <p>
              We hid mistakes of our own in copies of this change and asked the same reviewer to review each copy. None of these mistakes are in the real code.
              Where it missed one, a real mistake in the same place would have slipped past it too, so you check those places yourself.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>{reviewer.claim}</li>
              {exam.changed_lines != null && exam.planted_lines != null && (
                <li>
                  Our planted edits touched {exam.planted_lines} of the {exam.changed_lines} changed lines. The reviewer's silence on the other lines is
                  untested.
                </li>
              )}
              <li>
                {counts.harmless_total > 0
                  ? `${counts.false_alarms} of ${counts.harmless_total} harmless edits wrongly reported.`
                  : "False alarms were not measured."}
              </li>
              <li>
                {reviewer.requirement_flip_changed_verdict === true
                  ? "Its verdict changed when we altered the requirement, so it did check against the requirement."
                  : reviewer.requirement_flip_changed_verdict === false
                    ? "Its verdict did NOT change when we altered the requirement."
                    : "Whether it reads the requirement was not tested."}
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
                <li key={index}>The reviewer refused to decide: {item}</li>
              ))}
              {!exam.build_checked && <li>Planted copies were not compiled or run, so some may not be real defects.</li>}
              <li>Design-level mistakes, and anything outside this change.</li>
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
