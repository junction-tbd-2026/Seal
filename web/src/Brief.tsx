import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { Avatar } from "./Changes";
import { CheckIcon, ChevronDown } from "./icons";

export type BriefTask = { text: string; done?: boolean; flagged?: boolean; onClick?: () => void };

/** One voice in how the audit got here: the AI reviewer, the referee AI, or the person. */
export type BriefNode = {
  who: "ai" | "examiner" | "you";
  /** Who speaks: "Referee AI", "You". */
  meta?: string;
  /** What they said. Left out where the tasks say it all, as for "You". */
  title?: ReactNode;
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

/** A task as a step on the timeline: its number while open, a tick once done, "!" once marked wrong. */
function TaskMark({ task, number }: { task: BriefTask; number: number }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center" aria-hidden="true">
      <span
        className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold tabular-nums ${
          task.flagged ? "bg-missed text-white" : task.done ? "bg-done text-white" : "border-[1.5px] border-line bg-panel text-soft"
        }`}
      >
        {task.flagged ? "!" : task.done ? <CheckIcon size={11} strokeWidth={3} /> : number}
      </span>
    </span>
  );
}

type Row = { kind: "node"; node: BriefNode } | { kind: "task"; node: BriefNode; task: BriefTask; number: number };

/**
 * How the audit of one step got here, as one timeline: the AI reviewer, the referee AI, you, and
 * then your tasks as numbered steps on the same line.
 */
export function Brief({ nodes }: { nodes: BriefNode[] }) {
  const rows: Row[] = nodes.flatMap((node): Row[] => [
    { kind: "node", node },
    ...(node.tasks ?? []).map((task, index): Row => ({ kind: "task", node, task, number: index + 1 })),
  ]);
  return (
    <div className="px-[17px] pb-6 pt-5">
      <h2 className="text-[15px] font-semibold">Audit brief</h2>
      <p className="mt-0.5 text-[13px] text-soft">How we got here</p>
      <ol className="mt-4">
        {rows.map((row, index) => {
          const last = index === rows.length - 1;
          const nextIsTask = rows[index + 1]?.kind === "task";
          const space = last ? "" : nextIsTask ? (row.kind === "task" ? "pb-2.5" : "pb-3") : "pb-6";
          return (
            <motion.li
              key={row.kind === "node" ? row.node.who : `${row.node.who}-${row.number}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: index * 0.04 }}
              className={`relative flex gap-3 ${space}`}
            >
              {!last && <span className="absolute bottom-1 left-[11.25px] top-[28px] w-[1.5px] rounded-full bg-line" aria-hidden="true" />}
              {row.kind === "node" ? <Avatar who={row.node.who} size={24} /> : <TaskMark task={row.task} number={row.number} />}
              {row.kind === "node" ? (
                <div className="min-w-0 flex-1 pt-[2px]">
                  {row.node.meta && <p className={`text-[13px] leading-5 text-soft ${row.node.title ? "mb-1.5" : ""}`}>{row.node.meta}</p>}
                  {row.node.title && <div className="text-[15px] font-medium leading-snug">{row.node.title}</div>}
                  {row.node.detail && <div className="mt-1.5 text-[13px] leading-snug text-soft">{row.node.detail}</div>}
                  {row.node.fold && <Fold label={row.node.fold.label}>{row.node.fold.body}</Fold>}
                </div>
              ) : (
                <div className={`min-w-0 flex-1 pt-[2px] text-[14px] leading-snug ${row.task.done && !row.task.flagged ? "text-soft" : ""}`}>
                  {row.task.onClick ? (
                    <button type="button" onClick={row.task.onClick} className="text-left hover:text-link">
                      {row.task.text}
                    </button>
                  ) : (
                    row.task.text
                  )}
                </div>
              )}
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
