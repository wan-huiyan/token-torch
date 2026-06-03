/* ============================================================================
 * TOKEN TORCH — pure aggregation helpers (React-FREE; unit-tested via tsx).
 * Powers the aggregate-first dashboard: group-by toggle, searchable/paginated
 * table, calendar (week/month) rollups, model-label prettify. Imports ONLY
 * `import type` from ../types so the tsx test runs without a DOM/React.
 * No superlative/causal copy is produced here — callers render neutral labels.
 * ========================================================================== */
import type { SessionRow } from "../types";
import { isRealModelId } from "../shared/models";

export type GroupBy = "project" | "week" | "model" | "effort";

/** Below this session count a group is "illustrative, not significant" (mirrors
 *  SMALL_N_THRESHOLD in mapDashboard) — the UI suppresses per-session rate framing. */
export const SMALL_N = 10;

/** A neutral aggregate over a set of sessions. NO ranking adjectives — the
 *  caller renders label · n · $ · cache% · tokens, never "best/efficient". */
export interface GroupRow {
  key: string;        // bucket id ("proj-a" | "2026-04-27" | "claude-opus-4-8" | "high" | "unknown")
  label: string;      // display label (prettified for model)
  sessions: number;
  cost_usd: number;
  avg_cache_pct: number;
  active_min: number;
  date_from: string;  // earliest session date in the bucket (ISO)
  date_to: string;    // latest session date in the bucket (ISO)
}

const UNKNOWN = "unknown";

/** UTC-stable Monday-anchored ISO week start (matches helpers.fmtDate's UTC). */
export function weekKey(isoDate: string): string {
  const d = new Date(isoDate);
  // getUTCDay: 0=Sun..6=Sat. Shift so Monday is the anchor.
  const dow = d.getUTCDay();
  const backToMon = (dow + 6) % 7; // Mon→0, Sun→6
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - backToMon));
  return monday.toISOString().slice(0, 10);
}

/** UTC YYYY-MM. */
export function monthKey(isoDate: string): string {
  return new Date(isoDate).toISOString().slice(0, 7);
}

/** Raw model id → display label: "claude-opus-4-8" → "Opus 4.8".
 *  Mirrors the prettyTool pattern in Distributions.tsx. Unknown shapes pass
 *  through title-cased on the family token. */
export function prettyModel(id: string): string {
  if (!id) return UNKNOWN;
  const m = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/i);
  if (m) {
    const family = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    return `${family} ${m[2]}.${m[3]}`;
  }
  return id;
}

export function effortLabel(value: string): string {
  return value || UNKNOWN;
}

/** Per-grouping bucket key + label for one session. Exported so breakdownGroups
 *  buckets identically to groupSessions (no duplicated switch). */
export function bucketOf(s: SessionRow, by: GroupBy): { key: string; label: string } {
  switch (by) {
    case "project":
      return { key: s.project || UNKNOWN, label: s.project || UNKNOWN };
    case "week": {
      const k = weekKey(s.date);
      return { key: k, label: k };
    }
    case "model": {
      const id = s.model_version;
      if (!id) return { key: UNKNOWN, label: UNKNOWN };
      return { key: id, label: prettyModel(id) };
    }
    case "effort": {
      const v = s.effort?.value;
      if (!v) return { key: UNKNOWN, label: UNKNOWN };
      return { key: v, label: effortLabel(v) };
    }
  }
}

/** Aggregate sessions into neutral GroupRows, sorted by cost desc. */
export function groupSessions(sessions: SessionRow[], by: GroupBy): GroupRow[] {
  const acc = new Map<string, { label: string; rows: SessionRow[] }>();
  for (const s of sessions) {
    const { key, label } = bucketOf(s, by);
    const e = acc.get(key) ?? { label, rows: [] };
    e.rows.push(s);
    acc.set(key, e);
  }
  const out: GroupRow[] = [];
  for (const [key, { label, rows }] of acc) {
    const sessionsN = rows.length;
    const cost = rows.reduce((t, r) => t + r.cost_usd, 0);
    const cache = rows.reduce((t, r) => t + r.cache_pct, 0) / (sessionsN || 1);
    const active = rows.reduce((t, r) => t + r.active_min, 0);
    const dates = rows.map((r) => r.date).sort();
    out.push({
      key,
      label,
      sessions: sessionsN,
      cost_usd: Math.round(cost * 100) / 100,
      avg_cache_pct: Math.round(cache * 10) / 10,
      active_min: Math.round(active),
      date_from: dates[0],
      date_to: dates[dates.length - 1],
    });
  }
  return out.sort((a, b) => b.cost_usd - a.cost_usd);
}

/** A richer per-group breakdown row. DESCRIBES the group (date-span, mix, axes);
 *  NEVER ranks. The caller renders neutral labels, no "best/efficient/faster". */
export interface BreakdownGroup extends GroupRow {
  top_projects: { name: string; sessions: number }[]; // up to 3, by session count desc
  effort_mix: Record<string, number>;                 // effort.source → session count
  out_tokens: number;                                  // Σ session output tokens
  out_tokens_per_session: number;
  tool_calls_per_session: number;                      // Σ top_tools counts / n
  time_saved_min: number;                              // Σ session time-saved
  small_n: boolean;                                    // n < SMALL_N → illustrative only
}

/** A session is "mixed-version" if its model_versions span >1 REAL Claude version.
 *  Such sessions are excluded from the model grouping (not dominant-bucketed) so
 *  neither version's bucket is contaminated (spec §8). */
export function isMixedVersion(s: SessionRow): boolean {
  const v = s.model_versions;
  if (!v) return false;
  return Object.keys(v).filter((id) => isRealModelId(id)).length > 1;
}

/** Aggregate sessions into richer BreakdownGroups (per-group context + ground-truth
 *  axes). For the model grouping, mixed-version sessions are EXCLUDED and counted
 *  (returned as `excludedMixed`) rather than dominant-bucketed. Reuses bucketOf +
 *  groupSessions so bucketing/sorting stay identical to the dashboard rollup. */
export function breakdownGroups(
  sessions: SessionRow[],
  by: GroupBy,
): { groups: BreakdownGroup[]; excludedMixed: number } {
  let excludedMixed = 0;
  const pool = sessions.filter((s) => {
    if (by === "model" && isMixedVersion(s)) {
      excludedMixed++;
      return false;
    }
    return true;
  });
  const base = groupSessions(pool, by); // GroupRow fields + cost-desc sort
  const byKey = new Map<string, SessionRow[]>();
  for (const s of pool) {
    const { key } = bucketOf(s, by);
    const arr = byKey.get(key);
    if (arr) arr.push(s);
    else byKey.set(key, [s]);
  }
  const groups: BreakdownGroup[] = base.map((g) => {
    const rows = byKey.get(g.key) ?? [];
    const projCount = new Map<string, number>();
    const effort_mix: Record<string, number> = {};
    let out = 0;
    let tools = 0;
    let saved = 0;
    for (const r of rows) {
      projCount.set(r.project, (projCount.get(r.project) ?? 0) + 1);
      const src = r.effort?.source ?? "unknown";
      effort_mix[src] = (effort_mix[src] ?? 0) + 1;
      out += r.out_tokens ?? 0;
      tools += Object.values(r.top_tools).reduce((s, n) => s + n, 0);
      saved += r.time_saved_min ?? 0;
    }
    const top_projects = [...projCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, sessions]) => ({ name, sessions }));
    const n = g.sessions || 1;
    return {
      ...g,
      top_projects,
      effort_mix,
      out_tokens: out,
      out_tokens_per_session: Math.round(out / n),
      tool_calls_per_session: Math.round((tools / n) * 10) / 10,
      time_saved_min: Math.round(saved),
      small_n: g.sessions < SMALL_N,
    };
  });
  return { groups, excludedMixed };
}

/** Case-insensitive substring filter over id + project + model fields. */
export function searchSessions(sessions: SessionRow[], q: string): SessionRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((s) =>
    [s.id, s.project, s.model, s.model_version ?? "", s.effort?.value ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}

/** Slice `items` to one page (1-indexed). Returns the page slice + total pages. */
export function paginate<T>(items: T[], page: number, perPage: number): { slice: T[]; pages: number; page: number } {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const clamped = Math.min(Math.max(1, page), pages);
  const start = (clamped - 1) * perPage;
  return { slice: items.slice(start, start + perPage), pages, page: clamped };
}
