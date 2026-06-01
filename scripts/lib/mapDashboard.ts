/* ============================================================================
 * SessionGroup[] → { dashboard: DashboardData, details: SessionDetailData[] }.
 * Builds each session's detail first (canonical costs), then aggregates.
 * ========================================================================== */

import type { DashboardData, ProjectRow, SessionRow, TimelinePoint, SessionDetailData } from "../../src/types";
import type { SessionGroup } from "./corpus";
import { mapSessionDetail, subagentCount, toolCounts, modelOf } from "./mapSessionDetail";
import { normalizeProject } from "./projects";
import { buildFlags, buildInsightsMd } from "./insights";
import { round2 } from "./pricing";
import { buildSubagentIndex, extractFromJsonl, extractShipped, defaultProjectsDir } from "./jsonl";

const SMALL_N_THRESHOLD = 10;

function topTools(tools: Record<string, number>, n = 4): Record<string, number> {
  return Object.fromEntries(
    Object.entries(tools ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, n),
  );
}

export interface SubagentTimingCheck {
  id: string;
  unionMin: number;
  wallMin: number;
  savedMin: number;
}

export interface GenerateResult {
  dashboard: DashboardData;
  details: SessionDetailData[];
  /** session ids present in the corpus but not mappable into the contract. */
  dropped: string[];
  /** time-saved coverage + per-session union vs wall-clock (for --verify). */
  subagentTiming: {
    sessionsWithSubagents: string[];
    covered: string[]; // subset with transcripts found
    checks: SubagentTimingCheck[];
  };
}

export function mapDashboard(
  groups: SessionGroup[],
  generatedAtIso: string,
  projectsDir: string = defaultProjectsDir(),
): GenerateResult {
  const details: SessionDetailData[] = [];
  const rows: SessionRow[] = [];
  const dropped: string[] = []; // session ids with no parseable record
  let fileCount = 0;

  // index subagent transcripts once; per-session timing/cost fallback reads from it.
  const subagentIndex = buildSubagentIndex(projectsDir);
  let timeSavedMin = 0;
  const sessionsWithSubagents: string[] = [];
  const covered: string[] = [];
  const timingChecks: SubagentTimingCheck[] = [];

  for (const g of groups) {
    fileCount += g.fileCount;
    const fb = extractFromJsonl(g.id, subagentIndex);
    const shipped = extractShipped(g.id, subagentIndex, fb.subagentTimings);
    const detail = mapSessionDetail(g, fb, shipped);
    if (!detail) {
      // No Schema A or C record we can map. Track it so the drop is VISIBLE
      // (a dashboard flag below), never silent. JSONL fallback (stubbed) would
      // otherwise reconstruct these from the raw transcript.
      dropped.push(g.id);
      continue;
    }
    details.push(detail);

    // time-saved accounting + coverage tracking. "Has subagents" = corpus count
    // OR transcripts found (the corpus sometimes records 0 while transcripts exist),
    // so `covered` is always a subset.
    if (subagentCount(g) > 0 || fb.available) sessionsWithSubagents.push(g.id);
    if (fb.available) {
      covered.push(g.id);
      timeSavedMin += fb.timeSavedMin;
      timingChecks.push({
        id: g.id,
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
      subagents: subagentCount(g),
      model: modelOf(g),
      fidelity: detail.fidelity,
      ...((detail as SessionDetailData & { reconciliation_note?: string }).reconciliation_note
        ? { reconciliation_note: (detail as SessionDetailData & { reconciliation_note?: string }).reconciliation_note }
        : {}),
      top_tools: topTools(toolCounts(g)),
      detail_href: `/sessions/${detail.id}`,
    });
  }

  // newest-first
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

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
  const modelCounts: Record<string, number> = {};
  const toolsAgg: Record<string, number> = {};
  for (const g of groups) {
    if (!g.a && !g.c) continue; // dropped; not represented in distributions
    // model_mix is message-weighted from Schema A's `models`; Schema C carries no
    // models dict (its main loop is Opus), so count it as one Opus-weighted unit
    // by its tool-call volume — approximate, but keeps Opus from being undercounted.
    for (const [m, n] of Object.entries(g.a?.models ?? {})) modelCounts[m.toLowerCase()] = (modelCounts[m.toLowerCase()] ?? 0) + n;
    for (const [t, n] of Object.entries(toolCounts(g))) toolsAgg[t] = (toolsAgg[t] ?? 0) + n;
  }
  const modelTotal = Object.values(modelCounts).reduce((a, b) => a + b, 0) || 1;
  const model_mix: Record<string, number> = {};
  for (const [m, n] of Object.entries(modelCounts)) model_mix[m] = round2((n / modelTotal) * 100);

  const projectNames = new Set(rows.map((r) => normalizeProject(r.project)));
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  const small_n = rows.length < SMALL_N_THRESHOLD;
  const generatedDate = generatedAtIso.slice(0, 10);

  const totals: DashboardData["totals"] = {
    cost_usd,
    cost_by_fidelity: { high, main_loop },
    active_minutes,
    active_hours: round2(active_minutes / 60),
    idle_minutes,
    idle_hours: round2(idle_minutes / 60),
    sessions: rows.length,
    subagent_dispatches,
    cost_per_active_min: active_minutes ? round2(cost_usd / active_minutes) : 0,
    tokens: tokensTotals,
    avg_cache_hit_pct,
    // Measured from subagent transcripts (Σ spans − union). A lower bound when
    // coverage < 100% (see coverage flag) and slightly inflated by stall-retry
    // transcripts — an estimate either way.
    time_saved_min: round2(timeSavedMin),
    time_saved_hours: round2(timeSavedMin / 60),
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
  if (dropped.length) {
    // never silent: a corpus session we couldn't parse is surfaced, not hidden.
    flags.unshift({
      level: "warn",
      title: `${dropped.length} corpus session${dropped.length > 1 ? "s" : ""} could not be parsed`,
      detail: `Records present but in an unrecognized schema (ids: ${dropped.join(", ")}). They are excluded from totals — figures below understate true usage.`,
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
    insights_md: buildInsightsMd(generatedDate, totals, projects, small_n),
  };

  return {
    dashboard,
    details,
    dropped,
    subagentTiming: { sessionsWithSubagents, covered, checks: timingChecks },
  };
}
