/* ============================================================================
 * Context-overhead derivation (issue #10). The base context (system prompt +
 * tool/skill catalog + earliest cached conversation) is re-read into every turn
 * and every subagent dispatch. We MEASURE the floor = min nonzero cache_read per
 * session (calibrated; see docs/calibration/2026-06-03-context-overhead-calibration.md)
 * and price its re-reads at the per-model cache_read rate. ESTIMATE: understates
 * when the prefix is re-WRITTEN after a TTL eviction (those count as productive),
 * and the floor is a SMALL fixed slice — accumulating history dominates spend.
 * ========================================================================== */
import { ratesForModel, round2, type TokenSet } from "./pricing";
import type { ContextOverhead } from "../../src/types";

export interface OverheadInput {
  scaffoldingFloor: number;                       // min nonzero cache_read across turns
  turnCount: number;                              // turns that read the prefix
  perModelTokens: Record<string, TokenSet>;       // for the input-side denominator + effective rate
  subagentScaffoldingTokens: number;              // Σ per-dispatch floor across subagents
}

export const OVERHEAD_NOTE =
  "Estimate: fixed base context (system prompt + tool/skill catalog + earliest " +
  "conversation) re-read into every turn — priced at the cache-read rate. This is the " +
  "cache_read floor: it understates after cache-TTL re-writes and is a small fixed slice " +
  "next to the growing conversation. Your billing dashboard is authoritative.";

/** Token-weighted cache_read $/token across the session's models (so a mixed-model
 *  session prices its re-reads correctly; single-model == that family's rate). */
function effectiveCacheReadPerToken(perModelTokens: Record<string, TokenSet>): number {
  let tok = 0;
  let usd = 0;
  for (const [model, t] of Object.entries(perModelTokens)) {
    const rate = ratesForModel(model).cache_read; // $/MTok
    tok += t.cache_read;
    usd += (t.cache_read * rate) / 1_000_000;
  }
  if (tok > 0) return usd / tok;
  // no cache_read tokens → fall back to opus cache_read rate per token (highest, honest upper bound)
  return ratesForModel("opus").cache_read / 1_000_000;
}

/** Token-weighted (fresh_input − cache_read) $/token across the session's models —
 *  the per-token PREMIUM you avoided by serving the re-read from cache instead of
 *  paying fresh. Weighted by each model's cache_read tokens (same basis as above).
 *  ≥ 0 for every family (cache_read < fresh_input). */
function effectiveSavingPerToken(perModelTokens: Record<string, TokenSet>): number {
  let tok = 0;
  let usd = 0;
  for (const [model, t] of Object.entries(perModelTokens)) {
    const r = ratesForModel(model);
    tok += t.cache_read;
    usd += (t.cache_read * Math.max(0, r.fresh_input - r.cache_read)) / 1_000_000;
  }
  if (tok > 0) return usd / tok;
  const r = ratesForModel("opus");
  return Math.max(0, r.fresh_input - r.cache_read) / 1_000_000;
}

export function deriveContextOverhead(input: OverheadInput): ContextOverhead {
  const { scaffoldingFloor, turnCount, perModelTokens, subagentScaffoldingTokens } = input;
  const reread_tokens = scaffoldingFloor * turnCount;

  // input-side denominator: fresh + cache_write + cache_read (the tokens we pay to FEED the model).
  let inputSide = 0;
  for (const t of Object.values(perModelTokens)) inputSide += t.fresh_input + t.cache_write + t.cache_read;

  const reread_usd = round2(reread_tokens * effectiveCacheReadPerToken(perModelTokens));
  const overhead_pct_of_input = inputSide > 0 ? round2((reread_tokens / inputSide) * 100) : 0;
  // honest "$ saved vs paying fresh": the re-read tokens × (fresh − cache_read) premium avoided.
  const reread_saved_usd = round2(reread_tokens * effectiveSavingPerToken(perModelTokens));

  return {
    scaffolding_tokens: scaffoldingFloor,
    reread_tokens,
    reread_usd,
    overhead_pct_of_input,
    subagent_scaffolding_tokens: subagentScaffoldingTokens,
    turns: turnCount,
    note: OVERHEAD_NOTE,
    reread_saved_usd,
  };
}
