import type { BillingWindow } from "../../src/types";
import { GAP_IDLE_MS } from "./ingest";
import { round2 } from "./pricing";

const HOUR_MS = 3_600_000;
const WINDOW_MS = 5 * HOUR_MS; // 18_000_000
const RECENT_N = 12;

/** A single timestamped log event tagged with its session + project. */
export interface WindowEvent { ms: number; sessionId: string; project: string; }

export interface BillingWindowsData {
  generated_at_ms: number;
  window_count: number;
  total_active_min: number;
  pace_vs_busiest_pct: number;
  current: BillingWindow;
  busiest: BillingWindow;
  recent: BillingWindow[];
  note: string;
}

/** Honest caveat copy (spec §2). Rendered verbatim in the panel + stored in dashboard.json. */
export const BILLING_WINDOWS_NOTE =
  "Estimate: 5-hour rolling windows reconstructed from THIS machine's Claude Code timestamps using " +
  "ccusage's rule (first event floored to the UTC hour; a new window after 5h elapsed or a 5h gap). Your " +
  "plan's limit is shared across claude.ai, Desktop and every device — so this is a LOWER BOUND, not a " +
  "quota reading, and shows activity, never % of a limit. Accurate as of the last generate; re-run to " +
  "refresh. (No window applies if you authenticate with an API key instead of a plan.)";

const floorToHour = (ms: number): number => Math.floor(ms / HOUR_MS) * HOUR_MS;

/** Flatten kept SessionRecords into a global event stream (session/project tagged). */
export function eventsFromRecords(
  records: { id: string; project: string; timestampsMs?: number[] }[],
): WindowEvent[] {
  const out: WindowEvent[] = [];
  for (const r of records) for (const ms of r.timestampsMs ?? []) out.push({ ms, sessionId: r.id, project: r.project });
  return out;
}

interface Acc {
  start_ms: number; end_ms: number; activeMs: number; eventCount: number;
  sessions: Set<string>; projects: Set<string>; lastMs: number;
}

/** Reconstruct Anthropic's 5-hour rolling windows from a global event stream (ccusage-faithful).
 *  Returns undefined for an empty stream (→ panel hidden). nowMs anchors is_active + the countdown. */
export function deriveBillingWindows(events: WindowEvent[], nowMs: number): BillingWindowsData | undefined {
  if (events.length === 0) return undefined;
  const sorted = [...events].sort((a, b) => a.ms - b.ms);

  const accs: Acc[] = [];
  let cur: Acc | null = null;
  for (const e of sorted) {
    if (cur === null || e.ms - cur.start_ms > WINDOW_MS || e.ms - cur.lastMs > WINDOW_MS) {
      const start = floorToHour(e.ms);
      cur = { start_ms: start, end_ms: start + WINDOW_MS, activeMs: 0, eventCount: 0, sessions: new Set(), projects: new Set(), lastMs: e.ms };
      accs.push(cur);
    } else {
      const gap = e.ms - cur.lastMs;
      if (gap <= GAP_IDLE_MS) cur.activeMs += gap; // active gaps (<120s) never straddle ⇒ Σ window == global total
    }
    cur.eventCount++;
    cur.sessions.add(e.sessionId);
    cur.projects.add(e.project);
    cur.lastMs = e.ms;
  }

  const windows: BillingWindow[] = accs.map((a) => ({
    start_ms: a.start_ms,
    end_ms: a.end_ms,
    active_min: round2(a.activeMs / 60_000),
    event_count: a.eventCount,
    session_count: a.sessions.size,
    project_count: a.projects.size,
    is_active: false,
  }));

  // events sorted asc ⇒ start_ms non-decreasing ⇒ last window is most recent
  const current = windows[windows.length - 1];
  const lastEventMs = accs[accs.length - 1].lastMs;
  current.is_active = nowMs - lastEventMs < WINDOW_MS && nowMs < current.end_ms;

  let busiest = windows[0];
  for (const w of windows) if (w.active_min >= busiest.active_min) busiest = w; // ties → most recent

  const total_active_min = round2(windows.reduce((s, w) => s + w.active_min, 0));
  const pace_vs_busiest_pct = busiest.active_min > 0 ? Math.round((current.active_min / busiest.active_min) * 100) : 0;
  const recent = windows.slice(-RECENT_N).reverse(); // most-recent first

  return { generated_at_ms: nowMs, window_count: windows.length, total_active_min, pace_vs_busiest_pct, current, busiest, recent, note: BILLING_WINDOWS_NOTE };
}
