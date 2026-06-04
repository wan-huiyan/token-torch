/* ============================================================================
 * SessionGroup[] → { dashboard: DashboardData, details: SessionDetailData[] }.
 * Builds each session's detail first (canonical costs), then aggregates.
 * ========================================================================== */

import type { DashboardData, ProjectRow, SessionRow, TimelinePoint, SessionDetailData, Shipped } from "../../src/types";
import type { SessionGroup } from "./corpus";
import { mapJsonlDetail } from "./mapSessionDetail";
import type { SessionRecord } from "./ingest";
import { normalizeProject } from "./projects";
import { buildFlags, buildInsightsMd } from "./insights";
import { round2 } from "./pricing";
import { deriveEffort, type SettingsFacts } from "./effort";
import { deriveModelVersion } from "./slice";
import { buildSubagentIndex, extractFromJsonl, extractShipped, defaultProjectsDir } from "./jsonl";
import { computeBurnBands } from "../../src/shared/burnTier";
import { loadPlanConfig } from "./plan";
import { deriveContextOverhead, OVERHEAD_NOTE } from "./contextOverhead";
import { deriveBillingWindows, eventsFromRecords } from "./billingWindows";
import { isRealModelId } from "../../src/shared/models";

const SMALL_N_THRESHOLD = 10;

function topTools(tools: Record<string, number>, n = 4): Record<string, number> {
  return Object.fromEntries(
    Object.entries(tools ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, n),
  );
}

/** Short "what shipped" card summary from a real Shipped object (counts only —
 *  never a fabricated number). Returns undefined when nothing concrete shipped
 *  (the caller omits the field — honest). */
function shippedShort(s: Shipped): string | undefined {
  const prCount = s.prs?.length ?? 0;
  // reviews: top-level (unlinked) + nested under PRs.
  const nestedReviews = (s.prs ?? []).reduce((n, pr) => n + (pr.reviews?.length ?? 0), 0);
  const reviewCount = (s.reviews?.length ?? 0) + nestedReviews;
  const directCommits = s.commits?.length ?? 0;
  const parts: string[] = [];
  if (prCount) parts.push(`${prCount} PR${prCount === 1 ? "" : "s"}`);
  if (reviewCount) parts.push(`${reviewCount} review${reviewCount === 1 ? "" : "s"}`);
  if (!prCount && directCommits) parts.push("direct commits");
  if (parts.length) return parts.join(" · ");
  // PRs/reviews/commits all absent → fall back to skills/adrs if present, else omit.
  const skillCount = s.skills?.length ?? 0;
  const adrCount = s.adrs?.length ?? 0;
  if (skillCount) return `${skillCount} skill${skillCount === 1 ? "" : "s"}`;
  if (adrCount) return `${adrCount} ADR${adrCount === 1 ? "" : "s"}`;
  return undefined;
}

/** A cctime/usage-tracking record's own stored $ estimate, whichever schema it has.
 *  These figures use a DIFFERENT extraction method (and may be stale per the
 *  pricing lesson) — surfaced as a reconciliation note, never blended in. */
function overlayEstimateUsd(g: SessionGroup): number | undefined {
  return (
    g.c?.cost_estimate_usd?.grand_total ??
    g.a?.estimatedCostUsd ??
    g.b?.grand_total?.cost_usd ??
    undefined
  );
}

/** Note when the overlay's stored estimate diverges >5% from the recomputed figure.
 *  Never blends — states the two use different methods. Undefined when close/absent. */
function overlayReconciliationNote(g: SessionGroup, recomputedUsd: number): string | undefined {
  const est = overlayEstimateUsd(g);
  if (est == null || est <= 0) return undefined;
  if (Math.abs(est - recomputedUsd) <= 0.05 * recomputedUsd) return undefined;
  return (
    `A hand-built usage record for this session estimated $${est.toFixed(2)} (cctime/usage-tracking); ` +
    `the shown figure ($${recomputedUsd.toFixed(2)}) is recomputed from the raw transcript at per-model rates. ` +
    `The two use different extraction methods and are not blended.`
  );
}

export interface SubagentTimingCheck {
  id: string;
  unionMin: number;
  wallMin: number;
  savedMin: number;
}

/** Substance-floor accounting threaded from ingestSessions → surfaced as a
 *  coverage flag + meta.floor (the floor runs upstream; without this the
 *  exclusion would be silent — the honesty-spine invariant, ADR 0001/0002). */
export interface FloorStats {
  discovered: number;
  kept: number;
  droppedFloor: number;
  droppedWithUsage: number;
  droppedWithUsageUsd: number;
}

export interface GenerateResult {
  dashboard: DashboardData;
  details: SessionDetailData[];
  /** time-saved coverage + per-session union vs wall-clock (for --verify). */
  subagentTiming: {
    sessionsWithSubagents: string[];
    covered: string[]; // subset with transcripts found
    checks: SubagentTimingCheck[];
  };
}

export function mapDashboard(
  records: SessionRecord[],
  overlay: Map<string, SessionGroup>,
  generatedAtIso: string,
  floor: FloorStats,
  projectsDir: string = defaultProjectsDir(),
  settings: SettingsFacts = { settingsEffort: null, settingsMtimeMs: null },
  /** Pre-computed, already-validated LLM insights markdown. When provided (non-null),
   *  it replaces the template insights and marks the source "llm". Computed async in
   *  generate.ts so this function stays sync + pure. Absent/null => template path. */
  llmInsightsMd: string | null = null,
): GenerateResult {
  const details: SessionDetailData[] = [];
  const rows: SessionRow[] = [];
  let fileCount = 0;

  // index subagent transcripts once; per-session timing/cost fallback reads from it.
  const subagentIndex = buildSubagentIndex(projectsDir);
  let timeSavedMin = 0;
  const sessionsWithSubagents: string[] = [];
  const covered: string[] = [];
  const timingChecks: SubagentTimingCheck[] = [];
  // context-overhead aggregate (Plan 8 / issue #10). Kept on the MAIN-LOOP input basis
  // so per-session and aggregate use the same denominator (the floor is a main-loop
  // quantity; subagent scaffolding is surfaced separately). reread_tokens summed from
  // the per-session overheads → the verify() aggregate identity holds (no silent drop).
  let ovRereadTok = 0;
  let ovRereadUsd = 0;
  let ovSubScaffoldTok = 0;
  let ovTurns = 0;
  let ovMainInputSide = 0;
  let ovRereadSavedUsd = 0;

  for (const rec of records) {
    fileCount += rec.rawProjectDirs.length; // transcripts merged for this session
    const fb = extractFromJsonl(rec.id, subagentIndex);
    const shipped = extractShipped(rec.id, subagentIndex, fb.subagentTimings);
    const ov = overlay.get(rec.id);
    // build detail first to get the recomputed total, then derive the overlay note.
    const detail = mapJsonlDetail(rec, fb, shipped);
    const note = ov ? overlayReconciliationNote(ov, detail.cost.total_usd) : undefined;
    if (note) detail.reconciliation_note = note;

    // ---- slice dimensions (Plan 3): compute ONCE, assign to BOTH detail + row ----
    // (keeping them in lockstep is the L9 trap — a divergent copy passes tests but
    //  silently disagrees between the table and the drill-down).
    const { model_version, model_versions } = deriveModelVersion(rec.modelMsgCounts);
    const effort = deriveEffort({ observedEffort: rec.observedEffort, startedAtMs: rec.startedAtMs }, settings);
    const data_tier: "enriched" | "jsonl" = overlay.has(rec.id) ? "enriched" : "jsonl";
    if (model_version) detail.model_version = model_version;
    detail.effort = effort;
    detail.data_tier = data_tier;

    // ---- context overhead (Plan 8 / issue #10): keep detail + row in LOCKSTEP (L9). ----
    const context_overhead = deriveContextOverhead({
      scaffoldingFloor: rec.scaffoldingFloor,
      turnCount: rec.turnCount,
      perModelTokens: rec.perModelTokens,
      subagentScaffoldingTokens: fb.subagentScaffoldingTokens,
    });
    detail.context_overhead = context_overhead;
    ovRereadTok += context_overhead.reread_tokens;
    ovRereadUsd += context_overhead.reread_usd;
    ovSubScaffoldTok += context_overhead.subagent_scaffolding_tokens;
    ovTurns += context_overhead.turns;
    ovRereadSavedUsd += context_overhead.reread_saved_usd ?? 0;
    for (const t of Object.values(rec.perModelTokens))
      ovMainInputSide += t.fresh_input + t.cache_write + t.cache_read;

    details.push(detail);

    // time-saved accounting + coverage tracking. "Has subagents" = transcripts found.
    if (fb.available) {
      sessionsWithSubagents.push(rec.id);
      covered.push(rec.id);
      timeSavedMin += fb.timeSavedMin;
      timingChecks.push({
        id: rec.id,
        unionMin: fb.unionMin,
        wallMin: detail.time.wall_clock_min,
        savedMin: fb.timeSavedMin,
      });
    }

    rows.push({
      id: detail.id,
      date: detail.date,
      project: detail.project,
      cost_usd: detail.cost.total_usd,
      cost_main: detail.cost.main_loop_usd,
      cost_sub: detail.cost.subagent_usd,
      active_min: detail.time.active_min,
      idle_min: detail.time.idle_min,
      cache_pct: detail.cache_pct,
      subagents: fb.subagentTimings.length,
      model: rec.dominantModel,
      fidelity: detail.fidelity,
      ...(note ? { reconciliation_note: note } : {}),
      ...(model_version ? { model_version } : {}),
      model_versions,
      effort,
      data_tier,
      context_overhead,
      out_tokens: detail.tokens.output,
      time_saved_min: fb.available ? fb.timeSavedMin : 0,
      // n=25 covers ~all tools per session for the dashboard tool balloons (was n=4).
      top_tools: topTools(rec.toolCounts, 25),
      detail_href: `/sessions/${detail.id}`,
      // S11 additive card fields (all omitted when absent → honest degrade).
      ...(rec.startedAtMs != null ? { start_ts: new Date(rec.startedAtMs).toISOString() } : {}),
      ...(rec.headline ? { headline: rec.headline } : {}),
      ...(shipped ? (() => { const ss = shippedShort(shipped); return ss ? { shipped_short: ss } : {}; })() : {}),
      active_breakdown: detail.time.active_breakdown,
    });
  }

  // newest-first
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // distribution-relative burn-tier bands from the kept-session cost spread
  // (one ~$361 outlier otherwise collapses every session to the bottom tier).
  const burnBands = computeBurnBands(rows.map((r) => r.cost_usd));
  // second pass: every emitted session-detail page gets the GLOBAL cutoffs so a
  // single-session view still tiers relative to the whole corpus.
  for (const d of details) d.burn_bands = burnBands;

  // ---- totals ----
  const cost_usd = round2(rows.reduce((s, r) => s + r.cost_usd, 0));
  const high = round2(rows.filter((r) => r.fidelity === "high").reduce((s, r) => s + r.cost_usd, 0));
  const main_loop = round2(cost_usd - high);
  const active_minutes = round2(rows.reduce((s, r) => s + r.active_min, 0));
  const idle_minutes = round2(rows.reduce((s, r) => s + r.idle_min, 0));
  const subagent_dispatches = rows.reduce((s, r) => s + r.subagents, 0);
  const tokensTotals = details.reduce(
    (acc, d) => ({
      input_fresh: acc.input_fresh + d.tokens.fresh_input,
      cache_read: acc.cache_read + d.tokens.cache_read,
      output: acc.output + d.tokens.output,
    }),
    { input_fresh: 0, cache_read: 0, output: 0 },
  );
  const avg_cache_hit_pct = rows.length
    ? round2(rows.reduce((s, r) => s + r.cache_pct, 0) / rows.length)
    : 0;

  // ---- projects (sorted by cost desc → powers podium) ----
  const projMap = new Map<string, { cost: number; sessions: number; active: number }>();
  for (const r of rows) {
    const key = r.project;
    const p = projMap.get(key) ?? { cost: 0, sessions: 0, active: 0 };
    p.cost += r.cost_usd;
    p.sessions += 1;
    p.active += r.active_min;
    projMap.set(key, p);
  }
  const projects: ProjectRow[] = [...projMap.entries()]
    .map(([name, p]) => ({
      name,
      cost_usd: round2(p.cost),
      sessions: p.sessions,
      active_min: round2(p.active),
      cost_share: cost_usd ? round2(p.cost / cost_usd) : 0,
      cost_per_session: round2(p.cost / p.sessions),
    }))
    .sort((a, b) => b.cost_usd - a.cost_usd);

  // ---- timeline (by date) ----
  const tlMap = new Map<string, { cost: number; sessions: number; active: number }>();
  for (const r of rows) {
    const t = tlMap.get(r.date) ?? { cost: 0, sessions: 0, active: 0 };
    t.cost += r.cost_usd;
    t.sessions += 1;
    t.active += r.active_min;
    tlMap.set(r.date, t);
  }
  const timeline: TimelinePoint[] = [...tlMap.entries()]
    .map(([date, t]) => ({ date, cost_usd: round2(t.cost), sessions: t.sessions, active_min: round2(t.active) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // ---- distributions ----
  // model_mix is message-weighted from each record's per-model assistant-message
  // counts (raw lowercased model ids, e.g. "claude-opus-4-8"); tools_aggregate is
  // the summed main-loop tool-call counts.
  const modelCounts: Record<string, number> = {};
  const toolsAgg: Record<string, number> = {};
  for (const rec of records) {
    for (const [m, n] of Object.entries(rec.modelMsgCounts)) {
      const id = m.toLowerCase();
      if (!isRealModelId(id)) continue; // drop <synthetic>/unknown before the mix; denominator below renormalizes (Plan 5, closes #4 leak)
      modelCounts[id] = (modelCounts[id] ?? 0) + n;
    }
    for (const [t, n] of Object.entries(rec.toolCounts)) toolsAgg[t] = (toolsAgg[t] ?? 0) + n;
  }
  const modelTotal = Object.values(modelCounts).reduce((a, b) => a + b, 0) || 1;
  const model_mix: Record<string, number> = {};
  for (const [m, n] of Object.entries(modelCounts)) model_mix[m] = round2((n / modelTotal) * 100);

  const projectNames = new Set(rows.map((r) => normalizeProject(r.project)));
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  const small_n = rows.length < SMALL_N_THRESHOLD;
  const generatedDate = generatedAtIso.slice(0, 10);

  // aggregate context overhead (Plan 8 / issue #10): reread_tokens/$ summed from the
  // per-session overheads (so the verify() aggregate identity holds); % over the summed
  // MAIN-LOOP input side (same basis as each session). scaffolding_tokens is not
  // additive across sessions, so the aggregate leaves it 0 — reread_tokens is the headline.
  const context_overhead = {
    scaffolding_tokens: 0,
    reread_tokens: ovRereadTok,
    reread_usd: round2(ovRereadUsd),
    overhead_pct_of_input: ovMainInputSide > 0 ? round2((ovRereadTok / ovMainInputSide) * 100) : 0,
    subagent_scaffolding_tokens: ovSubScaffoldTok,
    turns: ovTurns,
    note: OVERHEAD_NOTE,
    reread_saved_usd: round2(ovRereadSavedUsd), // Σ per-session (mirrors reread_usd)
  };

  const totals: DashboardData["totals"] = {
    cost_usd,
    // Headline total is COMPLETE: displayed (kept) cost + the floored usage-bearing $.
    // cost_usd stays the displayed-only figure every breakdown invariant keys off.
    floored_usd: floor.droppedWithUsageUsd,
    complete_spend_usd: round2(cost_usd + floor.droppedWithUsageUsd),
    cost_by_fidelity: { high, main_loop },
    active_minutes,
    active_hours: round2(active_minutes / 60),
    idle_minutes,
    idle_hours: round2(idle_minutes / 60),
    sessions: rows.length,
    subagent_dispatches,
    cost_per_active_min: active_minutes ? round2(cost_usd / active_minutes) : 0,
    // total = Σ corpus tokens (input_fresh + cache_read + output) — the mockup reads it.
    tokens: { ...tokensTotals, total: tokensTotals.input_fresh + tokensTotals.cache_read + tokensTotals.output },
    avg_cache_hit_pct,
    // Measured from subagent transcripts (Σ spans − union). A lower bound when
    // coverage < 100% (see coverage flag) and slightly inflated by stall-retry
    // transcripts — an estimate either way.
    time_saved_min: round2(timeSavedMin),
    time_saved_hours: round2(timeSavedMin / 60),
    context_overhead,
  };

  const flags = buildFlags(totals, projects, rows);
  // coverage: a subagent session whose transcripts we couldn't find contributes
  // 0 to time_saved — surface that so the headline isn't read as complete.
  const uncovered = sessionsWithSubagents.filter((id) => !covered.includes(id));
  if (uncovered.length) {
    flags.push({
      level: "warn",
      title: "Time-saved is a lower bound",
      detail: `${uncovered.length} of ${sessionsWithSubagents.length} subagent session(s) had no findable transcripts (ids: ${uncovered.join(", ")}) — their parallel time-saved isn't counted. Shown figure is a floor.`,
      metric: "coverage",
    });
  }
  // never silent: the substance floor runs upstream in ingestSessions, so dropped
  // sessions don't reach this map — surface them here from the threaded floor stats
  // (the headline total excludes them). ADR 0001/0002 honesty-spine invariant.
  if (floor.droppedFloor > 0) {
    // headline total spend = shown (kept) total + the floored-but-usage-bearing $;
    // no-usage drops contribute $0, so complete_spend_usd is the full denominator.
    const completeSpend = round2(cost_usd + floor.droppedWithUsageUsd);
    const pct = completeSpend > 0 ? round2((floor.droppedWithUsageUsd / completeSpend) * 100) : 0;
    flags.unshift({
      level: "warn",
      title: `Total spend includes ${floor.droppedWithUsage} short sessions shown only in aggregate`,
      detail:
        `Total spend includes ~$${floor.droppedWithUsageUsd.toFixed(2)} (${pct}%) from ${floor.droppedWithUsage} short sessions ` +
        `(fewer than 10 assistant messages) shown only in aggregate; the ${floor.kept} substantial sessions are listed individually. ` +
        `(${floor.droppedFloor} of ${floor.discovered} discovered sessions fall below the substance floor; the rest carried no usage.)`,
      metric: "coverage",
    });
  }
  const mainLoopCount = rows.filter((r) => r.fidelity === "main_loop").length;

  const dashboard: DashboardData = {
    meta: {
      generated_at: generatedAtIso,
      schema_version: "tracker-1.0",
      session_count: rows.length,
      file_count: fileCount,
      project_count: projectNames.size,
      date_range: { from: dates[0] ?? generatedDate, to: dates[dates.length - 1] ?? generatedDate },
      small_n,
      fidelity_note: mainLoopCount
        ? `${mainLoopCount} of ${rows.length} sessions is main-loop-only (subagent spend not counted).`
        : "All sessions are high-fidelity (subagent spend counted).",
      burn_bands: burnBands,
      floor: {
        discovered: floor.discovered,
        kept: floor.kept,
        dropped: floor.droppedFloor,
        dropped_with_usage: floor.droppedWithUsage,
        dropped_with_usage_usd: floor.droppedWithUsageUsd,
      },
    },
    totals,
    projects,
    timeline,
    sessions: rows,
    distributions: {
      model_mix,
      tools_aggregate: toolsAgg,
      time_split: { active_min: active_minutes, idle_min: idle_minutes },
    },
    flags,
    insights_md: llmInsightsMd ?? buildInsightsMd(generatedDate, totals, projects, small_n),
    insights_source: llmInsightsMd ? "llm" : "template",
    plan: loadPlanConfig(rows),
    billing_windows: deriveBillingWindows(eventsFromRecords(records), Date.parse(generatedAtIso)),
  };

  return {
    dashboard,
    details,
    subagentTiming: { sessionsWithSubagents, covered, checks: timingChecks },
  };
}
