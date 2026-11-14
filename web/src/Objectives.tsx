import { useState } from "react";
import { formatWhen, postApproval } from "./lib";
import { Prose } from "./Prose";
import type { Exam } from "./types";

type Draft = Record<string, { decision: "keep" | "strike"; risk: "normal" | "high" }>;

function draftFrom(exam: Exam): Draft {
  const draft: Draft = {};
  for (const point of exam.requirement_points) {
    const approved = exam.approval?.objectives.find((item) => item.id === point.id);
    draft[point.id] = { decision: approved?.decision ?? "keep", risk: approved?.risk ?? "normal" };
  }
  return draft;
}

/**
 * The first question on every pull request: what does done mean? A model drafted the objectives
 * from the requirement, without seeing the code. Everything after this step is measured against
 * them, so the person who owns the requirement approves them first. They are not shown what the
 * AI reviewer said about each one, so the approval is about intent, not about the code.
 */
export function Objectives({ exam, onApproved }: { exam: Exam; onApproved: () => Promise<void> }) {
  const approval = exam.approval ?? null;
  const [editing, setEditing] = useState(approval == null);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(exam));
  const [added, setAdded] = useState<{ text: string; risk: "normal" | "high" }[]>(
    () => approval?.objectives.filter((item) => item.added).map((item) => ({ text: item.text, risk: item.risk })) ?? [],
  );
  const [newText, setNewText] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requirementBody = exam.change.requirement_text.split("\n").slice(1).join("\n").replace(/^\s*Source:.*$/m, "").trim();

  const set = (id: string, change: Partial<Draft[string]>) => setDraft((current) => ({ ...current, [id]: { ...current[id], ...change } }));

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await postApproval(exam.change.id, {
        name,
        objectives: exam.requirement_points.map((point) => ({ id: point.id, ...draft[point.id] })),
        added,
      });
      await onApproved();
      setEditing(false);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The approval could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  if (approval && !editing) {
    const kept = approval.objectives.filter((item) => item.decision === "keep");
    const struck = approval.objectives.filter((item) => item.decision === "strike");
    return (
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-canvas">
        <div className="max-w-3xl space-y-4 px-8 py-6">
          <section className="rounded-lg border-2 border-ink bg-caught-wash px-5 py-4">
            <p className="text-[15px] font-bold">
              Approved by {approval.name}, {formatWhen(approval.approved_at)}
            </p>
            <p className="mt-1 text-[13.5px] text-soft">
              {kept.length} {kept.length === 1 ? "objective" : "objectives"} to review
              {struck.length > 0 && `, ${struck.length} struck as out of scope`}. Everything that follows is measured against these.
            </p>
          </section>
          <ol className="space-y-2">
            {approval.objectives.map((item) => (
              <li key={item.id} className={`rounded-lg border-2 border-ink bg-panel px-4 py-3 ${item.decision === "strike" ? "opacity-60" : ""}`}>
                <p className="text-[14px] leading-snug">
                  <span className="mr-2 font-mono text-[12.5px] font-bold text-faint">{item.id}</span>
                  <span className={item.decision === "strike" ? "line-through" : ""}>{item.text}</span>
                </p>
                <p className="mt-1 flex flex-wrap gap-2 text-[11.5px] font-bold">
                  {item.decision === "strike" && <span className="rounded-sm bg-ink px-1.5 py-px text-white">Struck: out of scope</span>}
                  {item.risk === "high" && <span className="rounded-sm bg-missed px-1.5 py-px text-white">Risky: tested harder</span>}
                  {item.added && <span className="rounded-sm bg-warn px-1.5 py-px">Added by the owner: the AI did not review it</span>}
                </p>
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => setEditing(true)} className="text-[13px] font-bold text-brand underline underline-offset-2">
            Change the approval
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-canvas">
      <div className="max-w-3xl space-y-4 px-8 py-6">
        <details className="group rounded-lg border-2 border-ink bg-panel px-5 py-3">
          <summary className="cursor-pointer list-none text-[13.5px] font-bold">
            The requirement, as the issue states it <span className="text-faint group-open:hidden">+</span>
            <span className="hidden text-faint group-open:inline">−</span>
          </summary>
          <div className="thin-scroll mt-2 max-h-72 overflow-y-auto">
            <Prose text={requirementBody} />
          </div>
        </details>

        <ol className="space-y-2">
          {exam.requirement_points.map((point) => {
            const item = draft[point.id];
            const struck = item.decision === "strike";
            return (
              <li key={point.id} className={`rounded-lg border-2 border-ink bg-panel px-4 py-3 ${struck ? "bg-canvas" : ""}`}>
                <p className={`text-[14px] leading-snug ${struck ? "text-faint line-through" : ""}`}>
                  <span className="mr-2 font-mono text-[12.5px] font-bold text-faint no-underline">{point.id}</span>
                  {point.text}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] font-bold">
                  <span className="inline-flex overflow-hidden rounded-md border-2 border-ink">
                    {(["keep", "strike"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={item.decision === value}
                        onClick={() => set(point.id, { decision: value })}
                        className={`px-2.5 py-0.5 ${value === "strike" ? "border-l-2 border-ink" : ""} ${item.decision === value ? "bg-ink text-white" : "bg-panel"}`}
                      >
                        {value === "keep" ? "Keep" : "Strike: out of scope"}
                      </button>
                    ))}
                  </span>
                  <label className={`inline-flex items-center gap-1.5 ${struck ? "opacity-40" : ""}`}>
                    <input
                      type="checkbox"
                      disabled={struck}
                      checked={item.risk === "high"}
                      onChange={(event) => set(point.id, { risk: event.target.checked ? "high" : "normal" })}
                    />
                    Risky: test it harder
                  </label>
                </div>
              </li>
            );
          })}
          {added.map((item, index) => (
            <li key={`added-${index}`} className="rounded-lg border-2 border-dashed border-ink bg-panel px-4 py-3">
              <p className="text-[14px] leading-snug">
                <span className="mr-2 rounded-sm bg-warn px-1.5 py-px text-[11px] font-bold">New</span>
                {item.text}
              </p>
              <button type="button" onClick={() => setAdded(added.filter((_, other) => other !== index))} className="mt-1 text-[12px] font-bold text-soft underline">
                Remove
              </button>
            </li>
          ))}
        </ol>

        <div className="flex gap-2">
          <input
            value={newText}
            onChange={(event) => setNewText(event.target.value)}
            placeholder="Add a missing objective, e.g. a security or performance requirement"
            className="min-w-0 flex-1 rounded-md border-2 border-ink bg-panel px-3 py-1.5 text-[13.5px] placeholder:text-faint"
          />
          <button
            type="button"
            disabled={!newText.trim()}
            onClick={() => {
              setAdded([...added, { text: newText.trim(), risk: "normal" }]);
              setNewText("");
            }}
            className="press rounded-md bg-panel px-3 py-1.5 text-[13px] font-bold"
          >
            Add
          </button>
        </div>

        <section className="rounded-lg border-2 border-ink bg-panel px-5 py-4 shadow-[var(--shadow-hard)]">
          <label htmlFor="owner" className="text-[14px] font-bold">
            Your name, as the owner of this requirement
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id="owner"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              placeholder="e.g. the product owner"
              className="min-w-0 flex-1 rounded-md border-2 border-ink bg-panel px-3 py-1.5 text-[14px] placeholder:text-faint"
            />
            <button type="button" disabled={busy || !name.trim()} onClick={approve} className="press rounded-md bg-caught px-4 py-1.5 text-[14px] font-bold text-white">
              Approve these objectives
            </button>
            {approval && (
              <button type="button" onClick={() => setEditing(false)} className="text-[13px] font-bold text-soft underline">
                Cancel
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-2 text-[13px] font-medium text-missed">
              {error}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
