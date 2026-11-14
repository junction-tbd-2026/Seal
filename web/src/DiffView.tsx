import { useEffect, useRef } from "react";
import type { FileDiff } from "./types";

type Mark = { start: number; end: number };

const ROW_STYLE: Record<string, string> = {
  add: "bg-caught-wash/70",
  del: "bg-missed-wash/70 text-soft",
  ctx: "",
};

const SIGN: Record<string, string> = { add: "+", del: "−", ctx: " " };

/** One file of a diff, with line numbers. `marks` outlines line ranges a human should read. */
export function DiffView({
  file,
  marks = [],
  focus,
  maxHeight = "28rem",
}: {
  file: FileDiff;
  marks?: Mark[];
  focus?: number | null;
  maxHeight?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus == null || !scroller.current) return;
    const row = scroller.current.querySelector<HTMLElement>(`[data-line="${focus}"]`);
    if (!row) return;
    scroller.current.scrollTo({ top: row.offsetTop - scroller.current.clientHeight / 3, behavior: "smooth" });
  }, [focus, file.path]);

  const marked = (n: number | null) => n != null && marks.some((mark) => n >= mark.start && n <= mark.end);

  return (
    <div
      ref={scroller}
      className="relative overflow-auto rounded-md border border-rule bg-sheet font-mono text-[12.5px] leading-[1.6]"
      style={{ maxHeight }}
    >
      <table className="w-full border-collapse">
        <tbody>
          {file.rows.map((row, index) =>
            row.kind === "gap" ? (
              <tr key={index} aria-hidden="true">
                <td colSpan={3} className="border-y border-rule bg-paper py-0.5 text-center text-faint">
                  ⋯
                </td>
              </tr>
            ) : (
              <tr
                key={index}
                data-line={row.n ?? undefined}
                className={`${ROW_STYLE[row.kind]} ${marked(row.n) ? "shadow-[inset_3px_0_0_var(--color-missed)]" : ""}`}
              >
                <td className="w-12 select-none px-2 text-right align-top text-faint">{row.n ?? ""}</td>
                <td className="w-4 select-none align-top text-faint">{SIGN[row.kind]}</td>
                <td className="whitespace-pre pr-4 align-top">{row.text || " "}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
