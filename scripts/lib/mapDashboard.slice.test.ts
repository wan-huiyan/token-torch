import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapDashboard, type FloorStats } from "./mapDashboard";
import type { SettingsFacts } from "./effort";
import type { SessionRecord } from "./ingest";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

const CUTOFF_MS = Date.parse("2026-05-29T10:33:00.000Z");
const settings: SettingsFacts = { settingsEffort: "high", settingsMtimeMs: CUTOFF_MS };

const baseRec = (over: Partial<SessionRecord>): SessionRecord => ({
  id: over.id ?? "sess0001", sessionUuid: "u", date: "2026-06-01", project: "demo-project-alpha",
  rawProjectDirs: ["d"], tokens: { fresh_input: 100, output: 50, cache_write: 0, cache_read: 0 },
  perModelTokens: { "claude-opus-4-8": { fresh_input: 100, output: 50, cache_write: 0, cache_read: 0 } },
  modelMsgCounts: { "claude-opus-4-8": 20 }, dominantModel: "opus", cacheHitPct: 0,
  wallClockMin: 5, activeMin: 5, idleMin: 0, assistantMsgCount: 20,
  scaffoldingFloor: 0, turnCount: 0, toolCounts: { Bash: 3 }, hasUsage: true,
  timePhases: { active_breakdown: { thinking_min: 0, tool_min: 0, subagent_min: 0, planning_min: 0 }, segments: [], tool_time: [], turns: [] },
  ...over,
});

const floor: FloorStats = { discovered: 0, kept: 0, droppedFloor: 0, droppedWithUsage: 0, droppedWithUsageUsd: 0 };
// point projectsDir at an empty (but EXISTING) temp dir so the subagent index is
// empty and deterministic — create it so buildSubagentIndex's readdir doesn't throw.
const emptyDir = join(tmpdir(), "tt-no-subagents-" + Date.now());
mkdirSync(emptyDir, { recursive: true });

check("rows and details both carry model_version/effort/data_tier; facet values agree", () => {
  const observed = baseRec({ id: "obs00001", observedEffort: "ultracode", startedAtMs: CUTOFF_MS - 10_000, modelMsgCounts: { "claude-opus-4-8": 18, "claude-opus-4-7": 2 } });
  const { dashboard, details } = mapDashboard([observed], new Map(), "2026-06-01T00:00:00.000Z", floor, emptyDir, settings);

  const row = dashboard.sessions.find((r) => r.id === "obs00001")!;
  const detail = details.find((d) => d.id === "obs00001")!;

  assert.equal(row.model_version, "claude-opus-4-8");
  assert.deepEqual(row.model_versions, { "claude-opus-4-8": 18, "claude-opus-4-7": 2 });
  assert.equal(row.effort!.value, "ultracode");
  assert.equal(row.effort!.source, "observed");
  assert.equal(row.effort!.confidence, "high");
  assert.equal(row.data_tier, "jsonl"); // no overlay entry

  // detail mirrors the row (lockstep — no drift)
  assert.equal(detail.model_version, row.model_version);
  assert.deepEqual(detail.effort, row.effort);
  assert.equal(detail.data_tier, row.data_tier);
});

check("data_tier is 'enriched' when an overlay entry exists for the session", () => {
  const rec = baseRec({ id: "enr00001" });
  // overlay value shape is unused by data_tier (only key presence matters)
  const overlay = new Map<string, any>([["enr00001", { id: "enr00001" }]]);
  const { dashboard } = mapDashboard([rec], overlay, "2026-06-01T00:00:00.000Z", floor, emptyDir, settings);
  assert.equal(dashboard.sessions.find((r) => r.id === "enr00001")!.data_tier, "enriched");
});

check("inferred_default low-confidence for a pre-cutoff session with no marker", () => {
  const rec = baseRec({ id: "old00001", startedAtMs: CUTOFF_MS - 1 });
  const { dashboard } = mapDashboard([rec], new Map(), "2026-06-01T00:00:00.000Z", floor, emptyDir, settings);
  const eff = dashboard.sessions.find((r) => r.id === "old00001")!.effort!;
  assert.equal(eff.source, "inferred_default");
  assert.equal(eff.confidence, "low");
  assert.equal(eff.value, "high");
});

check("mapDashboard attaches context_overhead to rows, details, and aggregates totals (Plan 8 / #10)", () => {
  const rec = baseRec({ id: "ov000001", scaffoldingFloor: 30000, turnCount: 4 });
  const { dashboard, details } = mapDashboard([rec], new Map(), "2026-06-03T00:00:00.000Z", floor, emptyDir, settings);
  const detail = details.find((d) => d.id === "ov000001")!;
  const row = dashboard.sessions.find((r) => r.id === "ov000001")!;
  assert.equal(detail.context_overhead?.scaffolding_tokens, 30000);
  assert.equal(detail.context_overhead?.reread_tokens, 120000); // 30000 * 4
  // row mirrors the detail (lockstep — L9)
  assert.equal(row.context_overhead?.reread_tokens, 120000);
  // single session → aggregate equals it
  assert.equal(dashboard.totals.context_overhead?.reread_tokens, 120000);
});

check("model_mix excludes <synthetic> and renormalizes to ~100 (Plan 5, closes #4)", () => {
  const a = baseRec({ id: "mm000001", modelMsgCounts: { "claude-opus-4-8": 10 } });
  const b = baseRec({ id: "mm000002", modelMsgCounts: { "claude-opus-4-8": 8, "<synthetic>": 2 } });
  const { dashboard } = mapDashboard([a, b], new Map(), "2026-06-03T00:00:00.000Z", floor, emptyDir, settings);
  const mix = dashboard.distributions.model_mix;
  assert.equal(mix["<synthetic>"], undefined, "<synthetic> must not appear in model_mix");
  const sum = Object.values(mix).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum - 100) < 0.5, `model_mix should renormalize to ~100, got ${sum}`);
});

check("out_tokens + time_saved_min populated on the row (Plan 5 axes)", () => {
  // detail.tokens.output derives from perModelTokens (the cost source), so set it there.
  const rec = baseRec({
    id: "ax000001",
    perModelTokens: { "claude-opus-4-8": { fresh_input: 100, output: 4242, cache_write: 0, cache_read: 0 } },
  });
  const { dashboard } = mapDashboard([rec], new Map(), "2026-06-03T00:00:00.000Z", floor, emptyDir, settings);
  const row = dashboard.sessions.find((r) => r.id === "ax000001")!;
  assert.equal(row.out_tokens, 4242);
  assert.equal(typeof row.time_saved_min, "number"); // 0 with no subagents
});

console.log(`\n${passed} mapDashboard.slice checks passed`);
