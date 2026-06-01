import assert from "node:assert/strict";
import {
  MODEL_RATES,
  OPUS_RATES,
  ratesForModel,
  familyOf,
  priceUsd,
  buildByCategory,
  buildByCategoryPerModel,
  deriveModelRates,
  type Rates,
} from "./pricing";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const litellmFixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "litellm-prices.fixture.json"), "utf8"),
) as Record<string, Record<string, number>>;

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

const MR = MODEL_RATES;

check("per-model by_category: single model equals flat buildByCategory", () => {
  const toks = { fresh_input: 100_000, output: 50_000, cache_write: 200_000, cache_read: 9_000_000 };
  const flat = buildByCategory(toks, MR.opus);
  const perModel = buildByCategoryPerModel({ "claude-opus-4-8": toks });
  assert.equal(perModel.totalUsd, flat.totalUsd);
  for (const c of ["fresh_input", "cache_write", "cache_read", "output"] as const)
    assert.equal(perModel.byCategory[c].usd, flat.byCategory[c].usd);
});

check("per-model by_category: mixed models price each at its own rate and sum to total", () => {
  const opusTok = { fresh_input: 1_000_000, output: 0, cache_write: 0, cache_read: 0 }; // $5
  const haikuTok = { fresh_input: 1_000_000, output: 0, cache_write: 0, cache_read: 0 }; // $1
  const { byCategory, totalUsd } = buildByCategoryPerModel({
    "claude-opus-4-8": opusTok,
    "claude-haiku-4-5": haikuTok,
  });
  assert.equal(totalUsd, 6); // 5 + 1
  assert.equal(byCategory.fresh_input.tokens, 2_000_000);
  assert.equal(byCategory.fresh_input.usd, 6);
  // effective rate is token-weighted: $6 / 2M = $3/M
  assert.equal(byCategory.fresh_input.rate_per_mtok, 3);
  const sum = Math.round(Object.values(byCategory).reduce((s, c) => s + c.usd, 0) * 100);
  assert.equal(sum, Math.round(totalUsd * 100));
});

check("per-model by_category: unknown model priced at Opus (conservative)", () => {
  const toks = { fresh_input: 1_000_000, output: 0, cache_write: 0, cache_read: 0 };
  const r = buildByCategoryPerModel({ "mystery-model": toks });
  assert.equal(r.totalUsd, 5); // opus fallback
});

check("per-model by_category: empty map → zero totals, no crash", () => {
  const r = buildByCategoryPerModel({});
  assert.equal(r.totalUsd, 0);
  for (const c of ["fresh_input", "cache_write", "cache_read", "output"] as const) {
    assert.equal(r.byCategory[c].tokens, 0);
    assert.equal(r.byCategory[c].usd, 0);
  }
});

// --- B1: derive rates from a (fixture) LiteLLM snapshot, drift-guarded ---
check("deriveModelRates: snapshot-hit Opus resolves to the matching $5/MTok set", () => {
  const r = deriveModelRates(litellmFixture);
  assert.deepEqual(r.opus, { fresh_input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 });
});
check("deriveModelRates: drifted snapshot rate is rejected → keeps hardcoded family literal", () => {
  // fixture sonnet is deliberately 3x the literal → guard must keep MODEL_RATES.sonnet
  const r = deriveModelRates(litellmFixture);
  assert.deepEqual(r.sonnet, { fresh_input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 });
});
check("deriveModelRates: family absent from snapshot → hardcoded fallback (Haiku)", () => {
  const r = deriveModelRates(litellmFixture);
  assert.deepEqual(r.haiku, { fresh_input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 });
});
check("deriveModelRates: empty/garbage snapshot → all-hardcoded", () => {
  assert.deepEqual(deriveModelRates({}), {
    opus: { fresh_input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
    sonnet: { fresh_input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
    haiku: { fresh_input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
  });
});
check("live snapshot keeps the validated headline rates (Opus stays $5/MTok)", () => {
  // The committed snapshot (real LiteLLM) must match the hardcoded literal — if
  // upstream drifts, the guard keeps the literal, so this asserts MODEL_RATES, not raw snapshot numbers.
  assert.equal(MODEL_RATES.opus.fresh_input, 5);
  assert.equal(ratesForModel("claude-opus-4-8").fresh_input, 5);
});

console.log(`\n${passed} pricing checks passed`);
