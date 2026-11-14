import { useEffect, useRef } from "react";
import type { FileDiff } from "./types";

export type Mark = { start: number; end: number };

const ROW_STYLE: Record<string, string> = {
  add: "bg-caught-wash/60",
  del: "bg-missed-wash/40 text-faint line-through decoration-faint/40",
  ctx: "",
};

const SIGN: Record<string, string> = { add: "+", del: "−", ctx: "" };

/** One file of a change, with line numbers. `marks` are line ranges a human has to read. */
export function DiffView({
  file,
  marks = [],
  focus,
  className = "",
}: {
  file: FileDiff;
  marks?: Mark[];
  focus?: number | null;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus == null || !scroller.current) return;
    const row = scroller.current.querySelector<HTMLElement>(`[data-line="${focus}"]`);
    if (!row) return;
    scroller.current.scrollTo({ top: row.offsetTop - scroller.current.clientHeight / 3, behavior: "smooth" });
  }, [focus, file.path]);

  const marked = (n: number | null) => n != null && marks.some((mark) => n >= mark.start && n <= mark.end);
  const firstOfMark = (n: number | null) => n != null && marks.some((mark) => n === mark.start);

  return (
    <div ref={scroller} className={`thin-scroll overflow-auto bg-panel font-mono text-[12.5px] leading-[1.7] ${className}`}>
      <table className="w-full border-collapse">
        <tbody>
          {file.rows.map((row, index) =>
            row.kind === "gap" ? (
              <tr key={index} aria-hidden="true">
                <td colSpan={3} className="border-y border-hair bg-canvas py-0.5 text-center text-faint">
                  ⋯
                </td>
              </tr>
            ) : (
              <tr
                key={index}
                data-line={row.n ?? undefined}
                className={marked(row.n) ? "bg-missed-wash shadow-[inset_5px_0_0_var(--color-missed)]" : ROW_STYLE[row.kind]}
              >
                <td className="w-14 select-none pl-3 pr-2 text-right align-top text-faint">{row.n ?? ""}</td>
                <td className="w-4 select-none align-top font-bold text-faint">{SIGN[row.kind]}</td>
                <td className="whitespace-pre pr-6 align-top">
                  {row.text || " "}
                  {firstOfMark(row.n) && (
                    <span className="ml-3 inline-block -translate-y-px rounded-sm border-2 border-ink bg-missed px-1.5 font-sans text-[10.5px] font-bold uppercase leading-[1.5] tracking-wide text-white">
                      Read this
                    </span>
                  )}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
