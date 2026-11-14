import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsUpDown } from "./icons";
import type { FileDiff, Row } from "./types";

/**
 * A line range with a meaning. "blind": the AI reviewer missed a mistake we planted here.
 * "cited": the AI reviewer cites the lines as proof; "held" when every mistake we planted there was caught.
 * "finding": the AI reviewer reported a problem here.
 */
export type Mark = { start: number; end: number; tone: "blind" | "cited" | "held" | "finding" };

const ROW: Record<Mark["tone"], { row: string; bar: string; number: string }> = {
  blind: { row: "bg-missed-wash", bar: "bg-missed w-[3px]", number: "text-missed" },
  held: { row: "bg-caught-soft", bar: "bg-ai w-[2px]", number: "text-ai" },
  cited: { row: "bg-ai-wash/70", bar: "bg-ai w-[2px]", number: "text-ai" },
  finding: { row: "bg-warn-wash", bar: "bg-warn w-[3px]", number: "text-warn" },
};

const SIGN: Record<string, string> = { add: "+", del: "−", ctx: "" };

/** Unmarked lines farther than this from a mark fold away in long excerpts. */
const CONTEXT = 3;
/** A fold shorter than this is not worth a click. */
const MIN_FOLD = 6;

type Piece = { kind: "rows"; rows: { row: Row; index: number }[] } | { kind: "fold"; id: number; rows: { row: Row; index: number }[] };

/** Splits rows into what is shown and what folds away: rows near a mark stay, long runs far from every mark fold. */
function pieces(rows: Row[], marks: Mark[], fold: boolean): Piece[] {
  const all = rows.map((row, index) => ({ row, index }));
  if (!fold || marks.length === 0) return [{ kind: "rows", rows: all }];
  const near = (n: number | null) => n != null && marks.some((mark) => n >= mark.start - CONTEXT && n <= mark.end + CONTEXT);
  // A removed line has no number: it stays with the line after it.
  const keep = rows.map((row, index) => near(row.n ?? rows.slice(index).find((next) => next.n != null)?.n ?? null));
  const out: Piece[] = [];
  let run: { row: Row; index: number }[] = [];
  let runKept = true;
  const flush = () => {
    if (run.length === 0) return;
    if (!runKept && run.length >= MIN_FOLD) out.push({ kind: "fold", id: run[0].index, rows: run });
    else if (out.length > 0 && out[out.length - 1].kind === "rows") out[out.length - 1].rows.push(...run);
    else out.push({ kind: "rows", rows: run });
    run = [];
  };
  all.forEach((item, index) => {
    if (keep[index] !== runKept) {
      flush();
      runKept = keep[index];
    }
    run.push(item);
  });
  flush();
  return out;
}

/** Lines of a change with line numbers. `marks` colour the lines a person has to read; `fold` hides long runs far from them. */
export function DiffView({
  file,
  marks = [],
  focus,
  fold = false,
  className = "",
}: {
  file: FileDiff;
  marks?: Mark[];
  focus?: number | null;
  fold?: boolean;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    if (focus == null || !scroller.current) return;
    const row = scroller.current.querySelector<HTMLElement>(`[data-line="${focus}"]`);
    if (!row) return;
    scroller.current.scrollTo({ top: row.offsetTop - scroller.current.clientHeight / 3, behavior: "smooth" });
  }, [focus, file.path]);

  // A blind spot outranks a finding, a finding outranks a citation, when they cover the same line.
  const markAt = (n: number | null) => {
    if (n == null) return undefined;
    for (const tone of ["blind", "finding", "cited", "held"] as const) {
      const mark = marks.find((item) => item.tone === tone && n >= item.start && n <= item.end);
      if (mark) return mark;
    }
    return undefined;
  };

  const parts = useMemo(() => pieces(file.rows, marks, fold), [file.rows, marks, fold]);

  const line = ({ row, index }: { row: Row; index: number }) => {
    if (row.kind === "gap") {
      return (
        <tr key={index} aria-hidden="true">
          <td colSpan={3} className="h-7 border-y border-hair bg-canvas/70 text-center text-[11px] text-faint">
            ⋯
          </td>
        </tr>
      );
    }
    const mark = markAt(row.n);
    const tone = mark ? ROW[mark.tone] : null;
    return (
      <tr key={index} data-line={row.n ?? undefined} className={tone ? tone.row : row.kind === "add" ? "bg-[#fafaf9]" : ""}>
        <td className={`relative w-[3.25rem] select-none pl-3 pr-2 text-right align-top ${tone ? tone.number : "text-faint"}`}>
          {tone && <span className={`absolute inset-y-0 left-0 ${tone.bar}`} aria-hidden="true" />}
          {row.n ?? ""}
        </td>
        <td className={`w-5 select-none align-top ${tone ? tone.number : "text-faint"}`}>{SIGN[row.kind]}</td>
        <td className={`whitespace-pre pr-6 align-top ${row.kind === "del" ? "text-faint line-through decoration-faint/60" : "text-ink"}`}>{row.text || " "}</td>
      </tr>
    );
  };

  return (
    <div ref={scroller} className={`thin-scroll overflow-auto font-mono text-[12.5px] leading-6 ${className}`}>
      <table className="w-full min-w-max border-collapse">
        <tbody>
          {parts.map((part) =>
            part.kind === "rows" || opened.has(part.id) ? (
              part.rows.map(line)
            ) : (
              <tr key={`fold-${part.id}`}>
                <td colSpan={3} className="p-0">
                  <button
                    type="button"
                    onClick={() => setOpened((current) => new Set(current).add(part.id))}
                    className="flex h-7 w-full items-center gap-2 border-y border-hair bg-canvas/60 pl-4 font-sans text-[12px] text-soft hover:bg-canvas hover:text-ink"
                  >
                    <ChevronsUpDown size={13} />
                    Show {part.rows.length} more lines
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
