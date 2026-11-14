import { DiffView, type Mark } from "./DiffView";
import { COLUMN, fileName, lineRange, objectiveName } from "./lib";
import { excerptRows, findFile, pointCards, type FindingAnswer, type PointStep, type Progress } from "./progress";
import type { FileDiff, Finding, Plant, SpotVerdict } from "./types";

/**
 * Two answers side by side. Pressing the chosen one again takes it back.
 * An answer with a `short` form shows only that until it is chosen, so the row keeps its width.
 */
export function Choice<T extends string>({
  value,
  options,
  onPick,
}: {
  value: T | undefined;
  options: { value: T; label: string; short?: string; good: boolean }[];
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
            aria-label={option.label}
            title={option.short ? option.label : undefined}
            onClick={() => onPick(option.value)}
            className={`press rounded-md px-3.5 py-1.5 text-[13.5px] font-bold ${
              chosen ? (option.good ? "bg-caught text-white" : "bg-missed text-white") : "bg-panel"
            }`}
          >
            {chosen ? `✓ ${option.label}` : option.short ?? option.label}
          </button>
        );
      })}
    </span>
  );
}

const FINDING_OPTIONS: { value: FindingAnswer; label: string; good: boolean }[] = [
  { value: "not_real", label: "Problem is not real", good: true },
  { value: "real", label: "Problem is real", good: false },
];

/** A few lines of the change, shown in place. The header says what the lines are and opens them in the full change. */
function Excerpt({
  files,
  name,
  path,
  start,
  end,
  marks,
  flag,
  onOpen,
  lead,
  children,
}: {
  files: FileDiff[];
  /** What the lines are to the audit, e.g. "Reference 1 of 3". */
  name: string;
  path: string;
  start: number;
  end: number;
  marks: Mark[];
  /** A short red label for an excerpt with a line the person has to judge. */
  flag?: string;
  onOpen: (path: string, line: number) => void;
  /** Shown above the code, for what must be read before the code. */
  lead?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const file = findFile(files, path);
  const rows = file ? excerptRows(file, start, end) : [];
  return (
    <article className="overflow-hidden rounded-lg border-2 border-ink bg-panel">
      <button
        type="button"
        onClick={() => onOpen(path, start)}
        disabled={!file}
        title={file ? `Open ${path} at line ${start} in the full change` : path}
        className="group flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-hair px-4 py-2 text-left"
      >
        <span className="text-[12.5px] font-bold">{name}</span>
        <span className="font-mono text-[12.5px] text-soft">
          {fileName(path)}:{lineRange(start, end)}
        </span>
        {flag && <span className="rounded-sm bg-missed px-1.5 py-px text-[10.5px] font-bold uppercase tracking-wide text-white">{flag}</span>}
        {file && <span className="ml-auto text-[12px] font-medium text-faint group-hover:text-brand group-hover:underline">Open in the full change →</span>}
      </button>
      {lead}
      {file && rows.length > 0 ? (
        <DiffView file={{ ...file, rows }} marks={marks} tags={false} className="py-1.5" />
      ) : (
        <p className="px-4 py-3 text-[13px] text-soft">The cited lines are not part of the change.</p>
      )}
      {children}
    </article>
  );
}

/** The question on one red line. The mistake was planted in a test copy; the real code may well be correct. */
function SpotCheck({ plant, verdict, onVerdict }: { plant: Plant; verdict: SpotVerdict | undefined; onVerdict: (id: string, verdict: SpotVerdict) => void }) {
  const many = plant.line_end > plant.line_start;
  const where = `${many ? "lines" : "line"} ${lineRange(plant.line_start, plant.line_end)}`;
  const options: { value: SpotVerdict; label: string; good: boolean }[] = [
    { value: "right", label: many ? "Code is correct" : `Line ${plant.line_start} is correct`, good: true },
    { value: "wrong", label: many ? "Code is wrong" : `Line ${plant.line_start} is wrong`, good: false },
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hair bg-missed-wash px-4 py-3">
      <p className="min-w-[16rem] flex-1 text-[13.5px] leading-snug">
        <span className="text-soft">
          In a test copy, the AI reviewer missed {plant.kind === "omission" ? "removed code" : "a planted mistake"} at {where}.
        </span>{" "}
        <strong>Is the real code at {where} correct?</strong>
      </p>
      <Choice value={verdict} options={options} onPick={(value) => onVerdict(plant.id, value)} />
    </div>
  );
}

const spotMark = (plant: Plant): Mark => ({ start: plant.line_start, end: plant.line_end, tone: "blind" });

function Key({ style, children }: { style: string; children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap">
      <i className={`mr-1.5 inline-block h-3 w-1.5 translate-y-0.5 ${style}`} />
      {children}
    </span>
  );
}

/** Says what the code below is: not the change to review line by line, but what the AI reviewer offers as proof. */
function Heading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[15px] font-bold">{title}</h2>
      {children && <p className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-soft">{children}</p>}
    </div>
  );
}

function Scroller({ children }: { children: React.ReactNode }) {
  return (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-canvas">
      <div className={`${COLUMN} space-y-4 py-6`}>{children}</div>
    </div>
  );
}

type Shared = {
  files: FileDiff[];
  progress: Progress;
  onOpen: (path: string, line: number) => void;
  onSpot: (plantId: string, verdict: SpotVerdict) => void;
};

/** The code the AI reviewer cites as evidence for one objective, every reference open at once. */
export function PointBody({ step, files, progress, onOpen, onSpot, onWholeChange }: Shared & { step: PointStep; onWholeChange: () => void }) {
  const cards = pointCards(step);
  const { point } = step;
  const cited = cards.filter((card) => card.cited).length;
  const objective = objectiveName(point.id);
  if (cards.length === 0) {
    return (
      <Scroller>
        <div className="max-w-xl rounded-lg border-2 border-ink bg-panel px-5 py-5">
          <h2 className="text-[15px] font-bold">Evidence: none. The AI reviewer cites no code for {objective}.</h2>
          <p className="mt-1 text-[13.5px] leading-snug text-soft">Read the full change and decide whether the change meets {objective}.</p>
          <button type="button" onClick={onWholeChange} className="press mt-4 rounded-md bg-warn px-3.5 py-1.5 text-[13.5px] font-bold">
            Read the full change
          </button>
        </div>
      </Scroller>
    );
  }
  let reference = 0;
  return (
    <Scroller>
      <Heading
        title={
          cited > 0
            ? `Evidence: ${cited} code ${cited === 1 ? "reference" : "references"} the AI reviewer cites as proof of ${objective}`
            : `Evidence: none cited. Lines where the AI reviewer missed a planted mistake aimed at ${objective}`
        }
      >
        {cited > 0 && <Key style="bg-brand">Blue lines: cited by the AI reviewer as evidence</Key>}
        {step.spots.length > 0 && <Key style="bg-missed">Red lines: the AI reviewer missed a planted mistake at the same line</Key>}
        <span>Other lines: context</span>
      </Heading>
      {cards.map((card, index) => {
        if (card.cited) reference += 1;
        return (
          <Excerpt
            key={index}
            files={files}
            name={card.cited ? `Reference ${reference} of ${cited}` : "Not cited by the AI reviewer"}
            path={card.file}
            start={card.start}
            end={card.end}
            marks={[
              ...card.spots.map(spotMark),
              ...(card.cited ? [{ start: card.cited.line_start, end: card.cited.line_end, tone: "evidence" } as Mark] : []),
            ]}
            flag={card.spots.length > 0 ? "Contains a red line to judge" : undefined}
            onOpen={onOpen}
          >
            {card.spots.map((plant) => (
              <SpotCheck key={plant.id} plant={plant} verdict={progress.spots[plant.id]} onVerdict={onSpot} />
            ))}
          </Excerpt>
        );
      })}
    </Scroller>
  );
}

/** Red lines that belong to no objective. */
export function SpotsBody({ spots, files, progress, onOpen, onSpot }: Shared & { spots: Plant[] }) {
  return (
    <Scroller>
      <Heading title="Real code at the lines where the AI reviewer missed a planted mistake">
        <Key style="bg-missed">Red lines: the AI reviewer missed a planted mistake at the same line in a test copy</Key>
      </Heading>
      {spots.map((plant, index) => (
        <Excerpt
          key={plant.id}
          files={files}
          name={`Line to judge ${index + 1} of ${spots.length}`}
          path={plant.file}
          start={plant.line_start}
          end={plant.line_end}
          marks={[spotMark(plant)]}
          onOpen={onOpen}
        >
          <SpotCheck plant={plant} verdict={progress.spots[plant.id]} onVerdict={onSpot} />
        </Excerpt>
      ))}
    </Scroller>
  );
}

/** Problems the AI reviewer reported in the real code. The person judges whether each reported problem is real. */
export function FindingsBody({
  findings,
  files,
  progress,
  onOpen,
  onFinding,
}: Omit<Shared, "onSpot"> & { findings: Finding[]; onFinding: (index: string, answer: FindingAnswer) => void }) {
  return (
    <Scroller>
      <Heading title="Real code at the lines the AI reviewer reported">
        <Key style="bg-warn">Yellow lines: reported by the AI reviewer as a problem</Key>
      </Heading>
      {findings.map((finding, index) => (
        <Excerpt
          key={index}
          files={files}
          name={`Reported problem ${index + 1} of ${findings.length}`}
          path={finding.file}
          start={finding.line_start}
          end={finding.line_end}
          marks={[{ start: finding.line_start, end: finding.line_end, tone: "finding" }]}
          onOpen={onOpen}
          lead={
            // Above the code: a reported problem can cover many lines, and the answer must stay in reach.
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hair bg-warn-wash px-4 py-3">
              <p className="min-w-[16rem] flex-1 text-[13.5px] leading-snug">
                <span className="text-soft">The AI reviewer reports:</span> <strong>{finding.message}</strong>
              </p>
              <Choice value={progress.findings[String(index)]} options={FINDING_OPTIONS} onPick={(value) => onFinding(String(index), value)} />
            </div>
          }
        />
      ))}
    </Scroller>
  );
}
