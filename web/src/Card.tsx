import { motion } from "motion/react";
import { useState } from "react";
import { fileName, formatWhen, postSignOff, prettyModel } from "./lib";
import type { Exam, Plant, Reviewer, SignOff } from "./types";

const DECISIONS: { value: string; label: string }[] = [
  { value: "accept", label: "Accept" },
  { value: "full_read", label: "Needs a full read" },
  { value: "reject", label: "Reject" },
];

const DECISION_TEXT: Record<string, string> = {
  accept: "accepted",
  full_read: "sent for a full read",
  reject: "rejected",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule py-5">
      <h3 className="mb-2 text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-faint">{title}</h3>
      {children}
    </section>
  );
}

export function Card({
  exam,
  reviewer,
  signoffs,
  onSigned,
  onJump,
}: {
  exam: Exam;
  reviewer: Reviewer;
  signoffs: SignOff[];
  onSigned: (entry: SignOff) => void;
  onJump: (plant: Plant) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plants = new Map(exam.plants.map((plant) => [plant.id, plant]));
  const missed = reviewer.read_yourself.map((id) => plants.get(id)).filter((plant): plant is Plant => Boolean(plant));
  const mine = signoffs.filter((entry) => entry.reviewer === reviewer.name);

  const verdict = reviewer.review_failed
    ? "gave no usable answer on the real change"
    : reviewer.verdict === true
      ? "says the change meets the requirement"
      : reviewer.verdict === false
        ? "says the change does not meet the requirement"
        : "could not tell whether the change meets the requirement";

  const sign = async (decision: string) => {
    setBusy(true);
    setError(null);
    try {
      onSigned(await postSignOff({ change_id: exam.change.id, reviewer: reviewer.name, name, decision }));
      setName("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The sign-off could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.article
      key={reviewer.name}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="mx-auto max-w-3xl rounded-sm border border-rule bg-sheet px-7 pb-7 pt-8 shadow-[0_1px_0_#fff_inset,0_18px_40px_-28px_rgba(40,34,20,0.45)] sm:px-10"
    >
      <header className="pb-5">
        <p className="text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-faint">Sign-off card</p>
        <h2 className="mt-1 font-serif text-[1.7rem] leading-tight">{exam.change.requirement_title}</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[0.9rem]">
          <dt className="text-faint">Requirement</dt>
          <dd>#{exam.change.requirement_id}</dd>
          <dt className="text-faint">Change</dt>
          <dd className="font-mono text-[0.85rem]">{exam.change.id}</dd>
          <dt className="text-faint">Reviewer</dt>
          <dd>{prettyModel(reviewer.name)}</dd>
          <dt className="text-faint">Tested</dt>
          <dd>{formatWhen(reviewer.created_at)}</dd>
        </dl>
      </header>

      <Section title="What the reviewer found in the real change">
        <p>
          {prettyModel(reviewer.name)} <strong>{verdict}</strong>.
        </p>
        {reviewer.findings.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {reviewer.findings.map((finding, index) => (
              <li key={index} className="text-[0.93rem]">
                <span className="font-mono text-[0.82rem] text-soft">
                  {fileName(finding.file)}:{finding.line_start}
                </span>{" "}
                {finding.message}
              </li>
            ))}
          </ul>
        ) : (
          !reviewer.review_failed && <p className="mt-1 text-soft">It reported no problems.</p>
        )}
      </Section>

      <Section title="How far to trust that">
        <ul className="space-y-1.5 text-[0.95rem]">
          <li>
            <strong>Planted defects.</strong> {reviewer.claim}
          </li>
          <li>
            <strong>Harmless edits.</strong>{" "}
            {reviewer.counts.harmless_total > 0
              ? `${reviewer.counts.false_alarms} of ${reviewer.counts.harmless_total} wrongly reported as problems.`
              : "None were planted, so false alarms were not measured."}
          </li>
          <li>
            <strong>Altered requirement.</strong>{" "}
            {reviewer.requirement_flip_changed_verdict === true
              ? "Its verdict changed when the requirement was changed, so it did check against the requirement."
              : reviewer.requirement_flip_changed_verdict === false
                ? "Its verdict did not change when the requirement was changed. Its requirement check is not reliable here."
                : "Not tested."}
          </li>
          {reviewer.counts.failed > 0 && (
            <li>
              <strong>Left out.</strong> {reviewer.counts.failed} planted{" "}
              {reviewer.counts.failed === 1 ? "copy" : "copies"} got no usable answer and {reviewer.counts.failed === 1 ? "is" : "are"} not in the score.
            </li>
          )}
        </ul>
      </Section>

      <Section title="Read these lines yourself">
        {missed.length > 0 ? (
          <>
            <p className="mb-2 text-[0.93rem] text-soft">
              The reviewer did not see a defect planted here, so its silence about these lines means little.
            </p>
            <ul className="space-y-2">
              {missed.map((plant) => (
                <li key={plant.id}>
                  <button
                    type="button"
                    onClick={() => onJump(plant)}
                    className="group flex w-full items-baseline gap-3 rounded border border-missed/30 bg-missed-wash/50 px-3 py-2 text-left transition-colors hover:border-missed"
                  >
                    <span className="shrink-0 font-mono text-[0.82rem] text-missed">
                      {fileName(plant.file)}:{plant.line_start}
                      {plant.line_end > plant.line_start ? `–${plant.line_end}` : ""}
                    </span>
                    <span className="text-[0.9rem]">{plant.description}</span>
                    <span className="ml-auto shrink-0 text-[0.8rem] text-missed opacity-0 transition-opacity group-hover:opacity-100">
                      Show ↑
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : reviewer.counts.defects_total > 0 ? (
          <p className="text-[0.95rem]">None singled out. Every planted defect that was scored was caught.</p>
        ) : (
          <p className="text-[0.95rem]">No planted defects were scored. Treat the whole change as unreviewed.</p>
        )}
      </Section>

      <Section title="What the reviewer refused to decide">
        {reviewer.refused_to_decide.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-[0.93rem]">
            {reviewer.refused_to_decide.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="text-soft">Nothing stated.</p>
        )}
      </Section>

      <Section title="Not checked">
        <ul className="list-disc space-y-1 pl-5 text-[0.9rem] text-soft">
          {!exam.build_checked && <li>Planted copies were not compiled or run, so some may not be real defects.</li>}
          <li>Design-level mistakes, and anything outside this change.</li>
          <li>Planted defects are usually easier to catch than real ones, so the figures lean optimistic.</li>
        </ul>
        <p className="mt-3 text-[0.82rem] text-faint">
          {reviewer.reviews} reviews · {reviewer.tokens_in.toLocaleString()} tokens in, {reviewer.tokens_out.toLocaleString()} out ·{" "}
          {Math.round(reviewer.seconds)} seconds
        </p>
      </Section>

      <Section title="Sign-off">
        {mine.length > 0 && (
          <ul className="mb-4 space-y-1.5">
            {mine.map((entry, index) => (
              <motion.li
                key={`${entry.signed_at}-${index}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex flex-wrap items-baseline gap-x-2 text-[0.95rem]"
              >
                <span className="font-serif text-[1.25rem] italic">{entry.name}</span>
                <span className="text-soft">
                  {DECISION_TEXT[entry.decision] ?? entry.decision} this change, {formatWhen(entry.signed_at)}
                </span>
              </motion.li>
            ))}
          </ul>
        )}
        <p className="mb-3 text-[0.93rem]">
          I have read the findings and the lines listed above, and I own the decision on this change.
        </p>
        <label className="block text-[0.82rem] text-faint" htmlFor={`name-${reviewer.name}`}>
          Your name
        </label>
        <input
          id={`name-${reviewer.name}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          className="mt-1 w-full max-w-sm border-b border-ink bg-transparent pb-1 font-serif text-[1.25rem] italic outline-none placeholder:text-faint/70 focus-visible:outline-none focus:border-accent"
          placeholder="Sign here"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {DECISIONS.map((decision) => (
            <button
              key={decision.value}
              type="button"
              disabled={busy || !name.trim()}
              onClick={() => sign(decision.value)}
              className={`rounded border px-3.5 py-1.5 text-[0.9rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                decision.value === "accept"
                  ? "border-ink bg-ink text-sheet hover:bg-accent hover:border-accent"
                  : "border-ink hover:bg-ink hover:text-sheet"
              }`}
            >
              {decision.label}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-[0.9rem] text-missed">
            {error}
          </p>
        )}
      </Section>
    </motion.article>
  );
}
