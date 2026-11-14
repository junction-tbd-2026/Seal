import { DiffView, type Mark } from "./DiffView";
import { fileName, lineRange } from "./lib";
import { excerptRows, findFile, pointCards, type FindingAnswer, type PointStep, type Progress } from "./progress";
import type { FileDiff, Finding, Plant, SpotVerdict } from "./types";

/** Two answers side by side. Pressing the chosen one again takes it back. */
export function Choice<T extends string>({
  value,
  options,
  onPick,
  disabled = false,
  size = "small",
}: {
  value: T | undefined;
  options: { value: T; label: string; good: boolean }[];
  onPick: (value: T) => void;
  disabled?: boolean;
  size?: "small" | "large";
}) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {options.map((option) => {
        const chosen = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={chosen}
            onClick={() => onPick(option.value)}
            className={`border-2 border-ink font-bold disabled:cursor-not-allowed disabled:opacity-45 ${
              size === "large" ? "press rounded-md px-3 py-1.5 text-[13px]" : "rounded px-2 py-px text-[12px]"
            } ${chosen ? (option.good ? "bg-caught text-white" : "bg-missed text-white") : "bg-panel hover:bg-canvas"}`}
          >
            {chosen ? "✓ " : ""}
            {option.label}
          </button>
        );
      })}
    </span>
  );
}

const SPOT_OPTIONS: { value: SpotVerdict; label: string; good: boolean }[] = [
  { value: "right", label: "Looks right", good: true },
  { value: "wrong", label: "Looks wrong", good: false },
];

const FINDING_OPTIONS: { value: FindingAnswer; label: string; good: boolean }[] = [
  { value: "not_real", label: "Not a problem", good: true },
  { value: "real", label: "Real problem", good: false },
];

const BADGE: Record<Mark["tone"], { text: string; style: string }> = {
  evidence: { text: "Cited by the reviewer", style: "bg-brand text-white" },
  blind: { text: "Check this yourself", style: "bg-missed text-white" },
  finding: { text: "Reviewer flagged this", style: "bg-warn text-ink" },
};

/** A few lines of the change, shown in place. The header opens the same lines in the whole change. */
function Excerpt({
  files,
  path,
  start,
  end,
  marks,
  badges,
  onOpen,
  lead,
  children,
}: {
  files: FileDiff[];
  path: string;
  start: number;
  end: number;
  marks: Mark[];
  badges: Mark["tone"][];
  onOpen: (path: string, line: number) => void;
  /** Shown above the code, for what must be read before it. */
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
        title={file ? `Show ${path} at line ${start} in the whole change` : path}
        className="group flex w-full flex-wrap items-center gap-x-2 gap-y-1 border-b-2 border-ink bg-canvas px-3 py-1.5 text-left hover:bg-brand-wash disabled:hover:bg-canvas"
      >
        <span className="font-mono text-[12.5px] font-bold">
          {fileName(path)}:{lineRange(start, end)}
        </span>
        {badges.map((tone) => (
          <span key={tone} className={`rounded-sm border-2 border-ink px-1.5 text-[10.5px] font-bold uppercase leading-[1.5] tracking-wide ${BADGE[tone].style}`}>
            {BADGE[tone].text}
          </span>
        ))}
        {file && (
          <span className="ml-auto text-[11.5px] font-bold text-brand underline decoration-2 underline-offset-2 group-hover:text-ink">
            Show in the whole change →
          </span>
        )}
      </button>
      {lead}
      {file && rows.length > 0 ? (
        <DiffView file={{ ...file, rows }} marks={marks} tags={false} />
      ) : (
        <p className="px-3 py-2 text-[12.5px] text-soft">These lines are not in the change shown here.</p>
      )}
      {children}
    </article>
  );
}

function SpotCheck({ plant, verdict, onVerdict }: { plant: Plant; verdict: SpotVerdict | undefined; onVerdict: (id: string, verdict: SpotVerdict) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t-2 border-ink bg-missed-wash px-3 py-2 text-[12.5px]">
      <p className="min-w-[14rem] flex-1 leading-snug">
        <strong>
          {plant.line_end > plant.line_start ? "Lines" : "Line"} {lineRange(plant.line_start, plant.line_end)}: not a known bug.
        </strong>{" "}
        {plant.kind === "omission"
          ? "The reviewer did not notice when we removed needed code here in a copy."
          : "The reviewer did not notice a wrong line we put here in a copy."}{" "}
        A real mistake here would have slipped past it too.
      </p>
      <span className="flex items-center gap-2">
        <span className="font-bold">The real code here:</span>
        <Choice value={verdict} options={SPOT_OPTIONS} onPick={(value) => onVerdict(plant.id, value)} />
      </span>
    </div>
  );
}

const spotMark = (plant: Plant): Mark => ({ start: plant.line_start, end: plant.line_end, tone: "blind" });

function Scroller({ children }: { children: React.ReactNode }) {
  return <div className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto bg-canvas p-4">{children}</div>;
}

type Shared = {
  files: FileDiff[];
  progress: Progress;
  onOpen: (path: string, line: number) => void;
  onSpot: (plantId: string, verdict: SpotVerdict) => void;
};

/** Every line the reviewer cites for one requirement point, open at once, with its blind spots marked. */
export function PointBody({
  step,
  lead,
  files,
  progress,
  onOpen,
  onSpot,
  onWholeChange,
}: Shared & { step: PointStep; /** What the reviewer claims and how far to believe it. */ lead: React.ReactNode; onWholeChange: () => void }) {
  const cards = pointCards(step);
  const { point } = step;
  if (cards.length === 0) {
    return (
      <Scroller>
        {lead}
        <div className="rounded-lg border-2 border-ink bg-panel px-4 py-4">
          <p className="text-[15px] font-bold">The reviewer points to no lines for this requirement</p>
          <p className="mt-1 text-[13px] text-soft">
            {point.broad_evidence
              ? "Its citations covered too many lines to count as evidence."
              : point.dropped_evidence
                ? "The lines it cited are not in this change."
                : "It cited nothing."}{" "}
            There is nothing to show here, so read the whole change with this requirement in mind, then decide below.
          </p>
          <button type="button" onClick={onWholeChange} className="press mt-3 rounded-md bg-warn px-3 py-1.5 text-[13px] font-bold">
            Read the whole change
          </button>
        </div>
      </Scroller>
    );
  }
  return (
    <Scroller>
      {lead}
      {cards.map((card, index) => (
        <Excerpt
          key={index}
          files={files}
          path={card.file}
          start={card.start}
          end={card.end}
          marks={[
            ...card.spots.map(spotMark),
            ...(card.cited ? [{ start: card.cited.line_start, end: card.cited.line_end, tone: "evidence" } as Mark] : []),
          ]}
          badges={[...(card.cited ? (["evidence"] as const) : []), ...(card.spots.length > 0 ? (["blind"] as const) : [])]}
          onOpen={onOpen}
        >
          {card.spots.map((plant) => (
            <SpotCheck key={plant.id} plant={plant} verdict={progress.spots[plant.id]} onVerdict={onSpot} />
          ))}
        </Excerpt>
      ))}
    </Scroller>
  );
}

/** Blind spots that belong to no requirement point. */
export function SpotsBody({ spots, files, progress, onOpen, onSpot }: Shared & { spots: Plant[] }) {
  return (
    <Scroller>
      {spots.map((plant) => (
        <Excerpt key={plant.id} files={files} path={plant.file} start={plant.line_start} end={plant.line_end} marks={[spotMark(plant)]} badges={["blind"]} onOpen={onOpen}>
          <SpotCheck plant={plant} verdict={progress.spots[plant.id]} onVerdict={onSpot} />
        </Excerpt>
      ))}
    </Scroller>
  );
}

/** Problems the reviewer reported in the real code. The person says whether each one is real. */
export function FindingsBody({
  findings,
  files,
  progress,
  onOpen,
  onFinding,
}: Omit<Shared, "onSpot"> & { findings: Finding[]; onFinding: (index: string, answer: FindingAnswer) => void }) {
  return (
    <Scroller>
      {findings.map((finding, index) => (
        <Excerpt
          key={index}
          files={files}
          path={finding.file}
          start={finding.line_start}
          end={finding.line_end}
          marks={[{ start: finding.line_start, end: finding.line_end, tone: "finding" }]}
          badges={["finding"]}
          onOpen={onOpen}
          lead={
            // Above the code: a finding can cover many lines, and the answer must stay in reach.
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b-2 border-ink bg-warn-wash px-3 py-2 text-[12.5px]">
              <p className="min-w-[14rem] flex-1 leading-snug">
                <strong>The reviewer says:</strong> {finding.message}
              </p>
              <span className="flex items-center gap-2">
                <span className="font-bold">Your call:</span>
                <Choice value={progress.findings[String(index)]} options={FINDING_OPTIONS} onPick={(value) => onFinding(String(index), value)} />
              </span>
            </div>
          }
        />
      ))}
    </Scroller>
  );
}
