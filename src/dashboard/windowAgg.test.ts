import assert from "node:assert/strict";
import type { SessionRow } from "../types";
import { aggregate, dailySeries, projectAgg, tierOf, windowRange, winSessions } from "./windowAgg";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const bounds = { from: "2026-05-01", to: "2026-05-31", all: true };
const mk = (over: Partial<SessionRow>): SessionRow => ({
  id: "x", date: "2026-05-15", project: "p", cost_usd: 10, cost_main: 8, cost_sub: 2,
  active_min: 30, idle_min: 60, cache_pct: 90, subagents: 1, model: "opus", fidelity: "high",
  top_tools: {}, detail_href: "", out_tokens: 1000, time_saved_min: 1, ...over,
});

check("mode=all → full bounds, all=true", () => {
  const r = windowRange({ mode: "all", from: null, to: null }, bounds);
  assert.deepEqual(r, { from: "2026-05-01", to: "2026-05-31", all: true });
});

check("preset 7d counts back 6 days inclusive from corpus end", () => {
  const r = windowRange({ mode: 7, from: null, to: null }, bounds);
  assert.equal(r.to, "2026-05-31");
  assert.equal(r.from, "2026-05-25"); // 31 - 6 = 25 (7 days inclusive)
  assert.equal(r.all, false);
});

check("preset that runs past corpus start clamps to bounds.from", () => {
  const r = windowRange({ mode: 30, from: null, to: null }, { from: "2026-05-20", to: "2026-05-31", all: true });
  assert.equal(r.from, "2026-05-20"); // clamped, not 2026-05-02
});

check("custom range passes through; swapped picks normalize", () => {
  assert.deepEqual(windowRange({ mode: "custom", from: "2026-05-10", to: "2026-05-20" }, bounds), { from: "2026-05-10", to: "2026-05-20", all: false });
  assert.deepEqual(windowRange({ mode: "custom", from: "2026-05-20", to: "2026-05-10" }, bounds), { from: "2026-05-10", to: "2026-05-20", all: false });
});

check("winSessions is inclusive on both ends, string-date safe", () => {
  const rows = [mk({ date: "2026-05-09" }), mk({ date: "2026-05-10" }), mk({ date: "2026-05-20" }), mk({ date: "2026-05-21" })];
  const got = winSessions(rows, { from: "2026-05-10", to: "2026-05-20", all: false });
  assert.equal(got.length, 2);
});

check("aggregate sums per-session fields; fidelity splits hi/ml; cache is the mean", () => {
  const a = aggregate([mk({ cost_usd: 10, fidelity: "high", cache_pct: 80 }), mk({ cost_usd: 30, fidelity: "main_loop", cache_pct: 100 })]);
  assert.equal(a.cost, 40);
  assert.equal(a.hi, 10);
  assert.equal(a.ml, 30);
  assert.equal(a.cacheAvg, 90);
  assert.equal(a.sessions, 2);
});

check("aggregate on empty subset is all-zero (no NaN cache)", () => {
  const a = aggregate([]);
  assert.equal(a.cost, 0);
  assert.equal(a.cacheAvg, 0);
  assert.equal(a.projectCount, 0);
});

check("projectAgg sorts by cost desc, shares sum to ~1, flags any main-loop group", () => {
  const rows = projectAgg([mk({ project: "a", cost_usd: 30, fidelity: "main_loop" }), mk({ project: "b", cost_usd: 10 }), mk({ project: "a", cost_usd: 10 })]);
  assert.equal(rows[0].name, "a");
  assert.equal(rows[0].cost, 40);
  assert.equal(rows[0].ml, true);
  assert.ok(Math.abs(rows.reduce((t, r) => t + r.share, 0) - 1) < 1e-9);
});

check("dailySeries includes zero-session days (real gaps, not interpolated)", () => {
  const rows = [mk({ date: "2026-05-01", cost_usd: 5 }), mk({ date: "2026-05-03", cost_usd: 7 })];
  const series = dailySeries(rows, { from: "2026-05-01", to: "2026-05-03", all: false });
  assert.equal(series.length, 3);
  assert.equal(series[1].date, "2026-05-02");
  assert.equal(series[1].sessions, 0); // the gap day exists with zero
  assert.equal(series[1].cost, 0);
});

check("tierOf uses fixed cost thresholds ($100 / $50)", () => {
  assert.equal(tierOf(120).tier, "inferno");
  assert.equal(tierOf(70).tier, "campfire");
  assert.equal(tierOf(20).tier, "ember");
  assert.equal(tierOf(50).tier, "campfire"); // boundary inclusive
});

console.log(`\n${passed} windowAgg checks passed`);
