/* ============================================================================
 * TOKEN TORCH — pure aggregation helpers (React-FREE; unit-tested via tsx).
 * Powers the aggregate-first dashboard: group-by toggle, searchable/paginated
 * table, calendar (week/month) rollups, model-label prettify. Imports ONLY
 * `import type` from ../types so the tsx test runs without a DOM/React.
 * No superlative/causal copy is produced here — callers render neutral labels.
 * ========================================================================== */
import type { SessionRow } from "../types";

export type GroupBy = "project" | "week" | "model" | "effort";

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

/** Per-grouping bucket key + label for one session. */
function bucketOf(s: SessionRow, by: GroupBy): { key: string; label: string } {
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
