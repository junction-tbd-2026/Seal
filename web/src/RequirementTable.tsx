import { fileName } from "./lib";
import type { EvidenceRef, PointView, Reviewer } from "./types";

const STATUS: Record<PointView["status"], { label: string; style: string }> = {
  met: { label: "Met", style: "bg-caught text-white" },
  not_met: { label: "Not met", style: "bg-missed text-white" },
  cannot_tell: { label: "Can't tell", style: "bg-warn text-ink" },
};

function noticedCell(point: PointView): { label: string; detail: string; style: string } {
  if (point.status !== "met") {
    return { label: "A person decides", detail: "The reviewer did not call this met.", style: "bg-warn-wash" };
  }
  switch (point.noticed) {
    case "yes":
      return { label: "Yes", detail: `Noticed ${point.broken_noticed} of ${point.broken_total} breaks`, style: "bg-caught-wash" };
    case "no":
      return { label: "No", detail: `Noticed 0 of ${point.broken_total} breaks. Check it yourself.`, style: "bg-missed-wash" };
    case "partly":
      return {
        label: "Partly",
        detail: `Noticed ${point.broken_noticed} of ${point.broken_total} breaks. Check it yourself.`,
        style: "bg-missed-wash",
      };
    default:
      return { label: "Not tested", detail: "We planted nothing against this point.", style: "bg-canvas" };
  }
}

/**
 * The requirement as a checklist: what was asked, what the reviewer claims, the lines it
 * cites, and whether it noticed when we broke that point in a copy.
 */
export function RequirementTable({
  reviewer,
  selected,
  onEvidence,
}: {
  reviewer: Reviewer;
  selected: string | null;
  onEvidence: (pointId: string, evidence: EvidenceRef) => void;
}) {
  if (reviewer.points.length === 0) {
    return (
      <p className="border-b-2 border-ink bg-canvas px-5 py-3 text-[13px] text-soft">
        This run has no requirement breakdown. Run the pull request again to get one.
      </p>
    );
  }
  return (
    <div className="thin-scroll max-h-[17.5rem] overflow-y-auto border-b-2 border-ink bg-panel">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-ink text-left text-[10.5px] uppercase tracking-[0.1em] text-white">
          <tr>
            <th className="px-3 py-1.5 font-bold">What the requirement asks</th>
            <th className="w-24 px-2 py-1.5 font-bold">Reviewer says</th>
            <th className="w-56 px-2 py-1.5 font-bold">Lines it points to</th>
            <th className="w-52 px-2 py-1.5 font-bold">Noticed when we broke it?</th>
          </tr>
        </thead>
        <tbody>
          {reviewer.points.map((point) => {
            const status = STATUS[point.status];
            const noticed = noticedCell(point);
            return (
              <tr key={point.id} className={`border-b border-hair align-top last:border-b-0 ${selected === point.id ? "bg-brand-wash" : ""}`}>
                <td className="px-3 py-2">
                  <span className="mr-1.5 font-mono text-[11px] font-bold text-faint">{point.id}</span>
                  <span className="font-medium">{point.text}</span>
                  {point.reason && (
                    <span className="mt-0.5 line-clamp-2 text-[12px] text-soft" title={point.reason}>
                      {point.reason}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <span className={`inline-block rounded border-2 border-ink px-1.5 py-px text-[11px] font-bold ${status.style}`}>{status.label}</span>
                </td>
                <td className="px-2 py-2">
                  {point.evidence.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {point.evidence.map((evidence, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => onEvidence(point.id, evidence)}
                          title={evidence.file}
                          className="press rounded bg-panel px-1.5 py-px font-mono text-[11px] font-bold hover:bg-brand-wash"
                        >
                          {fileName(evidence.file)}:{evidence.line_start}
                          {evidence.line_end > evidence.line_start ? `–${evidence.line_end}` : ""}
                        </button>
                      ))}
                    </span>
                  ) : (
                    <span className="text-[12px] text-faint">Nothing cited</span>
                  )}
                </td>
                <td className={`px-2 py-2 ${noticed.style}`}>
                  <span className="font-bold">{noticed.label}</span>
                  <span className="block text-[11.5px] leading-snug text-soft">{noticed.detail}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
