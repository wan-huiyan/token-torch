import assert from "node:assert/strict";
import { isRealModelId, SYNTHETIC_MODEL_IDS } from "./models";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

check("isRealModelId accepts real Claude ids, rejects synthetic placeholders + empty", () => {
  assert.equal(isRealModelId("claude-opus-4-8"), true);
  assert.equal(isRealModelId("claude-sonnet-4-6"), true);
  assert.equal(isRealModelId("<synthetic>"), false);
  assert.equal(isRealModelId("<SYNTHETIC>"), false); // case-insensitive
  assert.equal(isRealModelId("unknown"), false);
  assert.equal(isRealModelId(""), false);
  assert.ok(SYNTHETIC_MODEL_IDS.has("<synthetic>"));
});

console.log(`\n${passed} models checks passed`);
