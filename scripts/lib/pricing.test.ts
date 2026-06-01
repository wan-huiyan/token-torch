import assert from "node:assert/strict";
import {
  MODEL_RATES,
  OPUS_RATES,
  ratesForModel,
  familyOf,
  priceUsd,
  type Rates,
} from "./pricing";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

// --- family detection from real corpus model ids ---
check("opus 4.7 and 4.8 both map to opus family", () => {
  assert.equal(familyOf("claude-opus-4-7"), "opus");
  assert.equal(familyOf("claude-opus-4-8"), "opus");
});
check("sonnet / haiku families detected", () => {
  assert.equal(familyOf("claude-sonnet-4-6"), "sonnet");
  assert.equal(familyOf("claude-haiku-4-5-20251001"), "haiku");
});
check("synthetic / unknown returns null family", () => {
  assert.equal(familyOf("<synthetic>"), null);
  assert.equal(familyOf("gpt-4o"), null);
});

// --- resolver returns the right rate set ---
check("ratesForModel resolves per family", () => {
  assert.deepEqual(ratesForModel("claude-opus-4-8"), MODEL_RATES.opus);
  assert.deepEqual(ratesForModel("claude-sonnet-4-6"), MODEL_RATES.sonnet);
  assert.deepEqual(ratesForModel("claude-haiku-4-5-20251001"), MODEL_RATES.haiku);
});
check("unknown model falls back to Opus (never silently cheap)", () => {
  assert.deepEqual(ratesForModel("totally-unknown"), MODEL_RATES.opus);
});
check("OPUS_RATES stays back-compatible with prior literal", () => {
  assert.deepEqual(OPUS_RATES, { fresh_input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 });
});

// --- the rate structure matches the corpus provenance rules ---
check("cache_write = 1.25x input and cache_read = 0.1x input for every family", () => {
  for (const fam of Object.keys(MODEL_RATES) as (keyof typeof MODEL_RATES)[]) {
    const r: Rates = MODEL_RATES[fam];
    assert.ok(Math.abs(r.cache_write - 1.25 * r.fresh_input) < 1e-9, `${fam} cache_write`);
    assert.ok(Math.abs(r.cache_read - 0.1 * r.fresh_input) < 1e-9, `${fam} cache_read`);
  }
});
check("input/output list rates match corpus pricing_basis", () => {
  assert.equal(MODEL_RATES.opus.fresh_input, 5);   assert.equal(MODEL_RATES.opus.output, 25);
  assert.equal(MODEL_RATES.sonnet.fresh_input, 3); assert.equal(MODEL_RATES.sonnet.output, 15);
  assert.equal(MODEL_RATES.haiku.fresh_input, 1);  assert.equal(MODEL_RATES.haiku.output, 5);
});

// --- pricing actually differs by model ---
check("1M output tokens cost less on sonnet/haiku than opus", () => {
  const oneM = { fresh_input: 0, output: 1_000_000, cache_write: 0, cache_read: 0 };
  assert.equal(priceUsd(oneM, ratesForModel("claude-opus-4-8")), 25);
  assert.equal(priceUsd(oneM, ratesForModel("claude-sonnet-4-6")), 15);
  assert.equal(priceUsd(oneM, ratesForModel("claude-haiku-4-5-20251001")), 5);
});

console.log(`\n${passed} pricing checks passed`);
