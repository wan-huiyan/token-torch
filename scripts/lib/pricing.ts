/* ============================================================================
 * Pricing + cost derivation. All cost figures are ESTIMATES.
 *
 * Rates are the Opus 4.5+ corrected rates ($/MTok), verified vs the corpus's
 * own `_full` reconciliation record (schema s222-full-usage-v1) on 2026-05-29.
 * The project lesson `cctime-record-main-loop-inflated-by-stale-binary` warns
 * that a stale extractor binary baked OLD Opus rates ($15/$75/$18.75/$1.50,
 * ~3x too high) into some records' `estimatedCostUsd`. So we DO NOT trust a
 * record's stored dollar figure — we recompute every cost from its token
 * counts at these rates. That also makes the contract invariant
 * (by_category[*].usd sums to total_usd) hold by construction.
 *
 * Caveat baked into `PRICING_BASIS`: subagents are priced flat-Opus, so any
 * cross-model (Sonnet/Haiku) subagent is over-counted — per-model token
 * attribution is not in the corpus.
 * ========================================================================== */

export interface Rates {
  fresh_input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

export type ModelFamily = "opus" | "sonnet" | "haiku";

/**
 * Per-model $/MTok rates. Sourced from the corpus Schema-C `pricing_basis`
 * (verified vs platform.claude.com/docs 2026-05-29): Opus 4.5+ (incl. 4.7 & 4.8)
 * in=$5/out=$25 · Sonnet 4.x in=$3/out=$15 · Haiku 4.5 in=$1/out=$5 per MTok.
 * Rule for every family: cache_write = 1.25× input, cache_read = 0.1× input.
 * NOT modeled (per corpus caveat): the 1M-context window (billed at standard
 * per-token rates for current models), fast-mode premium, Opus-4.7+ tokenizer change.
 */
export const MODEL_RATES: Record<ModelFamily, Rates> = {
  opus: { fresh_input: 5.0, output: 25.0, cache_write: 6.25, cache_read: 0.5 },
  sonnet: { fresh_input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
  haiku: { fresh_input: 1.0, output: 5.0, cache_write: 1.25, cache_read: 0.1 },
};

/** Opus 4.5+ corrected rates, $/MTok. (Kept as a named export for back-compat.) */
export const OPUS_RATES: Rates = MODEL_RATES.opus;

/** Map a raw `message.model` id to its pricing family; null if unrecognised. */
export function familyOf(modelId: string): ModelFamily | null {
  const m = modelId.toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return null;
}

/**
 * Rates for a given model id. Unknown ids fall back to Opus — the HIGHEST rate —
 * so an unrecognised model is never silently under-priced (honest upper bound).
 */
export function ratesForModel(modelId: string): Rates {
  return MODEL_RATES[familyOf(modelId) ?? "opus"];
}

export const PRICING_BASIS =
  "Opus 4.5+ estimate: fresh input $5/M · output $25/M · cache-write $6.25/M · cache-read $0.50/M. " +
  "Subagents priced flat-Opus (cross-model agents over-counted). Costs are an estimate — the Anthropic billing dashboard is authoritative.";

/** Token counts in a single universe (main-loop, subagent, or combined). */
export interface TokenSet {
  fresh_input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

export const ZERO_TOKENS: TokenSet = { fresh_input: 0, output: 0, cache_write: 0, cache_read: 0 };

export const addTokens = (a: TokenSet, b: TokenSet): TokenSet => ({
  fresh_input: a.fresh_input + b.fresh_input,
  output: a.output + b.output,
  cache_write: a.cache_write + b.cache_write,
  cache_read: a.cache_read + b.cache_read,
});

export const totalTokens = (t: TokenSet): number =>
  t.fresh_input + t.output + t.cache_write + t.cache_read;

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Precise (unrounded) dollar cost of a token set at given rates. */
export function priceUsd(t: TokenSet, rates: Rates = OPUS_RATES): number {
  return (
    (t.fresh_input * rates.fresh_input +
      t.output * rates.output +
      t.cache_write * rates.cache_write +
      t.cache_read * rates.cache_read) /
    1_000_000
  );
}

export type Category = keyof TokenSet;
const CATEGORIES: Category[] = ["fresh_input", "cache_write", "cache_read", "output"];

export interface CategoryCost {
  tokens: number;
  usd: number;
  rate_per_mtok: number;
  tok_pct: number;
  cost_pct: number;
}

/**
 * Build the by_category breakdown for a token universe such that the rounded
 * per-category dollars sum EXACTLY to the rounded grand total (largest-remainder
 * cent reconciliation). Returns both the map and the reconciled total.
 */
export function buildByCategory(
  combined: TokenSet,
  rates: Rates = OPUS_RATES,
): { byCategory: Record<Category, CategoryCost>; totalUsd: number } {
  const totalTok = totalTokens(combined) || 1;
  const totalUsd = round2(priceUsd(combined, rates));

  // round each category, then push the residual cents onto the largest category.
  const precise = CATEGORIES.map((c) => ({
    c,
    usd: (combined[c] * rates[c]) / 1_000_000,
  }));
  const rounded = precise.map((p) => ({ ...p, usd: round2(p.usd) }));
  const residual = round2(totalUsd - rounded.reduce((a, r) => a + r.usd, 0));
  if (residual !== 0) {
    const largest = rounded.reduce((a, b) => (b.usd > a.usd ? b : a), rounded[0]);
    largest.usd = round2(largest.usd + residual);
  }

  const byCategory = {} as Record<Category, CategoryCost>;
  for (const r of rounded) {
    const tokens = combined[r.c];
    byCategory[r.c] = {
      tokens,
      usd: r.usd,
      rate_per_mtok: rates[r.c],
      tok_pct: round2((tokens / totalTok) * 100),
      cost_pct: totalUsd ? round2((r.usd / totalUsd) * 100) : 0,
    };
  }
  return { byCategory, totalUsd };
}

/** What the cache reads would have cost at the fresh-input rate, minus what they did cost. */
export const cacheSavingsUsd = (cacheReadTokens: number, rates: Rates = OPUS_RATES): number =>
  round2((cacheReadTokens * (rates.fresh_input - rates.cache_read)) / 1_000_000);

/** Extra cost of writing to cache vs treating those tokens as fresh input. */
export const cacheWritePremiumUsd = (cacheWriteTokens: number, rates: Rates = OPUS_RATES): number =>
  round2((cacheWriteTokens * (rates.cache_write - rates.fresh_input)) / 1_000_000);

/** Effective $/MTok across all tokens. */
export const blendedPerMtokUsd = (totalUsd: number, combined: TokenSet): number => {
  const tok = totalTokens(combined);
  return tok ? round2(totalUsd / (tok / 1_000_000)) : 0;
};

export { round2 };
