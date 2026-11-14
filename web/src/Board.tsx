import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { DiffView } from "./DiffView";
import { KIND_LABEL, KIND_MEANING, RESULT_LABEL, RESULT_MEANING, fileName, prettyModel } from "./lib";
import type { Exam, Plant, Result, Reviewer } from "./types";

const TILE_STYLE: Record<Result, string> = {
  caught: "bg-caught text-sheet",
  missed: "bg-missed text-sheet",
  left_alone: "border border-caught/50 bg-caught-wash text-caught",
  false_alarm: "bg-warn text-sheet",
  failed: "border border-dashed border-faint text-faint",
  inconclusive: "border border-dashed border-faint text-faint",
};

const KIND_STYLE: Record<string, string> = {
  bug: "border-missed/40 text-missed",
  omission: "border-warn/50 text-warn",
  harmless: "border-rule text-soft",
  historical: "border-accent/40 text-accent",
};

const STEP_MS = 420;

function Tile({ result, shown, reduced }: { result: Result; shown: boolean; reduced: boolean }) {
  return (
    <div className="h-9 w-full [perspective:600px]" title={shown ? RESULT_MEANING[result] : undefined}>
      <AnimatePresence mode="wait" initial={false}>
        {shown ? (
          <motion.div
            key="result"
            initial={reduced ? { opacity: 0 } : { rotateX: -90, opacity: 0 }}
            animate={{ rotateX: 0, opacity: 1 }}
            transition={{ duration: reduced ? 0.15 : 0.34, ease: [0.2, 0.7, 0.2, 1] }}
            className={`flex h-9 items-center justify-center rounded text-[0.8rem] font-semibold tracking-wide ${TILE_STYLE[result]}`}
          >
            {RESULT_LABEL[result]}
          </motion.div>
        ) : (
          <motion.div
            key="pending"
            exit={reduced ? { opacity: 0 } : { rotateX: 90, opacity: 0 }}
            transition={{ duration: reduced ? 0.1 : 0.18 }}
            className="flex h-9 items-center justify-center rounded border border-rule bg-paper text-faint"
            aria-label="Not revealed yet"
          >
            ·  ·  ·
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Detail({ plant, reviewers }: { plant: Plant; reviewers: Reviewer[] }) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="overflow-hidden"
    >
      <div className="grid gap-5 border-t border-rule bg-sheet px-4 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0">
          <p className="text-[0.8rem] uppercase tracking-wider text-faint">What was planted</p>
          <p className="mt-1 text-[0.95rem]">{plant.description}</p>
          <p className="mt-2 text-[0.85rem] text-soft">
            {KIND_MEANING[plant.kind]} Difficulty: {plant.difficulty}.
          </p>
          <div className="mt-4 space-y-3">
            {reviewers.map((reviewer) => (
              <div key={reviewer.name}>
                <p className="text-[0.8rem] uppercase tracking-wider text-faint">{prettyModel(reviewer.name)}</p>
                <p className="mt-0.5 text-[0.9rem]">
                  {reviewer.said[plant.id] ? (
                    <span className="italic">“{reviewer.said[plant.id]}”</span>
                  ) : (
                    <span className="text-soft">{RESULT_MEANING[reviewer.results[plant.id]]}</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[0.8rem] uppercase tracking-wider text-faint">
            The edit, in {fileName(plant.file)} near line {plant.line_start}
          </p>
          {plant.patch[0] ? (
            <DiffView file={plant.patch[0]} maxHeight="16rem" />
          ) : (
            <p className="text-soft">The edit was not saved with this run.</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function Board({ exam }: { exam: Exam }) {
  const reduced = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const [revealed, setRevealed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const total = exam.plants.length;

  useEffect(() => {
    if (inView) setPlaying(true);
  }, [inView]);

  useEffect(() => {
    if (!playing) return;
    if (revealed >= total) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setRevealed((count) => count + 1), reduced ? 60 : STEP_MS);
    return () => window.clearTimeout(timer);
  }, [playing, revealed, total, reduced]);

  const replay = () => {
    setOpen(null);
    setRevealed(0);
    setPlaying(true);
  };

  const done = revealed >= total;
  const columns = { gridTemplateColumns: `minmax(0,1fr) repeat(${exam.reviewers.length}, minmax(7.5rem, 9.5rem))` };

  return (
    <div ref={ref}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-soft">
          {total} edits were planted in copies of this change by {prettyModel(exam.planter)}. Each reviewer saw every
          copy alone, as a normal review, and was never told it was a test.
        </p>
        <button
          type="button"
          onClick={replay}
          className="rounded border border-ink px-3 py-1.5 text-[0.9rem] font-medium transition-colors hover:bg-ink hover:text-sheet"
        >
          {done ? "Replay" : "Restart"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-rule bg-sheet">
        <div className="min-w-[36rem]">
          <div className="grid items-end gap-3 border-b border-rule px-4 py-3" style={columns}>
            <span className="text-[0.8rem] uppercase tracking-wider text-faint">Planted edit</span>
            {exam.reviewers.map((reviewer) => (
              <span key={reviewer.name} className="text-center font-serif text-[1.05rem] leading-tight" title={reviewer.name}>
                {prettyModel(reviewer.name)}
              </span>
            ))}
          </div>

          {exam.plants.map((plant, index) => {
            const shown = index < revealed;
            const isOpen = open === plant.id;
            return (
              <div key={plant.id} className="border-b border-rule last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : plant.id)}
                  aria-expanded={isOpen}
                  className="grid w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-paper/70"
                  style={columns}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.72rem] font-medium uppercase tracking-wide ${KIND_STYLE[plant.kind]}`}
                      title={KIND_MEANING[plant.kind]}
                    >
                      {KIND_LABEL[plant.kind]}
                    </span>
                    <span className="truncate text-[0.93rem]">{plant.description}</span>
                  </span>
                  {exam.reviewers.map((reviewer) => (
                    <Tile key={reviewer.name} result={reviewer.results[plant.id]} shown={shown} reduced={reduced} />
                  ))}
                </button>
                <AnimatePresence initial={false}>{isOpen && <Detail plant={plant} reviewers={exam.reviewers} />}</AnimatePresence>
              </div>
            );
          })}

          <div className="grid items-start gap-3 border-t border-ink/70 bg-paper/60 px-4 py-4" style={columns}>
            <span className="text-[0.9rem] text-soft">
              Planted defects caught
              <span className="block text-[0.8rem] text-faint">Bugs and omissions that were scored</span>
            </span>
            {exam.reviewers.map((reviewer) => (
              <motion.div
                key={reviewer.name}
                className="text-center"
                initial={false}
                animate={{ opacity: done ? 1 : 0.15 }}
                transition={{ duration: 0.4 }}
              >
                <span className="font-serif text-[1.9rem] leading-none">
                  {reviewer.counts.defects_caught}
                  <span className="text-faint"> / {reviewer.counts.defects_total}</span>
                </span>
                <span className="mt-1 block text-[0.78rem] text-soft">
                  {reviewer.counts.false_alarms} of {reviewer.counts.harmless_total} false alarms
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[0.85rem] text-faint">Select a row to see the edit and what each reviewer said about it.</p>
    </div>
  );
}
