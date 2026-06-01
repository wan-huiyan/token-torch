import assert from "node:assert/strict";
import { burnTier, computeBurnBands } from "./burnTier";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

check("absent bands → legacy absolute thresholds", () => {
  assert.equal(burnTier(350).key, "inferno");
  assert.equal(burnTier(250).key, "campfire");
  assert.equal(burnTier(50).key, "ember");
});

check("Lil' Ember keeps the curly apostrophe (U+2019)", () => {
  assert.equal(burnTier(0).name, "Lil’ Ember");
});

check("tiny corpus (<5) falls back to default bands", () => {
  assert.deepEqual(computeBurnBands([1, 2, 3]), { campfire: 200, inferno: 300 });
});

check("degenerate (all equal) corpus falls back to default bands", () => {
  assert.deepEqual(computeBurnBands([10, 10, 10, 10, 10, 10]), { campfire: 200, inferno: 300 });
});

// THE PINNED CASE: many VARIED small sessions + one huge outlier must NOT collapse
// every small session to the bottom tier. With computed bands the smalls spread
// across >= 2 tiers (this is what proves the fix; identical smalls would degenerate).
check("varied smalls + one outlier spread across >= 2 tiers (no collapse)", () => {
  const smalls = Array.from({ length: 20 }, (_, i) => i + 1); // $1..$20, varied
  const costs = [...smalls, 361]; // one ~$361 outlier
  const bands = computeBurnBands(costs);
  assert.ok(bands.campfire < bands.inferno, "bands must be monotonic");
  const tiers = new Set(smalls.map((c) => burnTier(c, bands).key));
  assert.ok(tiers.size >= 2, `expected smalls across >=2 tiers, got ${[...tiers].join(",")}`);
});

check("the outlier still lands in inferno", () => {
  const smalls = Array.from({ length: 20 }, (_, i) => i + 1);
  const bands = computeBurnBands([...smalls, 361]);
  assert.equal(burnTier(361, bands).key, "inferno");
});

console.log(`\n${passed} checks passed (burnTier)`);
