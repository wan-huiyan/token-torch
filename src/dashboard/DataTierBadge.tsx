import type { SessionRow } from "../types";

/** Provenance badge for a row's numbers. enriched = usage-tracking overlay present;
 *  jsonl = derived from raw transcript only; thin = sparse; unknown = old fixture. */
const META: Record<string, { label: string; cls: string; title: string }> = {
  enriched: { label: "enriched", cls: "dt-enriched", title: "Reconciled against a usage-tracking record" },
  jsonl: { label: "jsonl", cls: "dt-jsonl", title: "Derived from the raw transcript (no overlay)" },
  thin: { label: "thin", cls: "dt-thin", title: "Sparse transcript — figures are lower-confidence" },
  unknown: { label: "—", cls: "dt-unknown", title: "Data tier not recorded for this session" },
};

export function DataTierBadge({ tier }: { tier?: SessionRow["data_tier"] }) {
  const m = META[tier ?? "unknown"] ?? META.unknown;
  return (
    <span className={`dtbadge ${m.cls}`} title={m.title} aria-label={`data tier: ${m.label}`}>
      {m.label}
    </span>
  );
}
