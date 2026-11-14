import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { Avatar } from "./Changes";
import { CheckIcon, ChevronDown } from "./icons";

export type BriefTask = { text: string; done?: boolean; flagged?: boolean; onClick?: () => void };

/** One voice in how the audit got here: the AI reviewer, our examiner, or the person. */
export type BriefNode = {
  who: "ai" | "examiner" | "you";
  meta: string;
  title: ReactNode;
  detail?: ReactNode;
  /** Something long, folded until asked for: the reasoning of the AI reviewer. */
  fold?: { label: string; body: ReactNode };
  tasks?: BriefTask[];
};

/** Filled for a planted mistake the AI reviewer noticed, hollow for one it missed. */
export function Dots({ results }: { results: ("caught" | "missed" | "other")[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-[5px]" aria-hidden="true">
      {results.map((result, index) => (
        <i
          key={index}
          className={`inline-block h-[9px] w-[9px] rounded-full ${
            result === "caught" ? "bg-caught" : result === "missed" ? "border-[1.5px] border-missed" : "border-[1.5px] border-faint"
          }`}
        />
      ))}
    </span>
  );
}

function Fold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex items-center gap-1 text-[13px] text-link hover:underline">
        {open ? "Hide reasoning" : label}
        <ChevronDown size={14} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
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
            <p className="mt-2 border-l-2 border-ai/30 pl-3 text-[13px] leading-relaxed text-soft">{children}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** How the audit of one step got here, as a short timeline of who said what. */
export function Brief({ nodes }: { nodes: BriefNode[] }) {
  return (
    <div className="px-[17px] pb-6 pt-5">
      <p className="text-[13px] text-soft">How we got here</p>
      <ol className="mt-4">
        {nodes.map((node, index) => (
          <motion.li
            key={node.who}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: index * 0.05 }}
            className="relative flex gap-3 pb-6 last:pb-0"
          >
            {index < nodes.length - 1 && <span className="absolute bottom-1.5 left-[11.25px] top-[30px] w-[1.5px] rounded-full bg-line" aria-hidden="true" />}
            <Avatar who={node.who} size={24} />
            <div className="min-w-0 flex-1 pt-[2px]">
              <p className="text-[13px] leading-5 text-soft">{node.meta}</p>
              <div className="mt-1.5 text-[15px] font-medium leading-snug">{node.title}</div>
              {node.detail && <div className="mt-1.5 text-[13px] leading-snug text-soft">{node.detail}</div>}
              {node.fold && <Fold label={node.fold.label}>{node.fold.body}</Fold>}
              {node.tasks && (
                <ul className="mt-3 space-y-2.5">
                  {node.tasks.map((task) => {
                    const body = (
                      <>
                        <span
                          className={`mt-[3px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full ${
                            task.flagged ? "bg-missed text-white" : task.done ? "bg-done text-white" : "border-[1.5px] border-line"
                          }`}
                          aria-hidden="true"
                        >
                          {task.flagged ? <span className="text-[10px] font-bold leading-none">!</span> : task.done ? <CheckIcon size={10} strokeWidth={3} /> : null}
                        </span>
                        <span className={task.done && !task.flagged ? "text-soft" : ""}>{task.text}</span>
                      </>
                    );
                    return (
                      <li key={task.text} className="text-[14px] leading-snug">
                        {task.onClick ? (
                          <button type="button" onClick={task.onClick} className="flex gap-2.5 text-left hover:text-link">
                            {body}
                          </button>
                        ) : (
                          <span className="flex gap-2.5">{body}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
