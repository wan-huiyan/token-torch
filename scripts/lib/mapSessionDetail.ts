/* ============================================================================
 * Schema A (+ optional Schema B) → SessionDetailData.
 * All costs recomputed from token counts at corrected rates (never trust a
 * record's stored $). by_category uses the COMBINED (main + subagent) token
 * universe so it sums to total_usd = main_loop_usd + subagent_usd by construction.
 * ========================================================================== */

import type { SessionDetailData, Shipped } from "../../src/types";
import {
  PRICING_BASIS,
  buildByCategoryPerModel,
  ratesForModel,
  cacheSavingsUsd,
  cacheWritePremiumUsd,
  blendedPerMtokUsd,
  totalTokens,
  round2,
} from "./pricing";
import type { JsonlFallbackResult, SubagentDispatch } from "./jsonl";
import type { SessionRecord } from "./ingest";
import { mergePerModelTokens, mergeTokenSets } from "./ingest";

type PerDispatch = { id: string; usd: number; what?: string; span_min?: number };

/** Scale per-dispatch costs so they sum EXACTLY to subagent_usd (largest-remainder
 *  cents), preserving each dispatch's label + duration. The JSONL flat-Opus
 *  per-agent costs already ≈ subUsd; this pins it. Sorted by cost desc. */
function scaledPerDispatch(timings: SubagentDispatch[], subUsd: number): PerDispatch[] {
  const rawSum = timings.reduce((s, t) => s + t.usd, 0);
  if (timings.length === 0 || subUsd <= 0) return [];
  const scale = rawSum > 0 ? subUsd / rawSum : 0;
  const out: PerDispatch[] = timings.map((t) => ({
    id: t.id,
    usd: round2(t.usd * scale),
    ...(t.description ? { what: t.description } : {}),
    ...(t.span_min != null ? { span_min: t.span_min } : {}),
  }));
  const residual = round2(subUsd - out.reduce((s, t) => s + t.usd, 0));
  if (residual !== 0 && out.length) {
    const largest = out.reduce((a, b) => (b.usd > a.usd ? b : a), out[0]);
    largest.usd = round2(largest.usd + residual);
  }
  return out.sort((a, b) => b.usd - a.usd);
}

/** Tools that are mostly "you answering" — excluded from the machine tool-time subtotal. */
export const INTERACTIVE_TOOLS = new Set(["AskUserQuestion"]);


/* ----------------------------------------------------------------------------
 * JSONL-PRIMARY path. SessionRecord (raw main transcript) + the subagent JSONL
 * fallback → SessionDetailData. Option B: by_category is built over the COMBINED
 * (main + subagent) per-model token universe, so it sums to total_usd, and
 * subagent_usd is the per-model price of just the subagent tokens (closing the
 * old flat-Opus over-count). Per-dispatch labels stay flat-Opus, scaled to subUsd.
 * Segments/latencies/turns are not in the raw log → ribbon/leaderboard/pulse
 * degrade gracefully (empty arrays). cctime/usage-tracking is a reconciliation
 * overlay only (overlayNote), never blended.
 * ------------------------------------------------------------------------- */
export function mapJsonlDetail(
  rec: SessionRecord,
  fb?: JsonlFallbackResult,
  shipped?: Shipped,
): SessionDetailData {
  const subPerModel = fb?.available ? fb.subagentPerModelTokens : {};
  const combinedPerModel = mergePerModelTokens(rec.perModelTokens, subPerModel);
  const { byCategory, totalUsd } = buildByCategoryPerModel(combinedPerModel); // sums to total_usd
  const subUsd = fb?.available ? buildByCategoryPerModel(subPerModel).totalUsd : 0;
  const mainUsd = round2(totalUsd - subUsd); // main + sub == total exactly (cents)
  const combinedTokens = mergeTokenSets(combinedPerModel);
  const hasByCategory = totalTokens(combinedTokens) > 0;
  const rates = ratesForModel(rec.dominantModel);

  const detail: SessionDetailData = {
    id: rec.id,
    date: rec.date,
    project: rec.project, // already normalized in buildSessionRecord
    cost_usd: totalUsd,
    model: rec.dominantModel,
    fidelity: fb?.available ? "high" : "main_loop",
    cache_pct: rec.cacheHitPct,
    time: {
      wall_clock_min: rec.wallClockMin,
      active_min: rec.activeMin,
      idle_min: rec.idleMin,
      wait_min: 0,
      // raw log doesn't separate thinking/tool/subagent/planning → zeros (active-split degrades).
      active_breakdown: { thinking_min: 0, tool_min: 0, subagent_min: 0, planning_min: 0 },
      method_note:
        "Derived from the raw transcript: consecutive-event gaps over 120s counted as you-away (idle), not compute. Per-phase breakdown / tool latency are not captured by the raw log (heuristic).",
    },
    timeline_segments: [], // not in the raw log → ribbon/pulse hidden
    tool_time: [], // counts exist (top_tools) but no latency → leaderboard hidden
    turns: [],
    tokens: {
      fresh_input: combinedTokens.fresh_input,
      output: combinedTokens.output,
      cache_write: combinedTokens.cache_write,
      cache_read: combinedTokens.cache_read,
      total: totalTokens(combinedTokens),
      cache_hit_pct: rec.cacheHitPct,
    },
    cost: {
      total_usd: totalUsd,
      main_loop_usd: mainUsd,
      subagent_usd: subUsd,
      ...(hasByCategory ? { by_category: byCategory } : {}),
      cache_savings_usd: cacheSavingsUsd(combinedTokens.cache_read, rates),
      cache_write_premium_usd: cacheWritePremiumUsd(combinedTokens.cache_write, rates),
      blended_per_mtok_usd: blendedPerMtokUsd(totalUsd, combinedTokens),
      pricing_basis: PRICING_BASIS,
      subagents_per_dispatch: fb?.available ? scaledPerDispatch(fb.subagentTimings, subUsd) : [],
    },
  };

  if (shipped) detail.shipped = shipped;
  return detail;
}
