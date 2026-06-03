import assert from "node:assert/strict";
import { deriveContextOverhead } from "./contextOverhead";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

// single-model (opus, cache_read rate = $0.5/MTok). 1 model so effective == family rate.
check("deriveContextOverhead: reread = floor*turns, priced at the cache_read rate, % of total input", () => {
  const co = deriveContextOverhead({
    scaffoldingFloor: 30000,
    turnCount: 3,
    perModelTokens: { "claude-opus-4-8": { fresh_input: 6, output: 300, cache_write: 2000, cache_read: 135000 } },
    subagentScaffoldingTokens: 25000,
  });
  assert.equal(co.scaffolding_tokens, 30000);
  assert.equal(co.reread_tokens, 90000); // 30000 * 3
  assert.equal(co.subagent_scaffolding_tokens, 25000);
  // priced at opus cache_read $0.5/MTok: 90000 * 0.5 / 1e6 = 0.045 → round2 = 0.05
  assert.equal(co.reread_usd, 0.05);
  // total input-side = fresh+cw+cr = 6+2000+135000 = 137006; 90000/137006*100 = 65.69
  assert.ok(Math.abs(co.overhead_pct_of_input - 65.69) < 0.05, `pct was ${co.overhead_pct_of_input}`);
  assert.equal(co.turns, 3);
  assert.match(co.note, /[Ee]stimate/);
});

check("deriveContextOverhead: zero-turn session yields all-zero, percent 0 (no divide-by-zero)", () => {
  const co = deriveContextOverhead({ scaffoldingFloor: 0, turnCount: 0, perModelTokens: {}, subagentScaffoldingTokens: 0 });
  assert.equal(co.reread_tokens, 0);
  assert.equal(co.reread_usd, 0);
  assert.equal(co.overhead_pct_of_input, 0);
});

console.log(`\n${passed} contextOverhead checks passed`);
