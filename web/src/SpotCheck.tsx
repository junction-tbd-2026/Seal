import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import { DiffView } from "./DiffView";
import { fileName } from "./lib";
import type { SignResult } from "./types";

type Reveal = Extract<SignResult, { spot_check: true }>;

/** Shown after someone signs a spot-check copy: what was planted, and whether they caught it. */
export function SpotCheckReveal({ result, name, onContinue }: { result: Reveal; name: string; onContinue: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);

  const { plant, spotted, seconds } = result;
  const refused = result.refused ?? result.caught;
  const time = seconds < 90 ? `${Math.round(seconds)} seconds` : `${Math.round(seconds / 60)} minutes`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4" role="dialog" aria-modal="true" aria-labelledby="spot-title">
      <motion.div
        initial={{ scale: 0.9, opacity: 0, rotate: -1.5 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className="w-full max-w-2xl overflow-hidden rounded-xl border-[3px] border-ink bg-panel shadow-[8px_8px_0_var(--color-ink)]"
      >
        <div className={`border-b-[3px] border-ink px-6 py-5 ${spotted ? "bg-caught text-white" : refused ? "bg-warn text-ink" : "bg-missed text-white"}`}>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-90">That was the agreed spot-check drill</p>
          <h2 id="spot-title" className="mt-1 text-[30px] font-extrabold leading-[1.05] tracking-tight">
            {spotted ? "You found the planted bug." : refused ? "You held it back, but did not find the bug." : "You just approved a planted bug."}
          </h2>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="text-[15px] leading-snug">
            {spotted ? (
              <>
                {name}, the code you were shown was a copy with a mistake we planted, and you marked that exact spot as wrong, after {time}.
                That is what a sign-off is supposed to mean.
              </>
            ) : refused ? (
              <>
                {name}, the code you were shown was a copy with a mistake we planted. You did not accept it, after {time}, but you did not
                mark the planted spot as wrong, so it does not count as caught: holding everything back is not the same as finding the problem.
              </>
            ) : (
              <>
                {name}, the code you were shown was a copy with a mistake we planted, at a spot the page marked “check this yourself”. You
                accepted it after {time}.
              </>
            )}
          </p>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-soft">
              What was planted, in {fileName(plant.file)} at line {plant.line_start}
            </p>
            <p className="mt-1 text-[13.5px]">{plant.description}</p>
            {plant.patch[0] && (
              <div className="mt-2 overflow-hidden rounded-md border-2 border-ink">
                <DiffView file={plant.patch[0]} className="max-h-44" />
              </div>
            )}
          </div>

          <p className="rounded-md border-2 border-ink bg-warn-wash px-3 py-2 text-[13px] leading-snug">
            <strong>Nothing was approved.</strong> The real change comes next, and only a sign-off on the real change counts. So far people
            have caught {result.record.caught} of {result.record.checked} spot-checks.
          </p>

          <button ref={button} type="button" onClick={onContinue} className="press rounded-md bg-warn px-4 py-2 text-[14px] font-bold">
            Show me the real change
          </button>
        </div>
      </motion.div>
    </div>
  );
}
