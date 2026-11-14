import { useState } from "react";
import { formatWhen } from "./lib";
import { decisionText, keptIds, stepLabel, type Progress, type Step, type StepState } from "./progress";
import type { Exam, Reviewer, SignOff } from "./types";

const DECISIONS = [
  { value: "accept", label: "Accept", style: "bg-caught text-white" },
  { value: "full_read", label: "Ask for a full read", style: "bg-warn" },
  { value: "reject", label: "Reject", style: "bg-missed text-white" },
];

function StepRow({ step, state, onGoTo }: { step: Step; state: StepState; onGoTo: (stepId: string) => void }) {
  const title = stepLabel(step).title;
  return (
    <li>
      <button type="button" onClick={() => onGoTo(step.id)} className="group flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left hover:bg-canvas">
        <span
          className={`grid h-5 w-5 shrink-0 translate-y-1 place-items-center rounded-full text-[10.5px] font-extrabold ${
            state.flagged ? "bg-missed text-white" : state.done ? "bg-caught text-white" : "bg-canvas text-soft"
          }`}
          aria-hidden="true"
        >
          {state.flagged ? "!" : state.done ? "✓" : ""}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{step.kind === "point" ? `${step.point.id} · ${title}` : title}</span>
        <span className={`shrink-0 text-[12.5px] ${state.flagged ? "font-bold text-missed" : "text-soft"}`}>
          {state.answer ?? <span className="font-bold text-brand group-hover:underline">Open →</span>}
        </span>
      </button>
    </li>
  );
}

/**
 * The last step. It shows only what stands between the person and a decision:
 * the steps still open, or what they marked wrong. What is already done is folded away.
 * Accept needs every earlier step done and nothing marked wrong. Reject and full read are always open.
 */
/** What the person signs: what was proven, what they decided, what nobody could decide, and what nothing checked. */
function Receipt({ exam, reviewer, progress }: { exam: Exam; reviewer: Reviewer; progress: Progress }) {
  const kept = keptIds(exam, reviewer);
  const text = (id: string) =>
    exam.approval?.objectives.find((item) => item.id === id)?.text ?? reviewer.points.find((point) => point.id === id)?.text ?? id;
  const proven = reviewer.points.filter((point) => kept.includes(point.id) && point.proven).map((point) => point.id);
  const decided = kept.filter((id) => !proven.includes(id) && progress.points[id] === "met");
  const unsure = kept.filter((id) => progress.points[id] === "cannot_tell");
  const struck = exam.approval?.objectives.filter((item) => item.decision === "strike") ?? [];
  const untested = exam.changed_lines != null && exam.planted_lines != null ? exam.changed_lines - exam.planted_lines : null;
  const row = (label: string, ids: string[], tone: string) =>
    ids.length > 0 && (
      <div>
        <p className={`text-[12px] font-bold uppercase tracking-wide ${tone}`}>{label}</p>
        <ul className="mt-0.5 space-y-0.5">
          {ids.map((id) => (
            <li key={id} className="truncate text-[13px]" title={text(id)}>
              <span className="mr-1.5 font-mono text-[11.5px] font-bold text-faint">{id}</span>
              {text(id)}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <section className="space-y-3 rounded-lg border-2 border-ink bg-panel px-5 py-4">
      <h3 className="text-[15px] font-bold">What you are signing</h3>
      {row("Proven by our test", proven, "text-caught")}
      {row("Checked by you", decided, "text-ink")}
      {row("Nobody could decide: risk you accept", unsure, "text-missed")}
      <div>
        <p className="text-[12px] font-bold uppercase tracking-wide text-soft">Not checked by anything</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[13px]">
          {untested != null && untested > 0 && (
            <li>
              {untested} of {exam.changed_lines} changed lines had no planted edit, so the reviewer's silence there is untested.
            </li>
          )}
          {!exam.build_checked && <li>Nothing was compiled or run.</li>}
          <li>Design choices, and anything outside this change.</li>
          {struck.map((item) => (
            <li key={item.id}>
              {item.id}, struck by {exam.approval?.name} as out of scope: {item.text}
            </li>
          ))}
        </ul>
      </div>
      {exam.approval ? (
        <p className="text-[12px] text-soft">
          Objectives approved by {exam.approval.name}, {formatWhen(exam.approval.approved_at)}.
        </p>
      ) : (
        <p className="text-[12px] font-bold text-missed">The objectives have not been approved by an owner, so this cannot be accepted yet.</p>
      )}
    </section>
  );
}

export function SignOffStep({
  exam,
  reviewer,
  progress,
  signer,
  steps,
  states,
  mine,
  onGoTo,
  onSign,
}: {
  exam: Exam;
  reviewer: Reviewer;
  progress: Progress;
  /** The person reviewing, if they gave their name. */
  signer: string;
  /** Every step before this one, with its state at the same index. */
  steps: Step[];
  states: StepState[];
  /** Earlier sign-offs on this reviewer's results. */
  mine: SignOff[];
  onGoTo: (stepId: string) => void;
  onSign: (name: string, decision: string) => Promise<void>;
}) {
  const [name, setName] = useState(signer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = steps.map((step, index) => ({ step, state: states[index] }));
  const open = rows.filter((row) => !row.state.done);
  const flagged = rows.filter((row) => row.state.flagged);
  const finished = rows.filter((row) => row.state.done && !row.state.flagged);
  const blocked = open.length > 0 || flagged.length > 0 || !exam.approval;

  const sign = async (decision: string) => {
    setBusy(true);
    setError(null);
    try {
      await onSign(name, decision);
      setName("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The sign-off could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-canvas">
      <div className="max-w-2xl space-y-4 px-8 py-6">
        {mine.length > 0 && (
          <ul className="rounded-lg border-2 border-ink bg-caught-wash px-5 py-3 text-[13.5px]">
            {mine.slice(-3).map((entry, index) => (
              <li key={`${entry.signed_at}-${index}`}>
                <span className="font-bold">{decisionText(entry.decision)}</span> by {entry.name}, {formatWhen(entry.signed_at)}
              </li>
            ))}
          </ul>
        )}

        <Receipt exam={exam} reviewer={reviewer} progress={progress} />

        {blocked && (
          <section className="rounded-lg border-2 border-ink bg-panel px-5 py-4">
            <h3 className="text-[15px] font-bold">
              {flagged.length > 0
                ? "You marked something as wrong, so this cannot be accepted"
                : open.length > 0
                  ? `${open.length === 1 ? "One step is" : `${open.length} steps are`} left before you can accept`
                  : "The owner has not approved the objectives yet"}
            </h3>
            <ul className="-mx-2 mt-2">
              {(flagged.length > 0 ? flagged : open).map((row) => (
                <StepRow key={row.step.id} {...row} onGoTo={onGoTo} />
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-lg border-2 border-ink bg-panel px-5 py-5 shadow-[var(--shadow-hard)]">
          <label htmlFor="signer" className="text-[15px] font-bold">
            {blocked ? "Or decide now" : "Your decision, on the receipt above"}
          </label>
          <input
            id="signer"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            placeholder="Your name"
            className="mt-3 w-full rounded-md border-2 border-ink bg-panel px-3 py-2 text-[14.5px] font-medium placeholder:text-faint"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {DECISIONS.filter((decision) => decision.value !== "accept" || !blocked).map((decision) => (
              <button
                key={decision.value}
                type="button"
                disabled={busy || !name.trim()}
                onClick={() => sign(decision.value)}
                className={`press rounded-md px-4 py-2 text-[14px] font-bold ${decision.style} ${decision.value === "accept" ? "flex-1" : ""}`}
              >
                {decision.label}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-3 text-[13px] font-medium text-missed">
              {error}
            </p>
          )}
        </section>

        {finished.length > 0 && (
          <details className="group text-[13px]" open={!blocked}>
            <summary className="cursor-pointer list-none px-1 font-bold text-soft hover:text-ink">
              What you checked ({finished.length}) <span className="group-open:hidden">+</span>
              <span className="hidden group-open:inline">−</span>
            </summary>
            <ul className="mt-1">
              {finished.map((row) => (
                <StepRow key={row.step.id} {...row} onGoTo={onGoTo} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
