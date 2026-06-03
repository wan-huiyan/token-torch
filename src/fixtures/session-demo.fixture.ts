import type { SessionDetailData } from "../types";

/**
 * Canonical session-detail fixture — ILLUSTRATIVE SAMPLE DATA, not real usage.
 * The id (`demo0004`) matches the linked row in the dashboard fixture so the
 * demo is navigable before `pnpm generate` is run. Exercises the honesty/
 * degradation paths: main-loop fidelity, no subagents (amber badge, "no
 * subagents this run"), interactive AskUserQuestion excluded from machine
 * tool-time.
 *
 * Cost values use the prototype's *old* Opus rates ($15/$75/$18.75/$1.50). The
 * cost-formula identities hold against these values (the generator reproduces
 * them with corrected rates):
 *   by_category[c].usd       = tokens/1e6 × rate_per_mtok   (sums to total_usd)
 *   cache_savings_usd        = cache_read × (fresh − read)/1e6   = $785.39
 *   cache_write_premium_usd  = cache_write × (write − fresh)/1e6 = $5.52
 *   blended_per_mtok_usd     = total_usd / (total_tokens/1e6)    = $2.18
 */
export const sessionDemo: SessionDetailData = {
  id: "demo0004",
  date: "2026-05-29",
  project: "demo-project-gamma",
  cost_usd: 130.91,
  model: "opus",
  fidelity: "main_loop",
  cache_pct: 97.3,
  time: {
    wall_clock_min: 169.4,
    active_min: 77.8,
    idle_min: 84.0,
    wait_min: 7.6,
    active_breakdown: { thinking_min: 47.1, tool_min: 30.7, subagent_min: 0.0, planning_min: 0.0 },
    method_note:
      "Consecutive-event gaps over 120s are counted as you-away (idle), not compute. The threshold is heuristic.",
  },
  timeline_segments: [
    { phase: "thinking", start_min: 0.0, dur_min: 2.1 },
    { phase: "tool", start_min: 2.1, dur_min: 0.4 },
    { phase: "idle", start_min: 2.5, dur_min: 42.0 },
    { phase: "thinking", start_min: 44.5, dur_min: 6.3 },
    { phase: "tool", start_min: 50.8, dur_min: 25.4 },
    { phase: "idle", start_min: 76.2, dur_min: 42.0 },
    { phase: "thinking", start_min: 118.2, dur_min: 38.7 },
    { phase: "wait", start_min: 156.9, dur_min: 7.6 },
    { phase: "tool", start_min: 164.5, dur_min: 4.9 },
  ],
  tool_time: [
    { name: "AskUserQuestion", count: 3, avg_s: 507.1, p95_s: 1257.1, total_min: 25.4, interactive: true },
    { name: "Bash", count: 115, avg_s: 2.73, p95_s: 7.3, total_min: 5.2, interactive: false },
    { name: "Edit", count: 30, avg_s: 0.18, p95_s: 0.25, total_min: 0.1, interactive: false },
    { name: "Write", count: 5, avg_s: 0.19, p95_s: 0.23, total_min: 0.02, interactive: false },
    { name: "Read", count: 23, avg_s: 0.03, p95_s: 0.04, total_min: 0.01, interactive: false },
  ],
  turns: [
    { i: 1, response_ms: 3906 },
    { i: 2, response_ms: 21050 },
    { i: 3, response_ms: 8400 },
    { i: 4, response_ms: 45200 },
    { i: 5, response_ms: 12300 },
    { i: 6, response_ms: 6100 },
  ],
  tokens: {
    fresh_input: 156313,
    output: 182381,
    cache_write: 1473313,
    cache_read: 58177354,
    total: 59989361,
    cache_hit_pct: 97.3,
  },
  cost: {
    total_usd: 130.91,
    main_loop_usd: 130.91,
    subagent_usd: 0.0,
    by_category: {
      fresh_input: { tokens: 156313, usd: 2.34, rate_per_mtok: 15.0, tok_pct: 0.26, cost_pct: 1.8 },
      cache_write: { tokens: 1473313, usd: 27.62, rate_per_mtok: 18.75, tok_pct: 2.46, cost_pct: 21.1 },
      cache_read: { tokens: 58177354, usd: 87.27, rate_per_mtok: 1.5, tok_pct: 97.0, cost_pct: 66.7 },
      output: { tokens: 182381, usd: 13.68, rate_per_mtok: 75.0, tok_pct: 0.3, cost_pct: 10.4 },
    },
    cache_savings_usd: 785.39,
    cache_write_premium_usd: 5.52,
    blended_per_mtok_usd: 2.18,
    pricing_basis:
      "Opus 4.x estimate: fresh input $15/M · output $75/M · cache-write $18.75/M · cache-read $1.50/M. Anthropic billing dashboard is authoritative.",
    subagents_per_dispatch: [],
  },
  shipped: {
    prs: [
      {
        title: "feat: nightly batch runner + schedule",
        ref: "#88",
        meta: "merged",
        commits: [
          { title: "feat: scaffold nightly batch runner" },
          { title: "feat: wire cron schedule + retry backoff" },
          { title: "fix: review nit — clamp concurrency to pool size" },
        ],
        reviews: [{ title: "Reviewed batch runner concurrency + retry", ref: "#88", meta: "$2.06 · 3m" }],
      },
    ],
    reviews: [{ title: "Reviewed template schema", ref: "#86" }],
    adrs: [{ title: "ADR-003 — batch generation over streaming" }],
    skills: [{ title: "demo-template" }],
    commits: [{ title: "docs: tidy README batch-runner section (direct to main)" }],
  },
};
