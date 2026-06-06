import assert from "node:assert/strict";
import type {
  ModelFamily,
  ModelVersion,
  EffortValue,
  EffortSource,
  EffortTag,
  SessionRow,
  SessionDetailData,
  ContextOverhead,
  DashboardData,
} from "../../src/types";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

check("ModelVersion has id/family/label", () => {
  const v: ModelVersion = { id: "claude-opus-4-8", family: "opus", label: "Opus 4.8" };
  assert.equal(v.id, "claude-opus-4-8");
  assert.equal(v.family, "opus");
  assert.equal(v.label, "Opus 4.8");
});

check("ModelFamily accepts known families and the open string form", () => {
  const a: ModelFamily = "opus";
  const b: ModelFamily = "some-future-family"; // open enum (string & {})
  assert.equal(a, "opus");
  assert.equal(b, "some-future-family");
});

check("EffortTag carries value/source/confidence with optional modifiers", () => {
  const observed: EffortTag = { value: "ultracode", source: "observed", confidence: "high" };
  const inferred: EffortTag = { value: "high", source: "inferred_default", confidence: "low" };
  const unknown: EffortTag = { value: "unknown", source: "unknown", confidence: "low" };
  const withMods: EffortTag = { value: "high", source: "observed", confidence: "high", modifiers: ["fast"] };
  const v: EffortValue = "max";
  const s: EffortSource = "inferred_default";
  assert.equal(observed.source, "observed");
  assert.equal(inferred.confidence, "low");
  assert.equal(unknown.value, "unknown");
  assert.deepEqual(withMods.modifiers, ["fast"]);
  assert.equal(v, "max");
  assert.equal(s, "inferred_default");
});

check("SessionRow accepts the four new optional facet fields and works without them", () => {
  const bare: SessionRow = {
    id: "abc12345", date: "2026-05-01", project: "p", cost_usd: 1, cost_main: 1, cost_sub: 0,
    active_min: 1, idle_min: 0, cache_pct: 0, subagents: 0, model: "opus", fidelity: "high",
    top_tools: {}, detail_href: "/sessions/abc12345",
  };
  const faceted: SessionRow = {
    ...bare,
    model_version: "claude-opus-4-8",
    model_versions: { "claude-opus-4-8": 12 },
    effort: { value: "ultracode", source: "observed", confidence: "high" },
    data_tier: "jsonl",
  };
  assert.equal(bare.model_version, undefined);   // additive: optional
  assert.equal(faceted.model_version, "claude-opus-4-8");
  assert.equal(faceted.data_tier, "jsonl");
});

check("SessionDetailData accepts the same optional facet fields", () => {
  const d = {} as SessionDetailData;
  const widened: Pick<SessionDetailData, "model_version" | "effort" | "data_tier"> = {
    model_version: "claude-opus-4-8",
    effort: { value: "high", source: "inferred_default", confidence: "high" },
    data_tier: "enriched",
  };
  assert.equal(widened.data_tier, "enriched");
  assert.ok(d !== undefined);
});

check("ContextOverhead is additive — a fixture without it still satisfies the types (Plan 8 / #10)", () => {
  const co: ContextOverhead = {
    scaffolding_tokens: 29000,
    reread_tokens: 870000,
    reread_usd: 0.44,
    overhead_pct_of_input: 41.2,
    subagent_scaffolding_tokens: 51000,
    turns: 30,
    note: "Estimate: base context re-read each turn; cache-read rate.",
  };
  assert.equal(co.scaffolding_tokens, 29000);
  // additive: a row WITHOUT context_overhead is still a valid SessionRow.
  const row: SessionRow = {
    id: "a", date: "2026-06-03", project: "p", cost_usd: 1, cost_main: 1, cost_sub: 0,
    active_min: 1, idle_min: 0, cache_pct: 50, subagents: 0, model: "opus",
    fidelity: "main_loop", top_tools: {}, detail_href: "/sessions/a",
  };
  assert.equal(row.context_overhead, undefined);
  // and totals can carry it.
  const t: Pick<DashboardData["totals"], "context_overhead"> = { context_overhead: co };
  assert.equal(t.context_overhead?.reread_usd, 0.44);
});

check("SessionRow out_tokens/time_saved_min are additive optionals (Plan 5)", () => {
  const bare: SessionRow = {
    id: "a", date: "2026-06-03", project: "p", cost_usd: 1, cost_main: 1, cost_sub: 0,
    active_min: 1, idle_min: 0, cache_pct: 0, subagents: 0, model: "opus", fidelity: "high",
    top_tools: {}, detail_href: "/sessions/a",
  };
  assert.equal(bare.out_tokens, undefined);
  assert.equal(bare.time_saved_min, undefined);
  const withAxes: SessionRow = { ...bare, out_tokens: 4242, time_saved_min: 12 };
  assert.equal(withAxes.out_tokens, 4242);
  assert.equal(withAxes.time_saved_min, 12);
});

check("S11: SessionRow start_ts/headline/shipped_short/active_breakdown are additive optionals", () => {
  const bare: SessionRow = {
    id: "a", date: "2026-06-03", project: "p", cost_usd: 1, cost_main: 1, cost_sub: 0,
    active_min: 1, idle_min: 0, cache_pct: 0, subagents: 0, model: "opus", fidelity: "high",
    top_tools: {}, detail_href: "/sessions/a",
  };
  assert.equal(bare.start_ts, undefined);
  assert.equal(bare.headline, undefined);
  assert.equal(bare.shipped_short, undefined);
  assert.equal(bare.active_breakdown, undefined);
  const enriched: SessionRow = {
    ...bare,
    start_ts: "2026-06-03T09:00:00.000Z",
    headline: "set up release automation for my repo",
    shipped_short: "3 PRs · 2 reviews",
    active_breakdown: { thinking_min: 4, tool_min: 2, subagent_min: 5, planning_min: 0 },
  };
  assert.equal(enriched.shipped_short, "3 PRs · 2 reviews");
  assert.equal(enriched.active_breakdown?.subagent_min, 5);
});

check("S11: totals.tokens.total + context_overhead.reread_saved_usd are additive optionals", () => {
  const tokens: DashboardData["totals"]["tokens"] = { input_fresh: 1, cache_read: 2, output: 3 };
  assert.equal(tokens.total, undefined); // additive — bare literal compiles without it
  const withTotal: DashboardData["totals"]["tokens"] = { ...tokens, total: 6 };
  assert.equal(withTotal.total, 6);
  const co: ContextOverhead = {
    scaffolding_tokens: 1, reread_tokens: 2, reread_usd: 0.1, overhead_pct_of_input: 5,
    subagent_scaffolding_tokens: 0, turns: 1, note: "est",
  };
  assert.equal(co.reread_saved_usd, undefined); // additive
  const withSaved: ContextOverhead = { ...co, reread_saved_usd: 0.45 };
  assert.equal(withSaved.reread_saved_usd, 0.45);
});

check("DashboardData.catalog_savings is optional + additive", () => {
  const cs: NonNullable<DashboardData["catalog_savings"]> = {
    daily: [{ date: "2026-06-06", est_saving_tokens: 100, observed_floor: 30000 }],
    snapshot_count: 2, cumulative_tokens: 100, hidden_count: 436, total_skills: 910,
    per_injection_tokens: 5201, est_usd: 0.01, note: "Estimate.",
  };
  assert.equal(cs.cumulative_tokens, 100);
  assert.equal(cs.flip_marker, undefined);
});

console.log(`\n${passed} types-contract checks passed`);
