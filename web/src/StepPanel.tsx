import { DiffView, type Mark } from "./DiffView";
import { fileName, lineRange } from "./lib";
import { excerptRows, findFile, pointCards, type FindingAnswer, type PointStep, type Progress } from "./progress";
import type { FileDiff, Finding, Plant, PointView, SpotVerdict } from "./types";

/** Two answers side by side. Pressing the chosen one again takes it back. */
export function Choice<T extends string>({
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
            className={`press rounded-md px-3.5 py-1.5 text-[13.5px] font-bold ${
              chosen ? (option.good ? "bg-caught text-white" : "bg-missed text-white") : "bg-panel"
            }`}
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

/** A few lines of the change, shown in place. The header opens the same lines in the whole change. */
function Excerpt({
  files,
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
  path: string;
  start: number;
  end: number;
  marks: Mark[];
  /** A short red label for an excerpt the person has to judge. */
  flag?: string;
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
        title={file ? `Open ${path} at line ${start} in the whole change` : path}
        className="group flex w-full items-center gap-2.5 border-b border-hair px-4 py-2 text-left"
      >
        <span className="font-mono text-[12.5px] font-bold">
          {fileName(path)}
          <span className="text-faint">:{lineRange(start, end)}</span>
        </span>
        {flag && <span className="rounded-sm bg-missed px-1.5 py-px text-[10.5px] font-bold uppercase tracking-wide text-white">{flag}</span>}
        {file && <span className="ml-auto text-[12px] font-medium text-faint group-hover:text-brand group-hover:underline">Open in the whole change →</span>}
      </button>
      {lead}
      {file && rows.length > 0 ? (
        <DiffView file={{ ...file, rows }} marks={marks} tags={false} className="py-1.5" />
      ) : (
        <p className="px-4 py-3 text-[13px] text-soft">These lines are not in the change shown here.</p>
      )}
      {children}
    </article>
  );
}

/** The question on a blind spot. The mistake was planted in a copy; the real code may well be fine. */
function SpotCheck({ plant, verdict, onVerdict }: { plant: Plant; verdict: SpotVerdict | undefined; onVerdict: (id: string, verdict: SpotVerdict) => void }) {
  const where = `${plant.line_end > plant.line_start ? "lines" : "line"} ${lineRange(plant.line_start, plant.line_end)}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hair bg-missed-wash px-4 py-3">
      <p className="min-w-[16rem] flex-1 text-[13.5px] leading-snug">
        <span className="text-soft">
          In a test copy, the reviewer missed {plant.kind === "omission" ? "that we removed needed code" : "a mistake we planted"} on {where}.
        </span>{" "}
        <strong>Does the real code here look right?</strong>
      </p>
      <Choice value={verdict} options={SPOT_OPTIONS} onPick={(value) => onVerdict(plant.id, value)} />
    </div>
  );
}

const spotMark = (plant: Plant): Mark => ({ start: plant.line_start, end: plant.line_end, tone: "blind" });

function Scroller({ children }: { children: React.ReactNode }) {
  return (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-canvas">
      <div className="space-y-4 px-8 py-6">{children}</div>
    </div>
  );
}

type Shared = {
  files: FileDiff[];
  progress: Progress;
  onOpen: (path: string, line: number) => void;
  onSpot: (plantId: string, verdict: SpotVerdict) => void;
};

/** Every line the reviewer cites for one requirement point, open at once, with its blind spots marked. */
export function PointBody({ step, files, progress, onOpen, onSpot, onWholeChange }: Shared & { step: PointStep; onWholeChange: () => void }) {
  const cards = pointCards(step);
  const { point } = step;
  if (cards.length === 0) {
    return (
      <Scroller>
        <div className="max-w-xl rounded-lg border-2 border-ink bg-panel px-5 py-5">
          <p className="text-[15px] font-bold">The reviewer points to no lines for this</p>
          <p className="mt-1 text-[13.5px] leading-snug text-soft">
            {point.broad_evidence
              ? "Its citations covered too many lines to count as evidence."
              : point.dropped_evidence
                ? "The lines it cited are not in this change."
                : "It cited nothing."}{" "}
            Read the whole change with this requirement in mind.
          </p>
          <button type="button" onClick={onWholeChange} className="press mt-4 rounded-md bg-warn px-3.5 py-1.5 text-[13.5px] font-bold">
            Read the whole change
          </button>
        </div>
      </Scroller>
    );
  }
  return (
    <Scroller>
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
          flag={card.spots.length > 0 ? "Check this yourself" : undefined}
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
        <Excerpt
          key={plant.id}
          files={files}
          path={plant.file}
          start={plant.line_start}
          end={plant.line_end}
          marks={[spotMark(plant)]}
          flag="Check this yourself"
          onOpen={onOpen}
        >
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
          onOpen={onOpen}
          lead={
            // Above the code: a finding can cover many lines, and the answer must stay in reach.
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hair bg-warn-wash px-4 py-3">
              <p className="min-w-[16rem] flex-1 text-[13.5px] leading-snug">
                <span className="text-soft">The reviewer says:</span> <strong>{finding.message}</strong>
              </p>
              <Choice value={progress.findings[String(index)]} options={FINDING_OPTIONS} onPick={(value) => onFinding(String(index), value)} />
            </div>
          }
        />
      ))}
    </Scroller>
  );
}

/** Objectives the test proved: listed once, with what proved them. No reading asked for. */
export function ProvenBody({ points, onOpen }: { points: PointView[]; onOpen: (path: string, line: number) => void }) {
  return (
    <Scroller>
      {points.map((point) => (
        <article key={point.id} className="max-w-3xl rounded-lg border-2 border-ink bg-panel px-5 py-4">
          <p className="text-[14.5px] font-bold leading-snug">
            <span className="mr-2 font-mono text-[12.5px] text-faint">{point.id}</span>
            {point.text}
          </p>
          <p className="mt-1.5 text-[13px] leading-snug text-soft">
            Broke the cited lines {point.broken_total} times: it took back "met" every time. Harmless edits there: {point.harmless_near}, no false alarm.
          </p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            {point.evidence.map((ref, index) => (
              <button
                key={index}
                type="button"
                onClick={() => onOpen(ref.file, ref.line_start)}
                className="rounded border border-hair bg-canvas px-1.5 py-px font-mono text-[11.5px] font-bold hover:border-ink"
              >
                {fileName(ref.file)}:{lineRange(ref.line_start, ref.line_end)}
              </button>
            ))}
          </p>
        </article>
      ))}
    </Scroller>
  );
}

/** An objective the owner added. The AI never saw it, so there are no lines to point to. */
export function AddedBody({ onWholeChange }: { onWholeChange: () => void }) {
  return (
    <Scroller>
      <div className="max-w-xl rounded-lg border-2 border-ink bg-panel px-5 py-5">
        <p className="text-[15px] font-bold">Nothing tested this objective</p>
        <p className="mt-1 text-[13.5px] leading-snug text-soft">
          It was added after the AI review, so neither the reviewer nor our test looked at it. If the answer depends on running the code, say you can't tell: it then
          appears on the sign-off as risk you accept.
        </p>
        <button type="button" onClick={onWholeChange} className="press mt-4 rounded-md bg-warn px-3.5 py-1.5 text-[13.5px] font-bold">
          Read the whole change
        </button>
      </div>
    </Scroller>
  );
}
