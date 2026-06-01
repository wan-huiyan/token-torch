import assert from "node:assert/strict";
import type {
  ModelFamily,
  ModelVersion,
  EffortValue,
  EffortSource,
  EffortTag,
  SessionRow,
  SessionDetailData,
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

console.log(`\n${passed} types-contract checks passed`);
