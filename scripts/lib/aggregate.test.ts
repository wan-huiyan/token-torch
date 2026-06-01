import assert from "node:assert/strict";
import type { SessionRow } from "../../src/types";
import {
  weekKey,
  monthKey,
  groupSessions,
  prettyModel,
  effortLabel,
  searchSessions,
  paginate,
} from "../../src/dashboard/aggregate";
import type { GroupBy } from "../../src/dashboard/aggregate";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

/** Minimal SessionRow factory — only the fields the helpers read. */
function row(over: Partial<SessionRow>): SessionRow {
  return {
    id: "s",
    date: "2026-05-01",
    project: "proj-a",
    cost_usd: 1,
    cost_main: 1,
    cost_sub: 0,
    active_min: 10,
    idle_min: 0,
    cache_pct: 50,
    subagents: 0,
    model: "opus",
    fidelity: "high",
    top_tools: {},
    detail_href: "sessions/s.json",
    ...over,
  };
}

// --- UTC date keys ---
check("weekKey buckets to the UTC Monday-anchored ISO week start", () => {
  // 2026-05-01 is a Friday (UTC) → week starts Mon 2026-04-27.
  assert.equal(weekKey("2026-05-01"), "2026-04-27");
  // 2026-04-27 (Mon) maps to itself.
  assert.equal(weekKey("2026-04-27"), "2026-04-27");
  // 2026-04-26 (Sun) belongs to the prior week starting 2026-04-20.
  assert.equal(weekKey("2026-04-26"), "2026-04-20");
});

check("monthKey buckets to UTC YYYY-MM", () => {
  assert.equal(monthKey("2026-05-01"), "2026-05");
  assert.equal(monthKey("2026-12-31T23:59:00.000Z"), "2026-12");
});

// --- groupSessions: project ---
check("groupSessions by project aggregates n / cost / cache / tokens_out_estimate", () => {
  const rows = [
    row({ project: "proj-a", cost_usd: 2, cache_pct: 40 }),
    row({ project: "proj-a", cost_usd: 4, cache_pct: 60 }),
    row({ project: "proj-b", cost_usd: 1, cache_pct: 80 }),
  ];
  const groups = groupSessions(rows, "project");
  // sorted by cost desc
  assert.equal(groups[0].key, "proj-a");
  assert.equal(groups[0].label, "proj-a");
  assert.equal(groups[0].sessions, 2);
  assert.equal(groups[0].cost_usd, 6);
  assert.equal(groups[0].avg_cache_pct, 50); // (40+60)/2
  assert.equal(groups[1].key, "proj-b");
});

// --- groupSessions: week (uses date) ---
check("groupSessions by week keys on UTC week start and reports date span", () => {
  const rows = [
    row({ id: "x", date: "2026-05-01", cost_usd: 1 }), // week 2026-04-27
    row({ id: "y", date: "2026-05-02", cost_usd: 2 }), // week 2026-04-27 (Sat)
    row({ id: "z", date: "2026-04-20", cost_usd: 5 }), // week 2026-04-20
  ];
  const groups = groupSessions(rows, "week");
  assert.equal(groups[0].key, "2026-04-20"); // cost 5 sorts first
  assert.equal(groups[1].key, "2026-04-27");
  assert.equal(groups[1].sessions, 2);
  assert.equal(groups[1].date_from, "2026-05-01");
  assert.equal(groups[1].date_to, "2026-05-02");
});

// --- groupSessions: model_version, with missing → "unknown" ---
check("groupSessions by model uses model_version, prettifies label, buckets missing as unknown", () => {
  const rows = [
    row({ id: "a", model_version: "claude-opus-4-8", cost_usd: 3 }),
    row({ id: "b", model_version: "claude-opus-4-8", cost_usd: 1 }),
    row({ id: "c", cost_usd: 2 }), // no model_version → unknown
  ];
  const groups = groupSessions(rows, "model");
  assert.equal(groups[0].key, "claude-opus-4-8");
  assert.equal(groups[0].label, "Opus 4.8");
  assert.equal(groups[0].sessions, 2);
  const unknown = groups.find((g) => g.key === "unknown");
  assert.ok(unknown);
  assert.equal(unknown!.label, "unknown");
});

// --- groupSessions: effort, with missing → "unknown" ---
check("groupSessions by effort uses effort.value, missing → unknown", () => {
  const rows = [
    row({ id: "a", effort: { value: "high", source: "observed", confidence: "high" }, cost_usd: 2 }),
    row({ id: "b", effort: { value: "ultracode", source: "observed", confidence: "high" }, cost_usd: 5 }),
    row({ id: "c", cost_usd: 1 }), // no effort → unknown
  ];
  const groups = groupSessions(rows, "effort");
  assert.equal(groups[0].key, "ultracode");
  assert.equal(groups[0].label, "ultracode");
  assert.ok(groups.find((g) => g.key === "unknown"));
});

// --- smoke-test remaining exports (full edge-case coverage in Task 2) ---
check("prettyModel, effortLabel, searchSessions, paginate are callable and return expected shapes", () => {
  assert.equal(prettyModel("claude-opus-4-8"), "Opus 4.8");
  assert.equal(effortLabel("high"), "high");
  assert.equal(searchSessions([], "q").length, 0);
  assert.equal(paginate([], 1, 10).pages, 1);
  // GroupBy is used as a type annotation (compile-only)
  const _gb: GroupBy = "project";
  void _gb;
});

// --- searchSessions ---
check("searchSessions matches id/project/model case-insensitively; empty q passes through", () => {
  const rows = [
    row({ id: "abc123", project: "Token-Torch", model: "opus" }),
    row({ id: "def456", project: "other", model: "haiku" }),
  ];
  assert.equal(searchSessions(rows, "").length, 2);
  assert.equal(searchSessions(rows, "token").length, 1);
  assert.equal(searchSessions(rows, "HAIKU").length, 1);
  assert.equal(searchSessions(rows, "zzz").length, 0);
});

// --- paginate ---
check("paginate slices, clamps out-of-range pages, reports total pages", () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  const p1 = paginate(items, 1, 10);
  assert.deepEqual(p1.slice, [0,1,2,3,4,5,6,7,8,9]);
  assert.equal(p1.pages, 3);
  const p3 = paginate(items, 3, 10);
  assert.deepEqual(p3.slice, [20,21,22,23,24]);
  const over = paginate(items, 99, 10);
  assert.equal(over.page, 3); // clamped
  assert.deepEqual(over.slice, [20,21,22,23,24]);
  const empty = paginate<number>([], 1, 10);
  assert.equal(empty.pages, 1);
  assert.deepEqual(empty.slice, []);
});

// --- prettyModel edge cases ---
check("prettyModel handles non-standard ids and empties", () => {
  assert.equal(prettyModel("claude-sonnet-4-5"), "Sonnet 4.5");
  assert.equal(prettyModel("claude-haiku-4-5-20251001"), "Haiku 4.5");
  assert.equal(prettyModel("gpt-4o"), "gpt-4o"); // passthrough
  assert.equal(prettyModel(""), "unknown");
});

console.log(`\naggregate.ts: ${passed} checks passed`);
