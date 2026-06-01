import type { DashboardData } from "../types";

/**
 * Dashboard fixture — ILLUSTRATIVE SAMPLE DATA, not real usage. Project names
 * (`demo-project-*`) and session ids (`demo000N`) are placeholders; the numbers
 * are example values chosen to exercise the contract + every UI state. This is
 * only the fallback the UI renders before you run `pnpm generate`; once you do,
 * the app shows YOUR own data from `public/data/`. `small_n: true`, so this also
 * exercises the "sample only — not a real trend yet" timeline state.
 */
export const dashboardFixture: DashboardData = {
  meta: {
    generated_at: "2026-05-29T16:30:00Z",
    schema_version: "tracker-1.0",
    session_count: 5,
    file_count: 6,
    project_count: 3,
    date_range: { from: "2026-05-28", to: "2026-05-29" },
    small_n: true,
    fidelity_note: "1 of 5 sessions is main-loop-only (subagent spend not counted).",
  },
  totals: {
    cost_usd: 1138.28,
    cost_by_fidelity: { high: 1007.37, main_loop: 130.91 },
    active_minutes: 439.8,
    active_hours: 7.3,
    idle_minutes: 1454.5,
    idle_hours: 24.2,
    sessions: 5,
    subagent_dispatches: 33,
    cost_per_active_min: 2.59,
    avg_cache_hit_pct: 99.3,
    tokens: { input_fresh: 21_000_000, cache_read: 2_980_000_000, output: 2_200_000 },
    time_saved_min: 612,
    time_saved_hours: 10.2,
  },
  projects: [
    { name: "demo-project-alpha", cost_usd: 634.96, sessions: 2, active_min: 203.3, cost_share: 0.558, cost_per_session: 317.48 },
    { name: "demo-project-beta", cost_usd: 372.41, sessions: 2, active_min: 158.7, cost_share: 0.327, cost_per_session: 186.21 },
    { name: "demo-project-gamma", cost_usd: 130.91, sessions: 1, active_min: 77.8, cost_share: 0.115, cost_per_session: 130.91 },
  ],
  timeline: [
    { date: "2026-05-28", cost_usd: 126.39, sessions: 1, active_min: 55.2 },
    { date: "2026-05-29", cost_usd: 1011.89, sessions: 4, active_min: 384.6 },
  ],
  sessions: [
    { id: "demo0001", date: "2026-05-29", project: "demo-project-alpha", cost_usd: 385.31, cost_main: 300.0, cost_sub: 85.31, active_min: 113.3, idle_min: 167.6, cache_pct: 99.8, subagents: 19, model: "opus", fidelity: "high", top_tools: { Bash: 78, Edit: 40 }, detail_href: "sessions/demo0001.html" },
    { id: "demo0002", date: "2026-05-29", project: "demo-project-beta", cost_usd: 246.02, cost_main: 221.54, cost_sub: 24.48, active_min: 103.5, idle_min: 80.2, cache_pct: 99.9, subagents: 1, model: "opus", fidelity: "high", top_tools: { Bash: 60, Edit: 22 }, detail_href: "sessions/demo0002.html" },
    { id: "demo0003", date: "2026-05-29", project: "demo-project-alpha", cost_usd: 249.65, cost_main: 200.0, cost_sub: 49.65, active_min: 90.0, idle_min: 60.0, cache_pct: 99.5, subagents: 6, model: "opus", fidelity: "high", reconciliation_note: "A second record for this session disagreed by $81.80; kept the subagent-inclusive cctime figure.", top_tools: { Bash: 50, Edit: 18 }, detail_href: "sessions/demo0003.html" },
    { id: "demo0004", date: "2026-05-29", project: "demo-project-gamma", cost_usd: 130.91, cost_main: 130.91, cost_sub: 0, active_min: 77.8, idle_min: 84.0, cache_pct: 97.3, subagents: 0, model: "opus", fidelity: "main_loop", top_tools: { Bash: 30, Edit: 12 }, detail_href: "sessions/demo0004.html" },
    { id: "demo0005", date: "2026-05-28", project: "demo-project-beta", cost_usd: 126.39, cost_main: 101.91, cost_sub: 24.48, active_min: 55.2, idle_min: 1062.7, cache_pct: 100.0, subagents: 7, model: "opus", fidelity: "high", top_tools: { Bash: 40, Edit: 9 }, detail_href: "sessions/demo0005.html" },
  ],
  distributions: {
    model_mix: { opus: 100 },
    tools_aggregate: { Bash: 258, Edit: 101, Read: 70, Agent: 33 },
    time_split: { active_min: 439.8, idle_min: 1454.5 },
  },
  flags: [
    { level: "warn", title: "1 session undercounts subagents", detail: "demo-project-gamma is main-loop fidelity — its real cost is higher than shown.", metric: "fidelity" },
    { level: "info", title: "demo-project-alpha is your biggest spend", detail: "56% of total cost ($635) across 2 sessions.", metric: "concentration" },
    { level: "info", title: "Cache hygiene is excellent", detail: "Avg 99.3% cache hit — you're not thrashing context.", metric: "cache" },
  ],
  insights_md:
    "**This week (auto-generated, 2026-05-29):**\n- demo-project-alpha is 56% of your spend ($635 over 2 sessions, ~$317 each) — the priciest project per session. Worth checking whether the subagent fan-out there is over-provisioned.\n- Cache hit is consistently 97–100%; no action needed.\n- Only 5 sessions on record — not enough for trend claims yet. Check back after ~10.",
};
