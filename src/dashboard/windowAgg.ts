/* ============================================================================
 * TOKEN TORCH — windowed aggregation (pure, React-free, unit-tested)
 * The redesign's window control filters the session pool client-side; hero /
 * podium / sessions / timeline / breakdown all re-derive from the windowed
 * subset. Ports the prototype's windowRange/winSessions/aggregate/projectAgg/
 * dailySeries onto the REAL SessionRow contract (same field names). All values
 * are derived from per-session fields that genuinely exist — never fabricated.
 * ========================================================================== */
import type { SessionRow } from "../types";

export type WindowMode = "all" | 7 | 14 | 30 | "custom";
export interface WindowState {
  mode: WindowMode;
  from: string | null; // ISO date (YYYY-MM-DD) for custom
  to: string | null;
}
export interface DateRange {
  from: string; // ISO date
  to: string; // ISO date
  all: boolean;
}

const DAY_MS = 864e5;
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayMs = (iso: string): number => Date.parse(iso + "T00:00:00Z");

/** Resolve the active window to a concrete [from,to] ISO-date range, clamped to
 *  the corpus bounds. `all` and `custom` pass through; presets count back N days
 *  from the corpus end (inclusive), matching the prototype. */
export function windowRange(state: WindowState, bounds: DateRange): DateRange {
  if (state.mode === "all") return { from: bounds.from, to: bounds.to, all: true };
  if (state.mode === "custom") {
    const from = state.from ?? bounds.from;
    const to = state.to ?? bounds.to;
    // normalize swapped picks
    return from <= to ? { from, to, all: false } : { from: to, to: from, all: false };
  }
  const to = bounds.to;
  const from = isoDay(dayMs(to) - (state.mode - 1) * DAY_MS);
  return { from: from < bounds.from ? bounds.from : from, to, all: false };
}

/** Sessions whose date falls within [range.from, range.to] inclusive. ISO dates
 *  sort lexicographically, so string compare is correct + TZ-safe. */
export function winSessions(sessions: SessionRow[], range: DateRange): SessionRow[] {
  return sessions.filter((s) => s.date >= range.from && s.date <= range.to);
}

export interface WinAgg {
  cost: number;
  main: number;
  sub: number;
  active: number;
  idle: number;
  subs: number;
  sessions: number;
  cacheAvg: number; // session-mean cache %
  out: number; // Σ out_tokens (only per-session token field available)
  saved: number; // Σ time_saved_min
  hi: number; // high-fidelity $
  ml: number; // main-loop-only $
  projectCount: number;
}

/** Re-derive headline aggregates over a session subset. Only sums fields that
 *  exist per-session: full token fresh/cache split is NOT per-session, so the
 *  Hero uses corpus `totals.tokens` for that split (labelled) and this `out`
 *  for a windowed output-token figure. */
export function aggregate(sessions: SessionRow[]): WinAgg {
  let cost = 0, main = 0, sub = 0, active = 0, idle = 0, subs = 0, cacheSum = 0, out = 0, saved = 0, hi = 0, ml = 0;
  const projects = new Set<string>();
  for (const s of sessions) {
    cost += s.cost_usd; main += s.cost_main; sub += s.cost_sub;
    active += s.active_min; idle += s.idle_min; subs += s.subagents;
    cacheSum += s.cache_pct; out += s.out_tokens ?? 0; saved += s.time_saved_min ?? 0;
    if (s.fidelity === "high") hi += s.cost_usd; else ml += s.cost_usd;
    projects.add(s.project);
  }
  const n = sessions.length;
  return { cost, main, sub, active, idle, subs, sessions: n, cacheAvg: n ? cacheSum / n : 0, out, saved, hi, ml, projectCount: projects.size };
}

export interface ProjectAggRow {
  name: string;
  cost: number;
  sessions: number;
  active: number;
  subsMax: number;
  cacheAvg: number;
  ml: boolean; // any main-loop-only session in the group
  share: number; // 0–1 of windowed total
  cps: number; // cost per session
}

/** Per-project rollup, sorted by cost desc — powers the podium. */
export function projectAgg(sessions: SessionRow[]): ProjectAggRow[] {
  const m = new Map<string, { name: string; cost: number; sessions: number; active: number; subsMax: number; cacheSum: number; ml: boolean }>();
  for (const s of sessions) {
    let p = m.get(s.project);
    if (!p) { p = { name: s.project, cost: 0, sessions: 0, active: 0, subsMax: 0, cacheSum: 0, ml: false }; m.set(s.project, p); }
    p.cost += s.cost_usd; p.sessions++; p.active += s.active_min;
    p.subsMax = Math.max(p.subsMax, s.subagents); p.cacheSum += s.cache_pct;
    if (s.fidelity === "main_loop") p.ml = true;
  }
  const arr = [...m.values()];
  const total = arr.reduce((t, p) => t + p.cost, 0);
  const rows: ProjectAggRow[] = arr.map((p) => ({
    name: p.name, cost: p.cost, sessions: p.sessions, active: p.active, subsMax: p.subsMax,
    cacheAvg: p.sessions ? p.cacheSum / p.sessions : 0, ml: p.ml,
    share: total ? p.cost / total : 0, cps: p.sessions ? p.cost / p.sessions : 0,
  }));
  rows.sort((a, b) => b.cost - a.cost);
  return rows;
}

export interface DailyPoint {
  date: string; // ISO date
  dow: number; // 0=Sun .. 6=Sat (UTC)
  cost: number;
  sessions: number;
  active: number;
}

/** One row per calendar day across the range (INCLUDING zero-session days, so
 *  the timeline shows real gaps — never interpolated). */
export function dailySeries(sessions: SessionRow[], range: DateRange): DailyPoint[] {
  const byDay = new Map<string, { cost: number; sessions: number; active: number }>();
  for (const s of sessions) {
    let d = byDay.get(s.date);
    if (!d) { d = { cost: 0, sessions: 0, active: 0 }; byDay.set(s.date, d); }
    d.cost += s.cost_usd; d.sessions++; d.active += s.active_min;
  }
  const out: DailyPoint[] = [];
  const start = dayMs(range.from), end = dayMs(range.to);
  for (let t = start; t <= end; t += DAY_MS) {
    const date = isoDay(t);
    const d = byDay.get(date);
    out.push({ date, dow: new Date(t).getUTCDay(), cost: d?.cost ?? 0, sessions: d?.sessions ?? 0, active: d?.active ?? 0 });
  }
  return out;
}

export interface BurnTierInfo {
  tier: "inferno" | "campfire" | "ember";
  name: string;
  flames: 1 | 2 | 3;
}
/** Fixed cost-threshold burn tiers (chat-locked: Inferno ≥$100, Campfire $50–100,
 *  Lil' Ember <$50). Distinct from the distribution-relative burn_bands used in
 *  GroupRollup — these label individual session cards per the prototype. */
export function tierOf(cost: number): BurnTierInfo {
  if (cost >= 100) return { tier: "inferno", name: "Inferno", flames: 3 };
  if (cost >= 50) return { tier: "campfire", name: "Campfire", flames: 2 };
  return { tier: "ember", name: "Lil' Ember", flames: 1 };
}

export const fmtMin = (m: number): string => {
  m = Math.round(m);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
