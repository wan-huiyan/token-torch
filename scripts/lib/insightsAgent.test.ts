import assert from "node:assert/strict";
import { acceptAgentInsights } from "./insightsAgent";
import { dashboardFixture } from "./testFixtures";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

// A clean agent note — every figure ($12,679.22, 597 sessions, 95.4%) is a whitelisted
// aggregate — is accepted and returned trimmed, to be baked as insights_source:"agent".
check("a clean agent note (all numbers whitelisted) is accepted", () => {
  const md = "**Burn report 🔥**\n- Burned $12,679.22 across 597 sessions.\n- Cache ran a cozy 95.4%.\n";
  const r = acceptAgentInsights(md, dashboardFixture());
  assert.equal(r.md, md.trim());
  assert.deepEqual(r.offending, []);
});

// THE SECURITY-CRITICAL CASE: a fabricated number must NOT be accepted. md is null and the
// offending token is surfaced — generate.ts then keeps insights_source:"template", never "agent".
check("a fabricated number is REJECTED (md null + offending surfaced) — never ships as agent", () => {
  const md = "**Big week**\n- You burned $99,999 — nice run!\n";
  const r = acceptAgentInsights(md, dashboardFixture());
  assert.equal(r.md, null, "fabricated note must NOT be shippable");
  assert.ok(r.offending.includes("$99,999"), `expected $99,999 offending, got ${JSON.stringify(r.offending)}`);
});

// #37 SYMMETRY: a fabricated SUPERLATIVE with NO bad number (the vacuity case) must also be
// rejected on the agent path — md null + the offending phrase surfaced on `claims`, so the
// loud log can explain WHY it fell back to template (not a silent drop).
check("a fabricated superlative is REJECTED with the claim surfaced (symmetric with LLM path)", () => {
  const md = "**Best week ever — a record-breaking blowout!**";
  const r = acceptAgentInsights(md, dashboardFixture());
  assert.equal(r.md, null, "a superlative note must NOT ship as agent");
  assert.ok(r.claims.length > 0, `expected the superlative surfaced in claims, got ${JSON.stringify(r.claims)}`);
});

// A swapped model-version share (both shares are valid values) is caught by the #24 binding pass.
check("a swapped model_mix attribution is REJECTED (binding, not membership)", () => {
  const f = dashboardFixture();
  f.distributions.model_mix = { "claude-opus-4-8": 80, "claude-opus-4-7": 20 };
  // 80 is Opus 4.8's share; binding "Opus 4.7 80%" is a swap (80 belongs to 4.8).
  const r = acceptAgentInsights("Mix: Opus 4.7 80%, Opus 4.8 20%.", f);
  assert.equal(r.md, null);
  assert.ok(r.offending.length > 0);
});

// Absent file (null) and an empty/whitespace file both yield md null with no offending —
// generate.ts treats this exactly like a missing API key: template fallback, no error.
check("null input yields md null, no offending", () => {
  const r = acceptAgentInsights(null, dashboardFixture());
  assert.equal(r.md, null);
  assert.deepEqual(r.offending, []);
});
check("empty/whitespace input yields md null, no offending", () => {
  const r = acceptAgentInsights("   \n  ", dashboardFixture());
  assert.equal(r.md, null);
  assert.deepEqual(r.offending, []);
});

console.log(`\n${passed} insights-agent checks passed`);
