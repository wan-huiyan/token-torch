import type { SessionDetailData } from "../types";

/**
 * Degradation-path fixture. Exercises the two graceful-degrade branches the
 * README requires ("design both states"):
 *   - `timeline_segments: []`  → hide ribbon / tool-leaderboard / pulse; keep the
 *     active/idle headline (+ active split if present).
 *   - `cost.by_category` absent → hide the inversion + waterfall; show the total
 *     plus a "per-category breakdown not captured" note.
 * Also has no subagents (main/sub donut hidden) and no `shipped` section.
 */
export const sessionDegraded: SessionDetailData = {
  id: "deadbeef",
  date: "2026-05-27",
  project: "early-record-no-enhanced-stats",
  cost_usd: 18.4,
  model: "opus",
  fidelity: "main_loop",
  cache_pct: 95.1,
  time: {
    wall_clock_min: 64.0,
    active_min: 22.5,
    idle_min: 40.0,
    wait_min: 1.5,
    active_breakdown: { thinking_min: 0, tool_min: 0, subagent_min: 0, planning_min: 0 },
    method_note:
      "This record predates the enhanced segmenter — only the coarse active/idle split is available.",
  },
  timeline_segments: [],
  tool_time: [],
  turns: [],
  tokens: {
    fresh_input: 90000,
    output: 60000,
    cache_write: 400000,
    cache_read: 9000000,
    total: 9550000,
    cache_hit_pct: 95.1,
  },
  cost: {
    total_usd: 18.4,
    main_loop_usd: 18.4,
    subagent_usd: 0,
    // by_category intentionally absent → degradation path
    cache_savings_usd: 0,
    cache_write_premium_usd: 0,
    blended_per_mtok_usd: 1.93,
    pricing_basis:
      "Opus 4.5+ estimate: fresh input $5/M · output $25/M · cache-write $6.25/M · cache-read $0.50/M. Per-category breakdown not captured for this record. Anthropic billing dashboard is authoritative.",
    subagents_per_dispatch: [],
  },
};
