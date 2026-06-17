/* ============================================================================
 * "What's driving your usage" — issue #75. A first-class panel mirroring Claude
 * Code's native /usage limits breakdown, derived from the SAME local JSONL corpus
 * the rest of the dashboard reads.
 *
 * HONESTY (non-negotiable, matches the native command's voice):
 *   • These are INDEPENDENT CHARACTERISTICS of your usage, NOT a breakdown that
 *     sums to 100%, and NOT a value judgment — a long/heavy session is not
 *     "wasteful". Each signal is paired with an action nudge, like /usage does.
 *   • Per-skill / per-plugin / per-MCP attribution is `unknown`: local JSONL does
 *     not attribute token spend to individual skills/MCPs (only the total catalog
 *     cost is knowable — see Catalog Savings #57). We surface it as unknown, never
 *     a fabricated split.
 *   • LOCAL-ONLY undercount: these cover only sessions logged on THIS machine, not
 *     other devices or the shared cross-device limit window — real usage is higher.
 *
 * Feasibility (probed on the real corpus before building): (a) ~25% of sessions
 * dispatch subagents; (b) ~73% of substantial sessions peak >150k context; (c) peak
 * concurrency 13, ~26% of active wall-clock at 4+ sessions under a strict 5-min gap
 * cap — all non-vacuous. (d) attribution is genuinely unknown.
 * ========================================================================== */
import { HEAVY_CONTEXT_THRESHOLD } from "./ingest";
import type { UsageDriver, UsageDiagnostics } from "../../src/types";

/** Active-gap cap for the parallel-sessions sweep: pauses longer than this split a
 *  session's wall-clock into separate active segments, so "4+ at once" measures real
 *  concurrent WORK, not idle-but-open overlap (the strict, honest definition). */
export const ACTIVE_GAP_CAP_MS = 5 * 60_000;
/** "Heavily parallel" threshold — 4+ concurrent sessions (the discriminating level; 2/3 are near-universal). */
export const PARALLEL_THRESHOLD = 4;

export { HEAVY_CONTEXT_THRESHOLD };

export interface UsageSession {
  timestampsMs: number[];      // ALL event timestamps (for the concurrency sweep)
  totalBilledTokens: number;   // main-loop billed = fresh_input + cache_write + cache_read + output
  heavyContextTokens: number;  // Σ billed tokens on turns with context > HEAVY_CONTEXT_THRESHOLD
  peakContextTokens: number;   // heaviest per-turn context
  subagentTokens: number;      // subagent throughput this session (0 if none)
  subagentCount: number;       // subagent dispatches this session
}

export type { UsageDriver, UsageDiagnostics };

export const USAGE_DIAGNOSTICS_NOTE =
  "Approximate — based only on the Claude Code sessions logged locally on this machine. " +
  "It doesn't include other devices or the shared cross-device limit window, so real usage " +
  "is higher. These are independent characteristics of your usage, not a breakdown that sums " +
  "to 100%, and not a judgment — a long or heavy session isn't wasteful.";

const pct1 = (n: number) => Math.round(n * 10) / 10;
/** abbreviate a token count: 2_650_000_000 → "2.7B", 1_240_000 → "1.2M", 340_000 → "340k". */
function abbrev(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${Math.round(n)}`;
}
const fmtPct = (n: number) => `${pct1(n)}%`;

interface Segment { s: number; e: number; sess: number }

/** Build gap-capped active segments for one session from its sorted timestamps. */
function activeSegments(timestampsMs: number[], sess: number): Segment[] {
  const ts = [...timestampsMs].sort((a, b) => a - b);
  if (ts.length < 2) return []; // a single (or no) event has no measurable duration
  const segs: Segment[] = [];
  let start = ts[0];
  let prev = ts[0];
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - prev > ACTIVE_GAP_CAP_MS) {
      if (prev > start) segs.push({ s: start, e: prev, sess });
      start = ts[i];
    }
    prev = ts[i];
  }
  if (prev > start) segs.push({ s: start, e: prev, sess });
  return segs;
}

/** Sweep-line over all sessions' active segments → peak concurrency, the share of
 *  active wall-clock at ≥ PARALLEL_THRESHOLD, and the distinct sessions that hit it. */
function concurrency(sessions: UsageSession[]): {
  peak: number;
  shareAtThreshold: number; // 0–100
  sessionsAtThreshold: number;
} {
  const segs: Segment[] = [];
  sessions.forEach((ss, idx) => segs.push(...activeSegments(ss.timestampsMs, idx)));
  if (!segs.length) return { peak: 0, shareAtThreshold: 0, sessionsAtThreshold: 0 };

  type Ev = { t: number; d: 1 | -1; sess: number };
  const evs: Ev[] = [];
  for (const sg of segs) {
    evs.push({ t: sg.s, d: 1, sess: sg.sess });
    evs.push({ t: sg.e, d: -1, sess: sg.sess });
  }
  // at a tie, process exits (-1) before entries (+1) so adjacent segments don't overlap.
  evs.sort((a, b) => a.t - b.t || a.d - b.d);

  let conc = 0;
  let peak = 0;
  let last = evs[0].t;
  let activeMs = 0;
  let geMs = 0;
  const live = new Set<number>();
  const atThreshold = new Set<number>();
  for (const ev of evs) {
    const dt = ev.t - last;
    if (dt > 0 && conc >= 1) {
      activeMs += dt;
      if (conc >= PARALLEL_THRESHOLD) {
        geMs += dt;
        for (const s of live) atThreshold.add(s);
      }
    }
    if (ev.d === 1) {
      conc++;
      live.add(ev.sess);
      if (conc > peak) peak = conc;
    } else {
      conc--;
      live.delete(ev.sess);
    }
    last = ev.t;
  }
  return {
    peak,
    shareAtThreshold: activeMs > 0 ? (geMs / activeMs) * 100 : 0,
    sessionsAtThreshold: atThreshold.size,
  };
}

/** Derive the usage-diagnostics characteristics. Pure. */
export function deriveUsageDiagnostics(sessions: UsageSession[]): UsageDiagnostics {
  const mainBilled = sessions.reduce((s, x) => s + x.totalBilledTokens, 0);
  const heavyTok = sessions.reduce((s, x) => s + x.heavyContextTokens, 0);
  const subTok = sessions.reduce((s, x) => s + x.subagentTokens, 0);
  const grandTotal = mainBilled + subTok;
  const heavySessions = sessions.filter((x) => x.peakContextTokens > HEAVY_CONTEXT_THRESHOLD).length;
  const subSessions = sessions.filter((x) => x.subagentCount > 0).length;
  const dispatches = sessions.reduce((s, x) => s + x.subagentCount, 0);
  const conc = concurrency(sessions);

  const subShare = grandTotal > 0 ? (subTok / grandTotal) * 100 : 0;
  const heavyShare = grandTotal > 0 ? (heavyTok / grandTotal) * 100 : 0;

  const drivers: UsageDriver[] = [
    {
      key: "subagents",
      label: "Subagent fan-out",
      share_pct: pct1(subShare),
      detail:
        `${fmtPct(subShare)} of your token throughput came from subagents — ${abbrev(subTok)} tokens across ` +
        `${dispatches} dispatch${dispatches === 1 ? "" : "es"} in ${subSessions} session${subSessions === 1 ? "" : "s"}.`,
      nudge:
        "Subagents run work in parallel (real wall-clock savings), but each re-pays the base-context floor. " +
        "Worth it for independent tasks; for a quick lookup, inline is cheaper.",
    },
    {
      key: "heavy_context",
      label: `Large contexts (>${abbrev(HEAVY_CONTEXT_THRESHOLD)})`,
      share_pct: pct1(heavyShare),
      detail:
        `${fmtPct(heavyShare)} of your token throughput happened while context was above ${abbrev(HEAVY_CONTEXT_THRESHOLD)} ` +
        `tokens; ${heavySessions} session${heavySessions === 1 ? "" : "s"} peaked that high. Large contexts are mostly ` +
        `cached (cheap), so this is a characteristic — not a problem.`,
      nudge:
        "No action needed if your sessions are genuinely long — but if one feels sluggish or pricey, /compact mid-task or /clear when switching tasks keeps context lean.",
    },
    {
      key: "parallel",
      label: `${PARALLEL_THRESHOLD}+ parallel sessions`,
      share_pct: pct1(conc.shareAtThreshold),
      detail:
        `${fmtPct(conc.shareAtThreshold)} of your active work time ran with ${PARALLEL_THRESHOLD}+ sessions going at once ` +
        `(peak ${conc.peak} concurrent; ${conc.sessionsAtThreshold} session${conc.sessionsAtThreshold === 1 ? "" : "s"} touched that). ` +
        `Active time is gap-capped at 5 min, so this counts concurrent WORK, not idle-but-open windows — a looser ` +
        `idle threshold would report a higher share, so read this as a conservative floor.`,
      nudge:
        "Parallel sessions multiply your usage rate against the shared 5-hour limit window. Stagger heavy runs if you're near a cap.",
    },
    {
      key: "attribution",
      label: "Per-skill / plugin / MCP",
      share_pct: null, // UNKNOWN — never fabricated
      detail:
        "Unknown. Local logs don't attribute token spend to individual skills, plugins, or MCP servers — only the total " +
        "catalog cost is knowable (see Catalog Savings). A per-source split can't be reconstructed honestly, so it's left unknown.",
      nudge:
        "Trim the always-injected skill/plugin catalog (the context-police pattern) to cut the fixed per-turn cost you CAN measure.",
    },
  ];

  return {
    drivers,
    peak_concurrency: conc.peak,
    parallel_threshold: PARALLEL_THRESHOLD,
    heavy_context_threshold: HEAVY_CONTEXT_THRESHOLD,
    note: USAGE_DIAGNOSTICS_NOTE,
  };
}
