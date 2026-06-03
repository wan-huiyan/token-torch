import assert from "node:assert/strict";
import { isRealModelId, prettyModelId, SYNTHETIC_MODEL_IDS } from "./models";

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

check("prettyModelId renders version-distinct labels, passes unknown shapes through", () => {
  assert.equal(prettyModelId("claude-opus-4-8"), "Opus 4.8");
  assert.equal(prettyModelId("claude-opus-4-7"), "Opus 4.7");
  assert.equal(prettyModelId("claude-sonnet-4-6"), "Sonnet 4.6");
  assert.equal(prettyModelId("<synthetic>"), "<synthetic>"); // unknown shape unchanged
});

console.log(`\n${passed} models checks passed`);
