import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";
import App from "./App";
import { Welcome } from "./Welcome";

/** "welcome" is the deck alone; "loading" is the sign-in waiting, with the board loading behind it. */
type Stage = "welcome" | "loading" | "board";

/** The page always opens on the deck. Only a link to a pull request (?pr=2) goes straight to the board. */
function firstStage(): Stage {
  return new URLSearchParams(window.location.search).has("pr") ? "board" : "welcome";
}

/** The whole page: the pitch deck first, and the board once the visitor has logged in. */
export function Root() {
  const [stage, setStage] = useState<Stage>(firstStage);
  const reduced = useReducedMotion() ?? false;

  const enter = useCallback(() => setStage("board"), []);
  /** From the board back to the deck. */
  const leave = useCallback(() => setStage("welcome"), []);

  return (
    <>
      {stage !== "welcome" && (
        // Out of reach of the keyboard until the deck above it has gone.
        <div className="h-full" inert={stage !== "board"}>
          <App onBack={leave} />
        </div>
      )}
      {/* The deck fades in when the visitor comes back to it, not when the page first opens. */}
      <AnimatePresence initial={false}>
        {stage !== "board" && (
          <motion.div key="welcome" className="fixed inset-0 z-[100]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.45, ease: "easeOut" }}>
            <Welcome onAuth={() => setStage("loading")} onCancel={() => setStage("welcome")} onEnter={enter} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
