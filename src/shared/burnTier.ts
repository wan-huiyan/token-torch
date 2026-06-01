/* ============================================================================
 * Pure, React-free burn-tier logic — the single source of truth shared by the
 * dashboard and session helpers (src/session/ may not import ../dashboard/, so
 * this neutral src/shared/ home is required). No imports → tsx-testable directly.
 *
 * Tiers are RELATIVE to the corpus's own kept-session cost distribution: bands
 * are quantile cutoffs computed at generate-time (computeBurnBands). When no
 * bands are supplied (old fixtures), we fall back to the original ABSOLUTE
 * thresholds so previously-generated data still renders.
 * ========================================================================== */

export type BurnBands = { campfire: number; inferno: number };
export type BurnTier = { key: "inferno" | "campfire" | "ember"; name: string; n: number };

const INFERNO: BurnTier = { key: "inferno", name: "Inferno", n: 3 };
const CAMPFIRE: BurnTier = { key: "campfire", name: "Campfire", n: 2 };
const EMBER: BurnTier = { key: "ember", name: "Lil’ Ember", n: 1 };

/** Legacy absolute thresholds — used when no distribution-relative bands exist. */
const DEFAULT_BANDS: BurnBands = { campfire: 200, inferno: 300 };

/**
 * Classify a session's cost into a tier. `bands` are the (generate-time)
 * distribution-relative cutoffs; omit them to use the legacy absolute defaults.
 */
export function burnTier(cost: number, bands: BurnBands = DEFAULT_BANDS): BurnTier {
  if (cost >= bands.inferno) return INFERNO;
  if (cost >= bands.campfire) return CAMPFIRE;
  return EMBER;
}

/**
 * Compute distribution-relative bands from the kept-session costs: campfire =
 * 60th percentile, inferno = 90th percentile (nearest-rank on the sorted asc
 * costs). Guards: an empty/degenerate corpus, or cutoffs that aren't strictly
 * monotonic (campfire < inferno), fall back to DEFAULT_BANDS so the tiers never
 * collapse silently. Pure: no external imports, rounds to cents inline.
 */
export function computeBurnBands(costs: number[]): BurnBands {
  if (costs.length < 5) return DEFAULT_BANDS;
  const sorted = costs.slice().sort((a, b) => a - b);
  const quantile = (q: number): number => {
    // nearest-rank: index = ceil(q * n) - 1, clamped into range
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return Math.round(sorted[idx] * 100) / 100;
  };
  const campfire = quantile(0.6);
  const inferno = quantile(0.9);
  if (!(campfire < inferno)) return DEFAULT_BANDS;
  return { campfire, inferno };
}
