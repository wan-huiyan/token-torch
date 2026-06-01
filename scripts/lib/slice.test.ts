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

console.log(`\n${passed} slice checks passed`);
