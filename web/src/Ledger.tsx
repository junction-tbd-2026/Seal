import { useEffect, useState } from "react";
import { JUDGEMENT, fetchLedger, prettyModel } from "./lib";
import { decisionText } from "./progress";
import type { Ledger, LedgerArea } from "./types";

function Tile({ title, value, detail, note }: { title: string; value: string; detail: string; note?: string }) {
  return (
    <section className="rounded-lg border-2 border-ink bg-panel px-5 py-4">
      <h3 className="text-[12px] font-bold text-soft">{title}</h3>
      <p className="mt-1 text-[28px] font-extrabold leading-none tracking-tight">{value}</p>
      <p className="mt-2 text-[12.5px] leading-snug text-soft">{detail}</p>
      {note && <p className="mt-1.5 text-[11.5px] font-bold text-missed">{note}</p>}
    </section>
  );
}

const pct = (value: number) => `${Math.round(value * 100)}%`;

/** A small line of one measure over the weeks, with the week of an escape marked. */
function Spark({ values, escapes, low = 0, high = 1 }: { values: number[]; escapes: number[]; low?: number; high?: number }) {
  const width = 120;
  const height = 28;
  const x = (index: number) => 4 + (index * (width - 8)) / Math.max(1, values.length - 1);
  const y = (value: number) => height - 4 - ((value - low) / (high - low || 1)) * (height - 8);
  return (
    <svg width={width} height={height} role="img" aria-label={values.map(pct).join(", ")}>
      <polyline points={values.map((value, index) => `${x(index)},${y(value)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" />
      {escapes.map((count, index) => (count > 0 ? <circle key={index} cx={x(index)} cy={y(values[index])} r="4" className="fill-missed" /> : null))}
    </svg>
  );
}

function AreaRow({ area }: { area: LedgerArea }) {
  const last = area.routed_share.length - 1;
  return (
    <tr className="border-t border-hair align-top">
      <td className="py-2 pr-4 font-bold">{area.area}</td>
      <td className="py-2 pr-4">
        <Spark values={area.routed_share} escapes={area.escapes} />
        <span className="text-[11.5px] text-soft">
          {pct(area.routed_share[0])} → {pct(area.routed_share[last])}
        </span>
      </td>
      <td className="py-2 pr-4 text-[12.5px]">
        {pct(area.catch_rate[last])} caught · {pct(area.alarm_rate[last])} false alarms
      </td>
      <td className="py-2 pr-4 text-[12.5px]">
        {area.minutes_to_sign[0]} → {area.minutes_to_sign[last]} min
      </td>
      <td className="py-2 pr-4 text-[12.5px]">
        {area.escapes.reduce((sum, value) => sum + value, 0)} escapes · {area.reverts.reduce((sum, value) => sum + value, 0)} reverts
      </td>
      <td className="py-2 text-[12.5px]">{area.plants_per_point[last]} breaks per objective</td>
    </tr>
  );
}

/**
 * How trust is measured, with Tieto's own four measures. Real numbers come from the runs and
 * sign-offs in this project; reverts and incidents need months of merges, so they are shown only
 * in an example history that is labelled synthetic.
 */
export function LedgerView() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLedger()
      .then(setLedger)
      .catch((problem: Error) => setError(problem.message));
  }, []);

  if (error) return <p className="p-10 text-missed">{error}</p>;
  if (!ledger) return <p className="p-10 text-soft">Loading the ledger…</p>;

  const { measures, changes, example } = ledger;
  const routed = measures.routed_to_human;
  const time = measures.time_to_sign;
  const findings = measures.findings_real;
  const drill = measures.signer_drill;
  const escapes = example?.areas.reduce((sum, area) => sum + area.escapes.reduce((a, b) => a + b, 0), 0) ?? 0;
  const reverts = example?.areas.reduce((sum, area) => sum + area.reverts.reduce((a, b) => a + b, 0), 0) ?? 0;

  return (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-5xl space-y-6 px-8 py-8">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight">Trust ledger</h1>
          <p className="mt-1 max-w-3xl text-[14.5px] leading-snug text-soft">
            Trust is earned per area from a track record and withdrawn after an escape. These are Tieto's four measures, counted from what the AI reviewers and
            the people signing actually did here.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            title="Share routed to a human"
            value={routed.total ? pct(routed.routed / routed.total) : "–"}
            detail={`${routed.routed} of ${routed.total} approved objectives were not proven by the test, so a person decided them.`}
          />
          <Tile
            title="Time to sign"
            value={
              time.median_seconds == null ? "–" : time.median_seconds < 90 ? `${Math.round(time.median_seconds)} s` : `${Math.round(time.median_seconds / 60)} min`
            }
            detail={time.signoffs ? `Median over ${time.signoffs} sign-offs, from opening the pull request to signing.` : "No sign-offs yet."}
          />
          <Tile
            title="AI findings that were real"
            value={findings.judged ? `${findings.real} of ${findings.judged}` : "–"}
            detail="Each problem the AI reported in the real code, judged real or not by the person signing."
          />
          <Tile
            title="Reverts and incidents after merge"
            value={example ? `${reverts} / ${escapes}` : "–"}
            detail="Reverts and escapes over six weeks. Needs months of merges to measure for real."
            note={example ? "Example history only: synthetic, not measured" : undefined}
          />
        </div>

        <section className="rounded-lg border-2 border-ink bg-panel px-5 py-4">
          <h2 className="text-[16px] font-bold">Every change, every reviewer, same planted copies</h2>
          <table className="mt-3 w-full text-left text-[13px]">
            <thead className="text-[11.5px] uppercase tracking-wide text-soft">
              <tr>
                <th className="pb-1 pr-4">Pull request</th>
                <th className="pb-1 pr-4">Objectives</th>
                <th className="pb-1 pr-4">AI reviewer on this change</th>
                <th className="pb-1">Signed</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={change.number} className="border-t border-hair align-top">
                  <td className="py-2 pr-4">
                    <span className="font-bold">#{change.number}</span> {change.title}
                  </td>
                  <td className="py-2 pr-4">
                    {change.rule
                      ? "Full human read by rule"
                      : change.objectives != null
                        ? `${change.proven} of ${change.objectives} proven${change.approved_by ? `, approved by ${change.approved_by}` : ", not approved yet"}`
                        : "Not tested"}
                  </td>
                  <td className="py-2 pr-4">
                    {(change.reviewers ?? []).map((reviewer) => (
                      <p key={reviewer.name}>
                        <span className={`mr-1.5 rounded-sm px-1.5 py-px text-[11px] font-bold ${JUDGEMENT[reviewer.judgement].tone}`}>
                          {JUDGEMENT[reviewer.judgement].word}
                        </span>
                        {prettyModel(reviewer.name)}: noticed {reviewer.caught} of {reviewer.defects}, alarmed on {reviewer.alarms} of {reviewer.harmless}
                      </p>
                    ))}
                  </td>
                  <td className="py-2">{change.signed ? `${decisionText(change.signed.decision)} by ${change.signed.name}` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[12.5px] text-soft">
            People signing: caught {drill.caught} of {drill.checked} planted copies in the agreed spot-check drill.
          </p>
        </section>

        {example && (
          <section className="rounded-lg border-2 border-dashed border-ink bg-panel px-5 py-4">
            <h2 className="text-[16px] font-bold">How it behaves over time</h2>
            <p className="mt-0.5 text-[12.5px] font-bold text-missed">{example.label}</p>
            <table className="mt-3 w-full text-left text-[13px]">
              <thead className="text-[11.5px] uppercase tracking-wide text-soft">
                <tr>
                  <th className="pb-1 pr-4">Area</th>
                  <th className="pb-1 pr-4">Routed to a human</th>
                  <th className="pb-1 pr-4">Reviewer, last week</th>
                  <th className="pb-1 pr-4">Time to sign</th>
                  <th className="pb-1 pr-4">After merge</th>
                  <th className="pb-1">Testing depth</th>
                </tr>
              </thead>
              <tbody>
                {example.areas.map((area) => (
                  <AreaRow key={area.area} area={area} />
                ))}
              </tbody>
            </table>
            {example.areas.flatMap((area) =>
              (area.events ?? []).map((event) => (
                <p key={`${area.area}-${event.week}`} className="mt-3 rounded-md bg-missed-wash px-3 py-2 text-[13px] leading-snug">
                  <span className="font-bold">
                    {area.area}, {event.week}:
                  </span>{" "}
                  {event.what} {event.effect}
                </p>
              )),
            )}
          </section>
        )}
      </div>
    </div>
  );
}
