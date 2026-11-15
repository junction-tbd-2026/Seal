import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DiffView, type Mark } from "./DiffView";
import { BotIcon, CheckIcon, ChevronDown, ChevronsUpDown, FileIcon, FilesIcon, FlaskIcon, PanelIcon, UserIcon, XIcon } from "./icons";
import { fileName, lineRange, plural, sameFile, symbolOf } from "./lib";
import { excerptRows, findFile, type FindingAnswer } from "./progress";
import type { FileDiff, Finding, Plant, Row, SpotVerdict } from "./types";

/** A range the AI reviewer cites as proof, and how it did when we planted mistakes inside it. */
export type Cite = { file: string; start: number; end: number; outcome: "held" | "missed" | "untested"; planted: number; caught: number };

/** What one step asks the person to read in the change. */
export type Lens = {
  /** The objective the cited lines are proof of, e.g. "O2". */
  objective: string | null;
  /** The AI reviewer, short: "Nemotron". */
  model: string;
  cites: Cite[];
  /** Lines to judge, one planted edit standing for each. */
  blind: Plant[];
  /** Every planted edit the AI reviewer missed at the lines of a blind spot. */
  missedAt: (plant: Plant) => Plant[];
  findings: { index: number; finding: Finding }[];
  /** Said of a changed run with nothing to read in this step: "not cited for O2". */
  quiet: string;
  /** Nothing is cited, so the person reads the whole change: no run folds away. */
  readAll: boolean;
};

type Hunk = { file: FileDiff; rows: Row[]; start: number; end: number };

export type Block = {
  id: string;
  hunk: Hunk;
  cites: Cite[];
  blind: Plant[];
  findings: { index: number; finding: Finding }[];
};

type FileLayout = { file: FileDiff; blocks: Block[]; blind: number; cited: number; findings: number };

export type Layout = { files: FileLayout[]; marked: boolean };

/** "Lines 236–242", "Line 239", or "Removed lines" for a run with nothing left in the new file. */
const hunkLabel = (hunk: Pick<Hunk, "start" | "end">) => (!hunk.start ? "Removed lines" : hunk.end > hunk.start ? `Lines ${lineRange(hunk.start, hunk.end)}` : `Line ${hunk.start}`);

const touches = (start: number, end: number, hunk: Pick<Hunk, "start" | "end">) => start <= hunk.end && end >= hunk.start;

/** A file's changed runs, split where the diff skips unchanged lines. */
function hunksOf(file: FileDiff): Hunk[] {
  const out: Hunk[] = [];
  let rows: Row[] = [];
  const push = () => {
    const numbers = rows.map((row) => row.n).filter((n): n is number => n != null);
    if (rows.length > 0) out.push({ file, rows, start: numbers.length ? Math.min(...numbers) : 0, end: numbers.length ? Math.max(...numbers) : 0 });
    rows = [];
  };
  for (const row of file.rows) {
    if (row.kind === "gap") push();
    else rows.push(row);
  }
  push();
  return out;
}

/** Every changed run of every file, with what the step asks the person to read in it. Files with something to read come first. */
export function layoutChanges(files: FileDiff[], lens: Lens): Layout {
  const marked = !lens.readAll && (lens.cites.length > 0 || lens.blind.length > 0 || lens.findings.length > 0);
  // What one range of one file holds to read.
  const inRange = (path: string, hunk: Pick<Hunk, "start" | "end">) => ({
    cites: lens.cites.filter((cite) => sameFile(cite.file, path) && touches(cite.start, cite.end, hunk)),
    blind: lens.blind.filter((plant) => sameFile(plant.file, path) && touches(plant.line_start, plant.line_end, hunk)),
    findings: lens.findings.filter(({ finding }) => sameFile(finding.file, path) && touches(finding.line_start, finding.line_end, hunk)),
  });

  const layFile = (file: FileDiff, order: number) => {
    const hunks = hunksOf(file);
    const blocks: Block[] = hunks.map((hunk, index) => ({ id: `block-${order}-${index}`, hunk, ...inRange(file.path, hunk) }));
    // Anything to read that falls outside the changed runs still gets a block of its own, so its question
    // can be answered. A spot-check copy can leave out a changed line altogether: then the block has no
    // code to show. Overlapping targets share one block.
    const placed = (start: number, end: number) => hunks.some((hunk) => touches(start, end, hunk));
    const strays = [
      ...lens.blind.filter((plant) => sameFile(plant.file, file.path)).map((plant) => ({ start: plant.line_start, end: plant.line_end })),
      ...lens.findings.filter(({ finding }) => sameFile(finding.file, file.path)).map(({ finding }) => ({ start: finding.line_start, end: finding.line_end })),
      ...lens.cites.filter((cite) => sameFile(cite.file, file.path)).map((cite) => ({ start: cite.start, end: cite.end })),
    ].filter((stray) => !placed(stray.start, stray.end));
    const extra: Hunk[] = [];
    strays.forEach((stray, index) => {
      if (extra.some((hunk) => touches(stray.start, stray.end, hunk))) return;
      const rows = excerptRows(file, stray.start, stray.end);
      const numbers = rows.map((row) => row.n).filter((n): n is number => n != null);
      const hunk: Hunk = {
        file,
        rows,
        start: numbers.length ? Math.min(stray.start, ...numbers) : stray.start,
        end: numbers.length ? Math.max(stray.end, ...numbers) : stray.end,
      };
      extra.push(hunk);
      blocks.push({ id: `block-${order}-x${index}`, hunk, ...inRange(file.path, hunk) });
    });
    blocks.sort((a, b) => a.hunk.start - b.hunk.start);
    return {
      file,
      blocks,
      order,
      blind: blocks.reduce((sum, block) => sum + block.blind.length, 0),
      cited: blocks.filter((block) => block.cites.length > 0).length,
      findings: blocks.reduce((sum, block) => sum + block.findings.length, 0),
    };
  };

  const laid = files.map(layFile);
  // A target in a file that is not in the change at all still needs a place.
  const known = (path: string) => files.some((file) => sameFile(file.path, path));
  const missing = [...lens.blind.map((plant) => plant.file), ...lens.findings.map(({ finding }) => finding.file), ...lens.cites.map((cite) => cite.file)].filter(
    (path, index, all) => !known(path) && all.indexOf(path) === index,
  );
  missing.forEach((path, index) => laid.push(layFile({ path, status: "unchanged", added: 0, removed: 0, rows: [] }, files.length + index)));

  laid.sort((a, b) => b.blind - a.blind || b.findings - a.findings || b.cited - a.cited || a.order - b.order);
  return { files: laid, marked };
}

const relevant = (block: Block) => block.cites.length > 0 || block.blind.length > 0 || block.findings.length > 0;
const fileRelevant = (layout: FileLayout) => layout.blocks.some(relevant);

export function blockMarks(block: Pick<Block, "cites" | "blind" | "findings">): Mark[] {
  return [
    ...block.blind.map((plant) => ({ start: plant.line_start, end: plant.line_end, tone: "blind" as const })),
    ...block.findings.map(({ finding }) => ({ start: finding.line_start, end: finding.line_end, tone: "finding" as const })),
    ...block.cites.map((cite) => ({ start: cite.start, end: cite.end, tone: cite.outcome === "held" ? ("held" as const) : ("cited" as const) })),
  ];
}

function Pill({ tone, onTint, children, title }: { tone: "ai" | "missed" | "caught" | "warn" | "plain"; onTint?: boolean; children: ReactNode; title?: string }) {
  const colour = {
    ai: `text-ai ${onTint ? "bg-panel" : "bg-ai-wash"}`,
    missed: `text-missed ${onTint ? "bg-panel" : "bg-missed-wash"}`,
    caught: `text-caught ${onTint ? "bg-panel" : "bg-caught-wash"}`,
    warn: `text-warn ${onTint ? "bg-panel" : "bg-warn-wash"}`,
    plain: `text-soft ${onTint ? "bg-panel" : "bg-canvas"}`,
  }[tone];
  return (
    <span title={title} className={`inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12.5px] font-medium ${colour}`}>
      {children}
    </span>
  );
}

const Dot = ({ className }: { className: string }) => <i className={`inline-block h-1.5 w-1.5 rounded-full ${className}`} aria-hidden="true" />;

/** The AI reviewer, the referee AI and the person, as small round faces. */
export function Avatar({ who, size = 18 }: { who: "ai" | "examiner" | "you"; size?: number }) {
  const style = { ai: "bg-ai", examiner: "bg-soft", you: "bg-ink" }[who];
  const Glyph = { ai: BotIcon, examiner: FlaskIcon, you: UserIcon }[who];
  return (
    <span className={`grid shrink-0 place-items-center rounded-full text-white ${style}`} style={{ width: size, height: size }} aria-hidden="true">
      <Glyph size={Math.round(size * 0.58)} strokeWidth={2.2} />
    </span>
  );
}

function AiPill({ objective, onTint }: { objective: string | null; onTint?: boolean }) {
  return (
    <Pill tone="ai" onTint={onTint}>
      <span className="-ml-1">
        <Avatar who="ai" size={16} />
      </span>
      {objective ? `Cited as proof for ${objective}` : "Cited as proof"}
    </Pill>
  );
}

function citeTitle(cite: Cite, model: string): string {
  if (cite.outcome === "untested") return "No mistake was planted in these lines.";
  if (cite.outcome === "held") return `We planted ${plural(cite.planted, "mistake")} here and ${model} caught ${cite.planted === 1 ? "it" : "every one"}.`;
  return `We planted ${plural(cite.planted, "mistake")} here and ${model} caught ${cite.caught}.`;
}

/** Two answers to one question. Pressing the chosen answer again takes it back. */
function Answer<T extends string>({
  value,
  options,
  onPick,
}: {
  value: T | undefined;
  options: { value: T; label: string; good: boolean }[];
  onPick: (value: T) => void;
}) {
  return (
    <span className="inline-flex shrink-0 gap-2">
      {options.map((option) => {
        const chosen = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={chosen}
            onClick={() => onPick(option.value)}
            className={`btn h-8 px-3 text-[13.5px] ${
              chosen ? (option.good ? "!border-caught/40 !bg-caught-wash !text-caught" : "!border-missed/40 !bg-missed-wash !text-missed") : ""
            }`}
          >
            {option.good ? <CheckIcon size={14} /> : <XIcon size={14} />}
            {option.label}
          </button>
        );
      })}
    </span>
  );
}

function Question({ id, flash, children, answer }: { id: string; flash: boolean; children: ReactNode; answer: ReactNode }) {
  return (
    <div
      id={id}
      className={`flex scroll-mt-24 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-panel px-4 py-2.5 transition-shadow duration-500 ${
        flash ? "border-link/40 shadow-[0_0_0_4px_rgb(35_131_226/0.15)]" : "border-hair"
      }`}
    >
      <Avatar who="you" size={22} />
      <p className="min-w-[14rem] flex-1 text-[14.5px] font-medium leading-snug">{children}</p>
      {answer}
    </div>
  );
}

const lines = (start: number, end: number) => (end > start ? `lines ${lineRange(start, end)}` : `line ${start}`);

function missedWord(count: number): string {
  return count === 1 ? "it" : count === 2 ? "both" : `all ${count}`;
}

function plantedVerb(plants: Plant[]): string {
  const kinds = new Set(plants.map((plant) => plant.kind));
  if (kinds.size === 1 && kinds.has("omission")) return "removed code";
  if (kinds.size === 1 && (kinds.has("bug") || kinds.has("historical"))) return "planted a bug";
  return "planted a mistake";
}

/** A changed run that holds something to read: the code, then what the AI reviewer and the referee AI say, then the question. */
function BlockCard({
  block,
  onOpenFile,
  lens,
  spots,
  findingAnswers,
  onSpot,
  onFinding,
  flash,
}: {
  block: Block;
  onOpenFile: (path: string, line: number | null) => void;
  lens: Lens;
  spots: Record<string, SpotVerdict>;
  findingAnswers: Record<string, FindingAnswer>;
  onSpot: (plantId: string, verdict: SpotVerdict) => void;
  onFinding: (index: string, answer: FindingAnswer) => void;
  flash: string | null;
}) {
  const [why, setWhy] = useState(false);
  const { hunk } = block;
  const symbol = symbolOf(hunk.rows.map((row) => row.text));
  const open = block.blind.some((plant) => !spots[plant.id]);
  const wrong = block.blind.some((plant) => spots[plant.id] === "wrong");
  const findingOpen = block.findings.some(({ index }) => !findingAnswers[String(index)]);
  const tint = open || wrong ? "missed" : findingOpen ? "warn" : null;
  const outcome = block.cites.some((cite) => cite.outcome === "missed")
    ? "missed"
    : block.cites.some((cite) => cite.outcome === "held")
      ? "held"
      : block.cites.length > 0
        ? "untested"
        : null;
  const missed = block.blind.flatMap((plant) => lens.missedAt(plant));
  const cited = block.cites[0];
  const highlighted = flash === block.id;
  const marks = useMemo(() => blockMarks(block), [block]);

  return (
    <article
      id={block.id}
      className={`scroll-mt-24 overflow-hidden rounded-xl bg-panel transition-shadow duration-500 ${
        tint === "missed" ? "border-[1.5px] border-missed" : tint === "warn" ? "border-[1.5px] border-warn/70" : "border border-line"
      } ${highlighted ? "shadow-[0_0_0_4px_rgb(35_131_226/0.15)]" : ""}`}
    >
      <header
        className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-hair px-4 py-2.5 ${
          tint === "missed" ? "bg-missed-wash" : tint === "warn" ? "bg-warn-wash" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => onOpenFile(hunk.file.path, hunk.start || null)}
          title={`Show these lines in the full ${fileName(hunk.file.path)}`}
          className="text-[14px] font-medium underline-offset-2 hover:text-link hover:underline"
        >
          {hunkLabel(hunk)}
        </button>
        {symbol && <span className="min-w-0 truncate font-mono text-[12.5px] text-faint">{symbol}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {block.blind.length > 0 &&
            (open ? (
              <Pill tone="missed" onTint={tint != null}>
                <Dot className="bg-missed" /> {block.blind.length === 1 ? "Blind spot" : `${block.blind.length} blind spots`}
              </Pill>
            ) : wrong ? (
              <Pill tone="missed" onTint>
                <XIcon size={12} strokeWidth={2.6} /> You: looks wrong
              </Pill>
            ) : (
              <Pill tone="caught">
                <CheckIcon size={12} strokeWidth={2.6} /> You: looks right
              </Pill>
            ))}
          {block.findings.length > 0 && (
            <Pill tone="warn" onTint={tint != null}>
              <Dot className="bg-warn" /> {block.findings.length === 1 ? "Reported problem" : `${block.findings.length} reported problems`}
            </Pill>
          )}
          {outcome === "held" && cited && (
            <Pill tone="caught" title={citeTitle(block.cites.find((cite) => cite.outcome === "held") ?? cited, lens.model)}>
              <Dot className="bg-caught" /> Held up in our test
            </Pill>
          )}
          {outcome === "untested" && block.blind.length === 0 && (
            <Pill tone="plain" title={citeTitle(cited, lens.model)}>
              Not tested
            </Pill>
          )}
          {cited && <AiPill objective={lens.objective} onTint={tint != null} />}
        </span>
      </header>

      {hunk.rows.length > 0 ? (
        <DiffView file={{ ...hunk.file, rows: hunk.rows }} marks={marks} fold className="py-1.5" />
      ) : (
        <p className="px-4 py-3 text-[13px] leading-snug text-soft">
          {hunk.end > hunk.start ? `Lines ${lineRange(hunk.start, hunk.end)} are` : `Line ${hunk.start} is`} not part of the change shown here, so there is no
          code to show. Judge it in the file itself.
        </p>
      )}

      {block.blind.length > 0 && (
        <div className="space-y-3 border-t border-hair px-4 pb-4 pt-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[13.5px] text-soft">
            {cited && (
              <span className="inline-flex items-center gap-2">
                <Avatar who="ai" />
                {lens.model} says {lines(cited.start, cited.end)} {cited.end > cited.start ? "prove" : "proves"} {lens.objective ?? "its claim"}.
              </span>
            )}
            <span className="inline-flex items-center gap-2">
              <Avatar who="examiner" />
              The referee AI {plantedVerb(missed)} here in {plural(missed.length, "test copy", "test copies")}. {lens.model} missed {missedWord(missed.length)}.
            </span>
            <button
              type="button"
              onClick={() => setWhy(!why)}
              aria-expanded={why}
              className="inline-flex items-center gap-1 text-link hover:underline"
            >
              What we changed
              <ChevronDown size={14} className={`transition-transform ${why ? "rotate-180" : ""}`} />
            </button>
          </div>
          <AnimatePresence initial={false}>
            {why && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden"
              >
                {missed.map((plant) => (
                  <li key={plant.id} className="mb-1.5 border-l-2 border-line pl-3 text-[13px] leading-snug text-soft">
                    <span className="font-medium text-ink">In a test copy:</span> {plant.description}
                  </li>
                ))}
                <li className="pl-3 text-[12.5px] text-faint">None of these edits is in the real code. You judge the real code.</li>
              </motion.ul>
            )}
          </AnimatePresence>
          {block.blind.map((plant) => (
            <Question
              key={plant.id}
              id={`spot-${plant.id}`}
              flash={flash === `spot-${plant.id}`}
              answer={
                <Answer
                  value={spots[plant.id]}
                  options={[
                    { value: "right", label: "Looks right", good: true },
                    { value: "wrong", label: "Looks wrong", good: false },
                  ]}
                  onPick={(verdict) => onSpot(plant.id, verdict)}
                />
              }
            >
              Is the real code at {lines(plant.line_start, plant.line_end)} correct?
            </Question>
          ))}
        </div>
      )}

      {block.findings.length > 0 && (
        <div className="space-y-3 border-t border-hair px-4 pb-4 pt-3">
          {block.findings.map(({ index, finding }) => (
            <div key={index} className="space-y-2.5">
              <p className="flex items-start gap-2 text-[13.5px] leading-snug text-soft">
                <span className="mt-px">
                  <Avatar who="ai" />
                </span>
                <span>
                  {lens.model} reports at {lines(finding.line_start, finding.line_end)}: <span className="font-medium text-ink">{finding.message}</span>
                </span>
              </p>
              <Question
                id={`finding-${index}`}
                flash={flash === `finding-${index}`}
                answer={
                  <Answer
                    value={findingAnswers[String(index)]}
                    options={[
                      { value: "not_real", label: "Not real", good: true },
                      { value: "real", label: "Real problem", good: false },
                    ]}
                    onPick={(answer) => onFinding(String(index), answer)}
                  />
                }
              >
                Is this problem real in the real code?
              </Question>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/** A changed run with nothing to read in this step, folded to one dashed line. */
function QuietBlock({ block, quiet, startOpen }: { block: Block; quiet: string; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const { hunk } = block;
  const symbol = symbolOf(hunk.rows.map((row) => row.text));
  return (
    <div id={block.id} className={`overflow-hidden rounded-xl ${open ? "border border-line bg-panel" : "border border-dashed border-line"}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`group flex min-h-10 w-full items-center gap-2.5 px-4 py-2 text-left text-[13.5px] ${open ? "border-b border-hair" : ""}`}
      >
        {open ? (
          <span className="font-medium">{hunkLabel(hunk)}</span>
        ) : (
          <>
            <ChevronsUpDown size={15} className="shrink-0 text-faint" />
            <span className="text-soft">
              {hunkLabel(hunk)} changed{quiet ? `, ${quiet}` : ""}
            </span>
          </>
        )}
        {open && symbol && <span className="min-w-0 truncate font-mono text-[12.5px] text-faint">{symbol}</span>}
        <span className="ml-auto shrink-0 text-link group-hover:underline">{open ? "Hide" : "Show"}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <DiffView file={{ ...hunk.file, rows: hunk.rows }} className="py-1.5" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FileHeader({ layout, onOpen }: { layout: FileLayout; onOpen: () => void }) {
  const { file } = layout;
  const folder = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-hair bg-panel text-soft">
        <FileIcon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold leading-tight">{fileName(file.path)}</p>
        <p className="truncate font-mono text-[12px] text-faint">
          {folder || "/"} <span className="font-sans text-caught">+{file.added}</span> <span className="font-sans text-missed">−{file.removed}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {layout.cited > 0 && (
          <Pill tone="ai">
            <span className="-ml-1">
              <Avatar who="ai" size={16} />
            </span>
            {plural(layout.cited, "cited block")}
          </Pill>
        )}
        {layout.blind > 0 && (
          <Pill tone="missed">
            <Dot className="bg-missed" /> {plural(layout.blind, "blind spot")}
          </Pill>
        )}
        {layout.findings > 0 && (
          <Pill tone="warn">
            <Dot className="bg-warn" /> {plural(layout.findings, "reported problem")}
          </Pill>
        )}
        <button type="button" onClick={onOpen} className="btn h-[30px] px-2.5 text-[13.5px]" title={`Show every change in ${file.path}`}>
          <PanelIcon size={15} />
          Open file
        </button>
      </div>
    </header>
  );
}

/** What the colours in the code mean, for a view that has no cards to say it. */
export function Legend({ model, objective }: { model: string; objective: string | null }) {
  const key = (style: string, text: string) => (
    <span className="inline-flex items-center gap-1.5">
      <i className={`inline-block h-3.5 w-[3px] rounded-full ${style}`} aria-hidden="true" />
      {text}
    </span>
  );
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-soft">
      {key("bg-missed", "blind spot, check yourself")}
      {key("bg-warn", `reported by ${model}`)}
      {objective && key("bg-ai", `cited by ${model} for ${objective}`)}
    </p>
  );
}

/**
 * The full change beside the page, one file at a time: every blind spot and every reported
 * problem of the review marked, and the lines cited in the step on screen.
 */
export function ChangeDrawer({
  files,
  marksFor,
  start,
  model,
  objective,
  onClose,
}: {
  files: FileDiff[];
  marksFor: (file: FileDiff) => Mark[];
  /** The file and line to open at. */
  start: { path: string; line: number | null };
  model: string;
  objective: string | null;
  onClose: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const close = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState(start);
  const file = findFile(files, at.path) ?? files[0];
  const marks = useMemo(() => (file ? marksFor(file) : []), [file, marksFor]);
  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!file) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="The full change">
      <motion.div
        className="absolute inset-0 bg-ink/20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0 : 0.18 }}
        onClick={onClose}
      />
      <motion.aside
        initial={reduced ? { opacity: 0 } : { x: "100%" }}
        animate={reduced ? { opacity: 1 } : { x: 0 }}
        exit={reduced ? { opacity: 0 } : { x: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        className="absolute inset-y-2 right-2 flex w-[min(60rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-hair bg-panel shadow-[var(--shadow-pop)]"
      >
        <header className="space-y-3 border-b border-hair px-5 pb-3 pt-3">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-hair text-soft">
              <FileIcon size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{fileName(file.path)}</p>
              <p className="truncate font-mono text-[12px] text-faint">
                {file.path} <span className="font-sans text-caught">+{file.added}</span> <span className="font-sans text-missed">−{file.removed}</span>
              </p>
            </div>
            <button ref={close} type="button" onClick={onClose} className="btn h-8 w-8 shrink-0 !p-0" aria-label="Close">
              <XIcon size={16} />
            </button>
          </div>
          {files.length > 1 && (
            <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-canvas p-1" role="tablist" aria-label="Files in the change">
              {files.map((item) => {
                const active = item.path === file.path;
                const blind = marksFor(item).filter((mark) => mark.tone === "blind").length;
                return (
                  <button
                    key={item.path}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    title={item.path}
                    onClick={() => setAt({ path: item.path, line: null })}
                    className={`flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 font-mono text-[12px] ${
                      active ? "bg-panel text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]" : "text-soft hover:text-ink"
                    }`}
                  >
                    {fileName(item.path)}
                    {blind > 0 && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-md bg-missed-wash px-1 font-sans text-[11px] text-missed">{blind}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <Legend model={model} objective={objective} />
        </header>
        <DiffView key={file.path} file={file} marks={marks} focus={at.line} className="min-h-0 flex-1 py-2" />
      </motion.aside>
    </div>
  );
}

/**
 * The change as the person reads it in one step: every file, every changed run. Runs that hold
 * something to read (cited lines, blind spots, reported problems) open as cards; the rest fold away.
 */
export function Changes({
  layout,
  lens,
  spots,
  findingAnswers,
  onSpot,
  onFinding,
  jump,
  onOpenFile,
}: {
  layout: Layout;
  lens: Lens;
  spots: Record<string, SpotVerdict>;
  findingAnswers: Record<string, FindingAnswer>;
  onSpot: (plantId: string, verdict: SpotVerdict) => void;
  onFinding: (index: string, answer: FindingAnswer) => void;
  /** An element to bring into view, by id; the token makes the same id jump again. */
  jump: { id: string; token: number } | null;
  /** Shows a file of the full change beside the page, at a line. */
  onOpenFile: (path: string, line: number | null) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const [tab, setTab] = useState<string>("all");
  const [flash, setFlash] = useState<string | null>(null);
  const tabNow = useRef(tab);
  tabNow.current = tab;

  useEffect(() => {
    if (!jump) return;
    // From a single file, the other files fade in first: wait until the target is on the page and still.
    const switching = tabNow.current !== "all";
    setTab("all");
    let timer = 0;
    let tries = 0;
    const attempt = () => {
      const target = document.getElementById(jump.id);
      const settled = target && (!switching || tries >= 6);
      if (settled) {
        target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
        setFlash(jump.id);
        timer = window.setTimeout(() => setFlash(null), 1400);
      } else if (tries++ < 30) {
        timer = window.setTimeout(attempt, 60);
      }
    };
    timer = window.setTimeout(attempt, 0);
    return () => window.clearTimeout(timer);
  }, [jump, reduced]);

  const loud = layout.files.filter(fileRelevant);
  const quietFiles = layout.marked ? layout.files.filter((item) => !fileRelevant(item)) : [];
  const shown = tab === "all" ? (layout.marked ? loud : layout.files) : layout.files.filter((item) => item.file.path === tab);

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-[16px] font-semibold">
          {layout.files.length === 1 ? "Changes in the 1 file" : `Changes in all ${layout.files.length} files`}
        </h2>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-soft">
          {lens.cites.length > 0 && (
            <span>
              <span className="font-mono text-ai">{lens.cites[0].start}</span> cited by {lens.model}
            </span>
          )}
          {lens.blind.length > 0 && (
            <span className="inline-flex items-center gap-2">
              <i className="inline-block h-3.5 w-[3px] rounded-full bg-missed" aria-hidden="true" />
              blind spot, check yourself
            </span>
          )}
          {lens.findings.length > 0 && (
            <span className="inline-flex items-center gap-2">
              <i className="inline-block h-3.5 w-[3px] rounded-full bg-warn" aria-hidden="true" />
              reported by {lens.model}
            </span>
          )}
        </p>
      </div>

      <div className="no-scrollbar mt-3 flex items-center gap-1 overflow-x-auto rounded-xl bg-canvas p-1" role="tablist" aria-label="Files in the change">
        {[{ key: "all", layout: null as FileLayout | null }, ...layout.files.map((item) => ({ key: item.file.path, layout: item }))].map(({ key, layout: item }, index) => {
          const active = tab === key;
          return (
            <span key={key} className="flex shrink-0 items-center">
              {index === 1 && <span className="mx-1 h-[18px] w-px bg-line" aria-hidden="true" />}
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(key)}
                title={item ? item.file.path : undefined}
                className={`relative flex h-[30px] items-center gap-2 rounded-lg px-3 ${active ? "text-ink" : "text-soft hover:text-ink"}`}
              >
                {active && (
                  <motion.span
                    layoutId="file-tab"
                    className="absolute inset-0 rounded-lg bg-panel shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_1px_rgb(0_0_0/0.04)]"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <span className="relative flex items-center gap-2">
                  {item ? <FileIcon size={14} className="text-faint" /> : <FilesIcon size={15} />}
                  {item ? (
                    <span className="font-mono text-[12.5px]">{fileName(item.file.path)}</span>
                  ) : (
                    <span className="text-[14px] font-medium">All files</span>
                  )}
                  {!item && <span className="grid h-5 min-w-5 place-items-center rounded-md bg-canvas px-1 text-[11.5px] text-soft">{layout.files.length}</span>}
                  {item && item.blind > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-md bg-missed-wash px-1 text-[11.5px] font-medium text-missed">{item.blind}</span>}
                  {item && item.blind === 0 && item.findings > 0 && (
                    <span className="grid h-5 min-w-5 place-items-center rounded-md bg-warn-wash px-1 text-[11.5px] font-medium text-warn">{item.findings}</span>
                  )}
                </span>
              </button>
            </span>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: reduced ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          {shown.map((item) => (
            <div key={item.file.path} className="mt-6 space-y-3">
              <FileHeader
                layout={item}
                onOpen={() => {
                  // Open the file at the first line this step asks about.
                  const starts = item.blocks.flatMap(blockMarks).map((mark) => mark.start);
                  onOpenFile(item.file.path, starts.length > 0 ? Math.min(...starts) : null);
                }}
              />
              {item.blocks.map((block) =>
                relevant(block) ? (
                  <BlockCard
                    key={block.id}
                    onOpenFile={onOpenFile}
                    block={block}
                    lens={lens}
                    spots={spots}
                    findingAnswers={findingAnswers}
                    onSpot={onSpot}
                    onFinding={onFinding}
                    flash={flash}
                  />
                ) : (
                  <QuietBlock key={block.id} block={block} quiet={layout.marked ? lens.quiet : ""} startOpen={!layout.marked} />
                ),
              )}
            </div>
          ))}

          {tab === "all" && quietFiles.length > 0 && (
            <div className="mt-6 overflow-hidden rounded-xl border border-dashed border-line">
              <p className="px-4 pb-1 pt-3 text-[13px] text-soft">
                {plural(quietFiles.length, "more file")} changed, {lens.quiet} in {quietFiles.length === 1 ? "it" : "any of them"}
              </p>
              <ul className="px-1.5 pb-1.5">
                {quietFiles.map((item) => (
                  <li key={item.file.path}>
                    <button
                      type="button"
                      onClick={() => setTab(item.file.path)}
                      className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-canvas"
                    >
                      <FileIcon size={14} className="shrink-0 text-faint" />
                      <span className="shrink-0 font-mono text-[12.5px]">{fileName(item.file.path)}</span>
                      <span className="min-w-0 truncate font-mono text-[12px] text-faint">{item.file.path}</span>
                      <span className="ml-auto shrink-0 text-[12.5px]">
                        <span className="text-caught">+{item.file.added}</span> <span className="text-missed">−{item.file.removed}</span>
                      </span>
                      <span className="shrink-0 text-[13px] text-link group-hover:underline">Show</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
