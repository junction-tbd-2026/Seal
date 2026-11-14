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

  const { plant, caught, spotted, seconds } = result;
  const time = seconds < 90 ? `${Math.round(seconds)} seconds` : `${Math.round(seconds / 60)} minutes`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="spot-title">
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-hair bg-panel shadow-[var(--shadow-pop)]"
      >
        <div className={`border-b border-hair px-6 py-5 ${spotted ? "bg-caught-soft text-caught" : caught ? "bg-warn-wash text-warn" : "bg-missed-wash text-missed"}`}>
          <p className="text-[13px] font-medium opacity-80">That was a spot-check</p>
          <h2 id="spot-title" className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.01em]">
            {spotted ? "You found the planted bug." : caught ? "You refused it, but missed where." : "You just approved a planted bug."}
          </h2>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="text-[15px] leading-relaxed">
            {spotted ? (
              <>
                {name}, the code you were shown was a copy with a mistake we planted, and you marked that exact spot as wrong, after {time}.
                That is what a sign-off is supposed to mean.
              </>
            ) : caught ? (
              <>
                {name}, the code you were shown was a copy with a mistake we planted. You did not accept it, after {time}, but you did not
                mark the planted spot as wrong.
              </>
            ) : (
              <>
                {name}, the code you were shown was a copy with a mistake we planted, at a spot the page marked “check this yourself”. You
                accepted it after {time}.
              </>
            )}
          </p>

          <div>
            <p className="text-[13px] text-soft">
              What was planted, in {fileName(plant.file)} at line {plant.line_start}
            </p>
            <p className="mt-1 text-[14px] leading-snug">{plant.description}</p>
            {plant.patch[0] && (
              <div className="mt-2 overflow-hidden rounded-lg border border-line">
                <DiffView file={plant.patch[0]} className="max-h-44 py-1" />
              </div>
            )}
          </div>

          <p className="rounded-lg bg-canvas px-3 py-2.5 text-[13.5px] leading-snug">
            <strong className="font-semibold">Nothing was approved.</strong> The real change comes next, and only a sign-off on the real change counts. So far people
            have caught {result.record.caught} of {result.record.checked} spot-checks.
          </p>

          <button ref={button} type="button" onClick={onContinue} className="btn btn-dark h-10 px-4 text-[14px]">
            Show me the real change
          </button>
        </div>
      </motion.div>
    </div>
  );
}
