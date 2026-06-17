/* ============================================================================
 * TOKEN TORCH — "Build Streak" what-shipped contribution calendar (#2).
 *
 * Pure derivation: buckets SessionRows by LOCAL calendar day, sums the REAL
 * shipped_count per day, and lays them out GitHub-style (week columns × weekday
 * rows) over the window's span. Also computes a playful, wellness-minded streak
 * + late-night / weekend "guilt" signals (the counts stay honest — these are
 * narrative overlays, never a discount on the real shipped total).
 *
 * Time basis: LOCAL (new Date(iso) → local hour/day), matching the Awards +
 * punchcard convention so "late night" / "weekend" read the same everywhere.
 * ========================================================================== */
import type { SessionRow } from "../types";

export interface CalCell {
  date: string;        // YYYY-MM-DD (local day)
  shipped: number;     // Σ shipped_count of that day's sessions (real; commit-heavy → can be 100s)
  mistakesCaught: number; // #72 — Σ confirmed review findings that day (HIGH-PRECISION FLOOR; 0 = unknown-or-none)
  sessions: number;    // # sessions that day (any)
  lateSessions: number; // # sessions that day started 21:00–05:59 local (NOT a boolean — at high
                        // session volume "any late session" is nearly always true; surface the
                        // count/share so the design can threshold the 🌙 nudge meaningfully)
  weekend: boolean;    // Sat/Sun (local)
  inRange: boolean;    // false = layout padding cell before/after the span (render blank)
}

export interface ShippedCalendar {
  weeks: CalCell[][];        // columns; each is a 7-cell Sun→Sat column
  maxShipped: number;        // for tier scaling (0 when nothing shipped)
  totalShipped: number;
  totalMistakesCaught: number; // #72 — Σ confirmed review findings in window (floor; see review_findings note)
  mistakeDays: number;       // #72 — # days with ≥1 confirmed review finding
  activeDays: number;        // days with shipped > 0
  bestDayDate: string | null;
  lateSessions: number;      // Σ sessions started late-night (wellness nudge)
  weekendDaysWorked: number; // # distinct weekend days with ≥1 session
  streak: number;            // current run of consecutive WEEKDAYS with shipped>0 (weekends skipped)
  hasData: boolean;          // any session at all in the window
}

const DAY_MS = 86_400_000;
const pad = (n: number) => (n < 10 ? "0" + n : "" + n);
/** Local YYYY-MM-DD key for a Date. */
const localKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Local midnight Date from a YYYY-MM-DD key. */
const fromKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
// late-night = start hour in [21, 24) ∪ [0, 6)
const isLateHour = (h: number) => h >= 21 || h < 6;

interface DayAgg {
  shipped: number;
  mistakesCaught: number;
  sessions: number;
  lateSessions: number;
}

/** Build the calendar from the windowed session rows. Pure. */
export function deriveShippedCalendar(rows: SessionRow[]): ShippedCalendar {
  const byDay = new Map<string, DayAgg>();
  for (const r of rows) {
    // prefer the real start timestamp (local), fall back to the row's ISO date.
    const d = r.start_ts ? new Date(r.start_ts) : r.date ? fromKey(r.date.slice(0, 10)) : null;
    if (!d || isNaN(d.getTime())) continue;
    const key = localKey(d);
    const agg = byDay.get(key) ?? { shipped: 0, mistakesCaught: 0, sessions: 0, lateSessions: 0 };
    agg.sessions += 1;
    agg.shipped += r.shipped_count ?? 0;
    agg.mistakesCaught += r.mistakes_caught ?? 0;
    if (r.start_ts && isLateHour(new Date(r.start_ts).getHours())) agg.lateSessions += 1;
    byDay.set(key, agg);
  }

  const empty: ShippedCalendar = {
    weeks: [], maxShipped: 0, totalShipped: 0, totalMistakesCaught: 0, mistakeDays: 0,
    activeDays: 0, bestDayDate: null,
    lateSessions: 0, weekendDaysWorked: 0, streak: 0, hasData: false,
  };
  if (byDay.size === 0) return empty;

  const keys = [...byDay.keys()].sort();
  const first = fromKey(keys[0]);
  const last = fromKey(keys[keys.length - 1]);

  // Pad the grid to whole weeks: back to the Sunday on/before `first`, forward to
  // the Saturday on/after `last`.
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // → Sunday
  const gridEnd = new Date(last);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay())); // → Saturday

  const weeks: CalCell[][] = [];
  let col: CalCell[] = [];
  let maxShipped = 0, totalShipped = 0, activeDays = 0, lateSessions = 0;
  let totalMistakesCaught = 0, mistakeDays = 0;
  let bestDayDate: string | null = null;
  const weekendDays = new Set<string>();

  for (let t = gridStart.getTime(); t <= gridEnd.getTime(); t += DAY_MS) {
    const d = new Date(t);
    const key = localKey(d);
    const inRange = key >= keys[0] && key <= keys[keys.length - 1];
    const agg = byDay.get(key);
    const shipped = agg?.shipped ?? 0;
    const mistakesCaught = agg?.mistakesCaught ?? 0;
    const sessions = agg?.sessions ?? 0;
    const wknd = isWeekend(d);
    col.push({ date: key, shipped, mistakesCaught, sessions, lateSessions: agg?.lateSessions ?? 0, weekend: wknd, inRange });
    if (agg) {
      totalShipped += shipped;
      if (shipped > 0) { activeDays += 1; if (shipped > maxShipped) { maxShipped = shipped; bestDayDate = key; } }
      totalMistakesCaught += mistakesCaught;
      if (mistakesCaught > 0) mistakeDays += 1;
      lateSessions += agg.lateSessions;
      if (wknd && sessions > 0) weekendDays.add(key);
    }
    if (col.length === 7) { weeks.push(col); col = []; }
  }
  if (col.length) weeks.push(col);

  // Streak: walk days DESCENDING from the latest dated day; weekends are skipped
  // (rest is the goal — they neither break nor extend); a WEEKDAY with shipped===0
  // breaks it; a weekday with shipped>0 extends it.
  let streak = 0;
  for (let t = last.getTime(); t >= first.getTime(); t -= DAY_MS) {
    const d = new Date(t);
    if (isWeekend(d)) continue; // exempt
    const shipped = byDay.get(localKey(d))?.shipped ?? 0;
    if (shipped > 0) streak += 1;
    else break;
  }

  return {
    weeks, maxShipped, totalShipped, totalMistakesCaught, mistakeDays, activeDays, bestDayDate,
    lateSessions, weekendDaysWorked: weekendDays.size, streak, hasData: true,
  };
}

/** Tier (0–4) for a cell → arcade ramp ▫ ✦ ★ 🔥 👑. RELATIVE to the window's
 *  max (GitHub-style), because real daily shipped counts are commit-heavy and span
 *  ~0–300: fixed thresholds would slam almost every active day to the top tier.
 *  0 = nothing shipped (honest empty); 1..4 scale by share of the busiest day. */
export function shippedTier(shipped: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (shipped <= 0) return 0;
  if (max <= 0) return 1;
  const r = shipped / max;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
}
