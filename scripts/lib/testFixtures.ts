import type { DashboardData } from "../../src/types";

/** Minimal DashboardData fixture exercising the whitelist fields. Shared by the
 *  insights prompt + agent tests. (insightsValidate.test.ts keeps its own local copy.) */
export function dashboardFixture(): DashboardData {
  return {
    meta: {
      generated_at: "2026-06-01T12:00:00.000Z",
      schema_version: "tracker-1.0",
      session_count: 597,
      file_count: 800,
      project_count: 12,
      date_range: { from: "2026-05-01", to: "2026-06-01" },
      small_n: false,
      fidelity_note: "",
      floor: { discovered: 1477, kept: 597, dropped: 880, dropped_with_usage: 597, dropped_with_usage_usd: 305.56 },
    },
    totals: {
      cost_usd: 12679.22,
      floored_usd: 305.56,
      complete_spend_usd: 12984.78,
      cost_by_fidelity: { high: 12000, main_loop: 679.22 },
      active_minutes: 6000,
      active_hours: 100,
      idle_minutes: 1200,
      idle_hours: 20,
      sessions: 597,
      subagent_dispatches: 42,
      cost_per_active_min: 2.11,
      avg_cache_hit_pct: 95.4,
      tokens: { input_fresh: 1000000, cache_read: 9000000, output: 500000 },
      time_saved_min: 300,
      time_saved_hours: 5,
    },
    projects: [
      { name: "alpha", cost_usd: 8000, sessions: 200, active_min: 3000, cost_share: 0.63, cost_per_session: 40 },
      { name: "beta", cost_usd: 2000, sessions: 100, active_min: 1500, cost_share: 0.16, cost_per_session: 20 },
    ],
    timeline: [],
    sessions: [],
    distributions: { model_mix: { "claude-opus-4-8": 80, "claude-sonnet-4-6": 20 }, tools_aggregate: {}, time_split: { active_min: 6000, idle_min: 1200 } },
    flags: [],
    insights_md: null,
  };
}
