import assert from "node:assert/strict";
import { deriveModelVersion } from "./slice";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

check("deriveModelVersion: dominant id is the one with the most messages; versions = the map", () => {
  const r = deriveModelVersion({ "claude-opus-4-8": 30, "claude-opus-4-7": 5, "claude-haiku-4-5": 2 });
  assert.equal(r.model_version, "claude-opus-4-8");
  assert.deepEqual(r.model_versions, { "claude-opus-4-8": 30, "claude-opus-4-7": 5, "claude-haiku-4-5": 2 });
});

check("deriveModelVersion: single version", () => {
  const r = deriveModelVersion({ "claude-opus-4-8": 12 });
  assert.equal(r.model_version, "claude-opus-4-8");
  assert.deepEqual(r.model_versions, { "claude-opus-4-8": 12 });
});

check("deriveModelVersion: empty map → undefined model_version, empty versions", () => {
  const r = deriveModelVersion({});
  assert.equal(r.model_version, undefined);
  assert.deepEqual(r.model_versions, {});
});

// --- issue #14: deriveModelVersion never returns a synthetic dominant id ---
check("deriveModelVersion picks the dominant REAL id even when a synthetic id is the message-count majority", () => {
  const r = deriveModelVersion({ "<synthetic>": 50, "claude-opus-4-8": 3 });
  assert.equal(r.model_version, "claude-opus-4-8");
  assert.deepEqual(r.model_versions, { "claude-opus-4-8": 3 }); // synthetic stripped from the map too
});

check("deriveModelVersion: synthetic dominant + two real versions → dominant is the larger real id, map is real-only", () => {
  const r = deriveModelVersion({ "<synthetic>": 100, "claude-opus-4-8": 10, "claude-opus-4-7": 5 });
  assert.equal(r.model_version, "claude-opus-4-8");
  assert.deepEqual(r.model_versions, { "claude-opus-4-8": 10, "claude-opus-4-7": 5 });
});

check("deriveModelVersion: all-synthetic session → undefined dominant + empty map (no crash, never a synthetic id)", () => {
  const r = deriveModelVersion({ "<synthetic>": 5, unknown: 2 });
  assert.equal(r.model_version, undefined);
  assert.deepEqual(r.model_versions, {});
});

check("deriveModelVersion: clean single real id is unchanged (regression guard)", () => {
  const r = deriveModelVersion({ "claude-opus-4-8": 12 });
  assert.equal(r.model_version, "claude-opus-4-8");
  assert.deepEqual(r.model_versions, { "claude-opus-4-8": 12 });
});

console.log(`\n${passed} slice checks passed`);
