import { ratesForModel, round2 } from "./pricing";
import type { CatalogSnapshot } from "./catalogSnapshot";
import type { CatalogSavings, CatalogFlipMarker } from "../../src/types";

export const CATALOG_SAVINGS_NOTE =
  "Estimate. The forward line is a counterfactual: the bare-name catalog weight you'd carry " +
  "if these skills weren't hidden, multiplied by your real turns + subagent dispatches. The " +
  "observed floor is a confounded proxy (it also bundles the system prompt + earliest " +
  "conversation, and is perturbed by cache TTL / pre-warming) — not a clean attribution.";

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function perInjectionOn(date: string, snaps: CatalogSnapshot[]): number {
  let v = 0;
  for (const s of snaps) { if (s.date <= date) v = s.per_injection_tokens; else break; }
  return v;
}

export function deriveCatalogSavings(
  snaps: CatalogSnapshot[],
  injectionsByDay: Map<string, number>,
  floorsByDay: Map<string, number[]>,
  flip_marker: CatalogFlipMarker | undefined,
): CatalogSavings {
  if (snaps.length === 0) {
    return {
      daily: [], cumulative_tokens: 0, hidden_count: 0, total_skills: 0,
      per_injection_tokens: 0, est_usd: 0, flip_marker, note: CATALOG_SAVINGS_NOTE,
    };
  }
  // Defensive: hold-last (`perInjectionOn`) and the latest-headline both assume date-asc order.
  // Sort here so correctness never depends on the caller (the array is tiny — one row per day).
  const sorted = [...snaps].sort((a, b) => a.date.localeCompare(b.date));
  const dates = Array.from(new Set([...injectionsByDay.keys()])).sort((a, b) => a.localeCompare(b));
  let cumulative_tokens = 0;
  const daily = dates.map((date) => {
    const inj = injectionsByDay.get(date) ?? 0;
    const est_saving_tokens = Math.round(perInjectionOn(date, sorted) * inj);
    cumulative_tokens += est_saving_tokens;
    return { date, est_saving_tokens, observed_floor: Math.round(median(floorsByDay.get(date) ?? [])) };
  });
  const latest = sorted[sorted.length - 1];
  const est_usd = round2((cumulative_tokens * ratesForModel("opus").cache_read) / 1_000_000);
  return {
    daily,
    cumulative_tokens,
    hidden_count: latest.hidden_count,
    total_skills: latest.total_skills,
    per_injection_tokens: latest.per_injection_tokens,
    est_usd,
    flip_marker,
    note: CATALOG_SAVINGS_NOTE,
  };
}
