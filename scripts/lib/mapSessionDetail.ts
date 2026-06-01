/* ============================================================================
 * Schema A (+ optional Schema B) → SessionDetailData.
 * All costs recomputed from token counts at corrected rates (never trust a
 * record's stored $). by_category uses the COMBINED (main + subagent) token
 * universe so it sums to total_usd = main_loop_usd + subagent_usd by construction.
 * ========================================================================== */

import type { SessionDetailData, Phase, TimelineSegment, ToolTime, Turn, Fidelity, Shipped } from "../../src/types";
import {
  OPUS_RATES,
  PRICING_BASIS,
  ZERO_TOKENS,
  addTokens,
  buildByCategory,
  buildByCategoryPerModel,
  ratesForModel,
  cacheSavingsUsd,
  cacheWritePremiumUsd,
  blendedPerMtokUsd,
  priceUsd,
  totalTokens,
  round2,
  type TokenSet,
} from "./pricing";
import type { SessionGroup, SchemaARecord, SchemaCTokenBlock } from "./corpus";
import { reconciliationNote } from "./corpus";
import { normalizeProject } from "./projects";
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

const MS_PER_MIN = 60_000;

const PHASE_MAP: Record<string, Phase> = {
  claudeThink: "thinking",
  thinking: "thinking",
  toolExec: "tool",
  tool: "tool",
  coding: "tool",
  humanWait: "wait",
  wait: "wait",
  humanAway: "idle",
  idle: "idle",
  subagent: "subagent",
  planning: "planning",
};

export function dominantModel(models: Record<string, number>): string {
  let best = "opus";
  let bestN = -1;
  for (const [m, n] of Object.entries(models ?? {})) {
    if (n > bestN) {
      bestN = n;
      best = m;
    }
  }
  return best.toLowerCase();
}

/** main-loop token universe from Schema A. */
function mainTokens(a: SchemaARecord): TokenSet {
  return {
    fresh_input: a.tokens.input,
    output: a.tokens.output,
    cache_write: a.tokens.cacheCreation,
    cache_read: a.tokens.cacheRead,
  };
}

/** subagent token universe from Schema A (zeros if none). */
function subagentTokens(a: SchemaARecord): TokenSet {
  const s = a.subagents;
  if (!s || s.count <= 0) return { ...ZERO_TOKENS };
  return {
    fresh_input: s.inputTokens,
    output: s.outputTokens,
    cache_write: s.cacheCreation,
    cache_read: s.cacheRead,
  };
}

export function determineFidelity(g: SessionGroup): Fidelity {
  // high when subagent spend was MEASURED (count>0) or a `_full` reconciliation
  // sibling exists; main_loop otherwise (we only have the main-loop view).
  const count = g.a?.subagents?.count ?? 0;
  if (count > 0 || g.b) return "high";
  return "main_loop";
}

function mergeSegments(a: SchemaARecord, start: number): TimelineSegment[] {
  const segs = a.enhancedSegments;
  if (!segs || !segs.length) return [];
  const out: TimelineSegment[] = [];
  for (const s of segs) {
    const phase = PHASE_MAP[s.phase];
    if (!phase) continue;
    const dur_min = s.durationMs / MS_PER_MIN;
    if (dur_min <= 0) continue;
    const last = out[out.length - 1];
    const tool = phase === "tool" && s.toolName ? s.toolName : undefined;
    if (last && last.phase === phase) {
      last.dur_min = round2(last.dur_min + dur_min);
      if (tool) (last.tools ??= {})[tool] = (last.tools[tool] ?? 0) + 1;
    } else {
      out.push({
        phase,
        start_min: round2((s.startTime - start) / MS_PER_MIN),
        dur_min: round2(dur_min),
        ...(tool ? { tools: { [tool]: 1 } } : {}),
      });
    }
  }
  return out;
}

function toolTime(a: SchemaARecord): ToolTime[] {
  const lat = a.toolLatencies;
  if (!lat || !lat.length) return [];
  return lat
    .map((t) => ({
      name: t.name,
      count: t.count,
      avg_s: round2(t.avgMs / 1000),
      p95_s: round2(t.p95Ms / 1000),
      total_min: round2(t.totalMs / MS_PER_MIN),
      interactive: INTERACTIVE_TOOLS.has(t.name),
    }))
    .sort((x, y) => y.total_min - x.total_min);
}

function turns(a: SchemaARecord): Turn[] {
  const tm = a.turnMetrics;
  if (!tm || !tm.length) return [];
  return tm
    .filter((t) => t.responseMs > 0)
    .map((t) => ({ i: t.turnIndex + 1, response_ms: t.responseMs }));
}

/** Subagent dispatch count, whichever schema the session has. */
export function subagentCount(g: SessionGroup): number {
  return g.a?.subagents?.count ?? g.c?.subagent_dispatches?.count ?? 0;
}

/** Tool call counts for the dashboard's top_tools, whichever schema is present. */
export function toolCounts(g: SessionGroup): Record<string, number> {
  return g.a?.tools ?? g.c?.tool_calls_main_loop ?? {};
}

/** Dominant model. Schema C has no models dict (main loop is Opus); default opus. */
export function modelOf(g: SessionGroup): string {
  if (g.a) return dominantModel(g.a.models);
  return "opus";
}

const cTokenSet = (b: SchemaCTokenBlock | undefined): TokenSet =>
  b
    ? { fresh_input: b.input_fresh, output: b.output, cache_write: b.cache_creation, cache_read: b.cache_read }
    : { ...ZERO_TOKENS };

/**
 * Schema C → SessionDetailData. Costs recomputed flat-Opus (consistent with
 * Schema A sessions). C's richer per-dispatch breakdown is kept, apportioned so
 * it sums to the flat-Opus subagent total. No segments/latencies/turns in C, so
 * ribbon/tool-leaderboard/pulse degrade gracefully.
 */
function mapSchemaCDetail(g: SessionGroup, fb?: JsonlFallbackResult, shipped?: Shipped): SessionDetailData {
  const c = g.c!;
  const main = cTokenSet(c.tokens.main_loop);
  const sub = cTokenSet(c.tokens.subagents_total);
  const combined = c.tokens.grand_total ? cTokenSet(c.tokens.grand_total) : addTokens(main, sub);

  const { byCategory, totalUsd } = buildByCategory(combined, OPUS_RATES);
  const mainUsd = round2(priceUsd(main, OPUS_RATES));
  const subUsd = round2(totalUsd - mainUsd);

  // per-dispatch: prefer the JSONL fallback (carries labels + durations); else
  // apportion C's own per-model distribution onto the flat-Opus subUsd.
  let subagents_per_dispatch: { id: string; usd: number; what?: string; span_min?: number }[];
  if (fb?.available) {
    subagents_per_dispatch = scaledPerDispatch(fb.subagentTimings, subUsd);
  } else {
    const rawDispatch = c.cost_estimate_usd?.subagents_per_dispatch ?? {};
    const rawSum = Object.values(rawDispatch).reduce((a, v) => a + v, 0);
    subagents_per_dispatch =
      rawSum > 0 && subUsd > 0
        ? Object.entries(rawDispatch).map(([id, usd]) => ({ id, usd: round2((usd / rawSum) * subUsd) }))
        : Object.entries(rawDispatch).map(([id, usd]) => ({ id, usd: round2(usd) }));
  }

  const wall_clock_min = round2((c.elapsed_wall_clock_hours ?? 0) * 60);
  const active_min = round2(c.claude_active_minutes ?? 0);
  const idle_min = round2(c.human_idle_minutes ?? 0);
  const cache_pct = round2(c.tokens.cache_hit_pct ?? 0);

  const detail: SessionDetailData = {
    id: g.id,
    date: g.date,
    project: normalizeProject(g.project),
    cost_usd: totalUsd,
    model: "opus",
    fidelity: "high", // per-model + per-dispatch recompute — fully attributed
    cache_pct,
    time: {
      wall_clock_min,
      active_min,
      idle_min,
      wait_min: 0,
      // active breakdown not captured by this schema → zeros (UI active-split degrades).
      active_breakdown: { thinking_min: 0, tool_min: 0, subagent_min: 0, planning_min: 0 },
      method_note: c.tokens.cache_hit_pct
        ? "main-jsonl pairwise event gaps; >120s classified as idle. Phase breakdown / per-tool latency not captured by this record."
        : "Phase breakdown not captured by this record.",
    },
    timeline_segments: [], // not in Schema C → ribbon/pulse hidden
    tool_time: [], // counts exist (top_tools) but no latency → leaderboard hidden
    turns: [],
    tokens: {
      fresh_input: combined.fresh_input,
      output: combined.output,
      cache_write: combined.cache_write,
      cache_read: combined.cache_read,
      total: totalTokens(combined),
      cache_hit_pct: cache_pct,
    },
    cost: {
      total_usd: totalUsd,
      main_loop_usd: mainUsd,
      subagent_usd: subUsd,
      by_category: byCategory,
      cache_savings_usd: cacheSavingsUsd(combined.cache_read, OPUS_RATES),
      cache_write_premium_usd: cacheWritePremiumUsd(combined.cache_write, OPUS_RATES),
      blended_per_mtok_usd: blendedPerMtokUsd(totalUsd, combined),
      pricing_basis: PRICING_BASIS,
      subagents_per_dispatch,
    },
  };

  // surface C's own per-model figure as a reconciliation note (don't blend it in).
  const perModel = c.cost_estimate_usd?.grand_total;
  if (perModel != null && Math.abs(perModel - totalUsd) >= 1) {
    (detail as SessionDetailData & { reconciliation_note?: string }).reconciliation_note =
      `This record also carries a per-model recompute ($${perModel.toFixed(2)}, each message at its own model's rate). Shown here recomputed flat-Opus ($${totalUsd.toFixed(2)}) so all sessions use one consistent method.`;
  }
  if (shipped) detail.shipped = shipped;
  return detail;
}

export function mapSessionDetail(
  g: SessionGroup,
  fb?: JsonlFallbackResult,
  shipped?: Shipped,
): SessionDetailData | null {
  if (!g.a) {
    if (g.c) return mapSchemaCDetail(g, fb, shipped);
    return null; // unparseable into the contract — caller flags this visibly.
  }
  const a = g.a;

  const main = mainTokens(a);
  const sub = subagentTokens(a);
  const combined = addTokens(main, sub);

  const { byCategory, totalUsd } = buildByCategory(combined, OPUS_RATES);
  const mainUsd = round2(priceUsd(main, OPUS_RATES));
  const subUsd = round2(totalUsd - mainUsd); // keep main + sub == total exactly

  const es = a.enhancedStats;
  const wall_clock_min = round2(a.durationMs / MS_PER_MIN);
  const thinking_min = round2((es?.claudeThink ?? 0) / MS_PER_MIN);
  const tool_min = round2((es?.toolExec ?? 0) / MS_PER_MIN);
  const subagent_min = round2((es?.subagent ?? 0) / MS_PER_MIN);
  const planning_min = round2((es?.planning ?? 0) / MS_PER_MIN);
  const active_min = round2(thinking_min + tool_min + subagent_min + planning_min);
  const idle_min = round2((es?.humanAway ?? a.stats?.idle ?? 0) / MS_PER_MIN);
  const wait_min = round2((es?.humanWait ?? 0) / MS_PER_MIN);

  const segments = mergeSegments(a, a.startTime);
  const hasByCategory = totalTokens(combined) > 0;

  const detail: SessionDetailData = {
    id: g.id,
    date: g.date,
    project: normalizeProject(g.project),
    cost_usd: totalUsd,
    model: dominantModel(a.models),
    fidelity: determineFidelity(g),
    cache_pct: round2((a.cacheHitRate ?? 0) * 100),
    time: {
      wall_clock_min,
      active_min,
      idle_min,
      wait_min,
      active_breakdown: { thinking_min, tool_min, subagent_min, planning_min },
      method_note:
        "Consecutive-event gaps over 120s are counted as you-away (idle), not compute. The threshold is heuristic.",
    },
    timeline_segments: segments,
    tool_time: toolTime(a),
    turns: turns(a),
    tokens: {
      fresh_input: combined.fresh_input,
      output: combined.output,
      cache_write: combined.cache_write,
      cache_read: combined.cache_read,
      total: totalTokens(combined),
      cache_hit_pct: round2((a.cacheHitRate ?? 0) * 100),
    },
    cost: {
      total_usd: totalUsd,
      main_loop_usd: mainUsd,
      subagent_usd: subUsd,
      ...(hasByCategory ? { by_category: byCategory } : {}),
      cache_savings_usd: cacheSavingsUsd(combined.cache_read, OPUS_RATES),
      cache_write_premium_usd: cacheWritePremiumUsd(combined.cache_write, OPUS_RATES),
      blended_per_mtok_usd: blendedPerMtokUsd(totalUsd, combined),
      pricing_basis: PRICING_BASIS,
      // per-dispatch from the JSONL fallback (foreground + workflow transcripts),
      // scaled to subUsd; empty if no transcripts found or no subagents.
      subagents_per_dispatch: fb?.available ? scaledPerDispatch(fb.subagentTimings, subUsd) : [],
    },
  };

  const note = reconciliationNote(g, totalUsd);
  if (note) (detail as SessionDetailData & { reconciliation_note?: string }).reconciliation_note = note;
  if (shipped) detail.shipped = shipped;

  return detail;
}

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
