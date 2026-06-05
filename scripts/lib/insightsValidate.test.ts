import assert from "node:assert/strict";
import type { DashboardData } from "../../src/types";
import { allowedNumbers, validateInsightNumbers } from "./insightsValidate";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

/** Minimal DashboardData fixture exercising the whitelist fields. */
function fixture(): DashboardData {
  return {
    meta: {
      generated_at: "2026-06-01T12:00:00.000Z",
      schema_version: "tracker-1.0",
      session_count: 597,
      file_count: 800,
      project_count: 12,
      date_range: { from: "2026-05-01", to: "2026-06-01" },
      small_n: false,
      fidelity_note: "",
      floor: { discovered: 1477, kept: 597, dropped: 880, dropped_with_usage: 597, dropped_with_usage_usd: 305.56 },
    },
    totals: {
      cost_usd: 12679.22,
      floored_usd: 305.56,
      complete_spend_usd: 12984.78,
      cost_by_fidelity: { high: 12000, main_loop: 679.22 },
      active_minutes: 6000,
      active_hours: 100,
      idle_minutes: 1200,
      idle_hours: 20,
      sessions: 597,
      subagent_dispatches: 42,
      cost_per_active_min: 2.11,
      avg_cache_hit_pct: 95.4,
      tokens: { input_fresh: 1000000, cache_read: 9000000, output: 500000 },
      time_saved_min: 300,
      time_saved_hours: 5,
    },
    projects: [
      { name: "alpha", cost_usd: 8000, sessions: 200, active_min: 3000, cost_share: 0.63, cost_per_session: 40 },
      { name: "beta", cost_usd: 2000, sessions: 100, active_min: 1500, cost_share: 0.16, cost_per_session: 20 },
    ],
    timeline: [],
    sessions: [],
    distributions: { model_mix: { "claude-opus-4-8": 80, "claude-sonnet-4-6": 20 }, tools_aggregate: {}, time_split: { active_min: 6000, idle_min: 1200 } },
    flags: [],
    insights_md: null,
  };
}

// --- allowedNumbers draws from aggregates, NOT sessions[] ---
check("allowedNumbers includes headline + project + floor + model_mix values", () => {
  const a = allowedNumbers(fixture());
  assert.ok(a.includes(12679.22), "cost_usd");
  assert.ok(a.includes(12984.78), "complete_spend_usd");
  assert.ok(a.includes(8000), "project cost");
  // cost_share*100 is float-fragile (0.63*100 may be 63.00000000000001) — round-tolerant:
  assert.ok(a.some((n) => Math.round(n) === 63), "cost_share*100");
  assert.ok(a.includes(305.56), "floored_usd / floor.dropped_with_usage_usd");
  assert.ok(a.includes(80), "model_mix percent");
});

// --- exact match passes ---
check("exact figure validates", () => {
  const r = validateInsightNumbers("Total spend is $12,679.22 across 597 sessions.", fixture());
  assert.deepEqual(r.offending, []);
  assert.equal(r.ok, true);
});

// --- rounded-dollar match passes (usd() rounds to 0 decimals) ---
check("rounded dollar 12,985 validates against 12984.78 within tolerance", () => {
  // complete_spend_usd 12984.78 → prose "$12,985"; Math.round both = 12985.
  const r = validateInsightNumbers("Complete spend ≈ $12,985.", fixture());
  assert.deepEqual(r.offending, []);
});

// --- percentage match passes ---
check("cache-hit percentage validates", () => {
  const r = validateInsightNumbers("Cache hit averaged 95.4%.", fixture());
  assert.deepEqual(r.offending, []);
});
check("project cost_share percentage validates", () => {
  // 0.63 * 100 = 63; prose "63%".
  const r = validateInsightNumbers("alpha is 63% of spend.", fixture());
  assert.deepEqual(r.offending, []);
});

// --- a fabricated number is flagged ---
check("a fabricated figure is flagged as offending", () => {
  const r = validateInsightNumbers("You spent $99,999 last week.", fixture());
  assert.equal(r.ok, false);
  assert.deepEqual(r.offending, ["$99,999"]);
});
check("a fabricated percentage is flagged", () => {
  // Use 37% — 37 matches no allowed value (nearest is 40); NOT 12 (project_count=12 IS allowed).
  const r = validateInsightNumbers("Cache hit was 37%.", fixture());
  assert.equal(r.ok, false);
  assert.deepEqual(r.offending, ["37%"]);
});

// --- date label tokens are NOT flagged ---
check("dated label year token does not flag", () => {
  const r = validateInsightNumbers("**This week (auto-generated, 2026-06-01):**", fixture());
  // 2026 is a year (skipped); 06 and 01 round to 6 and 1 — must be allowed or flagged.
  // 1 == project beta count? No. But session/project counts: project_count=12, none is 1.
  // To keep this fixture's label clean, the prose below avoids bare 1/6; assert year skipped:
  assert.ok(!r.offending.includes("2026"));
});

// --- empty prose is trivially ok ---
check("prose with no numbers is ok", () => {
  const r = validateInsightNumbers("Cache hygiene looks healthy; no action needed.", fixture());
  assert.deepEqual(r.offending, []);
  assert.equal(r.ok, true);
});

// --- #9 hardening (1): scale-suffix leak. A scaled figure whose MANTISSA collides
// with a whitelisted aggregate must NOT pass — the validator scales k/K/M/B before
// matching. fixture() whitelists 5 (time_saved_hours), 40 (alpha cost_per_session),
// 80 (model_mix %), so each of these would have slipped through pre-fix. ---
check("scale-suffix $5M is rejected despite mantissa 5 being whitelisted", () => {
  const r = validateInsightNumbers("Spend hit $5M.", fixture());
  assert.equal(r.ok, false);
  assert.ok(r.offending.includes("$5M"), `expected $5M offending, got ${JSON.stringify(r.offending)}`);
});
check("scale-suffix $40K is rejected despite mantissa 40 being whitelisted", () => {
  const r = validateInsightNumbers("Burned $40K this week.", fixture());
  assert.equal(r.ok, false);
  assert.ok(r.offending.includes("$40K"), `expected $40K offending, got ${JSON.stringify(r.offending)}`);
});
check("scale-suffix 80B is rejected despite mantissa 80 being whitelisted", () => {
  const r = validateInsightNumbers("Processed 80B tokens.", fixture());
  assert.equal(r.ok, false);
  assert.ok(r.offending.includes("80B"), `expected 80B offending, got ${JSON.stringify(r.offending)}`);
});
// --- and the SAFE direction: a scaled figure that DOES match an aggregate still passes.
// fixture cache_read = 9,000,000 → "9M" scales to 9e6 and matches exactly. ---
check("scaled 9M still validates against the 9,000,000 cache_read aggregate", () => {
  const r = validateInsightNumbers("Cache read ~9M tokens.", fixture());
  assert.deepEqual(r.offending, [], `9M should match cache_read 9,000,000`);
  assert.equal(r.ok, true);
});
// --- #9 hardening (1b): leading-dot leak. ".5%" tokenised to "5" pre-fix; 5 is
// whitelisted so it slipped through. Post-fix it parses to 0.5 (not whitelisted). ---
check("leading-dot .5% is rejected despite mantissa 5 being whitelisted", () => {
  const r = validateInsightNumbers("Idle was .5% of the time.", fixture());
  assert.equal(r.ok, false);
  assert.ok(r.offending.includes(".5%"), `expected .5% offending, got ${JSON.stringify(r.offending)}`);
});

// --- #9 hardening (2): non-vacuity guard. The whitelist must draw from DASHBOARD
// AGGREGATES ONLY, never sessions[]. A number present in a session but in no aggregate
// must be REJECTED. If a future PR adds s.cost_usd to allowedNumbers(), this reddens. ---
function fixtureWithSession(): DashboardData {
  const f = fixture();
  f.sessions = [
    {
      id: "sx", date: "2026-05-15", project: "alpha", cost_usd: 777.77, cost_main: 777.77,
      cost_sub: 0, active_min: 9, idle_min: 1, cache_pct: 90, subagents: 0, model: "opus",
      fidelity: "main_loop", top_tools: {}, detail_href: "sessions/sx",
    },
  ];
  return f;
}
check("a session-only number ($777.77) is NOT whitelisted (allowedNumbers is aggregate-only)", () => {
  const f = fixtureWithSession();
  assert.ok(
    !allowedNumbers(f).some((n) => Math.round(n) === 778),
    "777.77 must not appear in the whitelist — it lives only in sessions[]",
  );
  const r = validateInsightNumbers("One session alone cost $777.77.", f);
  assert.equal(r.ok, false);
  assert.ok(r.offending.includes("$777.77"), `expected $777.77 offending, got ${JSON.stringify(r.offending)}`);
});

// --- #24 PCN first cut: model_mix version shares must bind to the RIGHT version. ---
// matchesAllowed only checks a value exists SOMEWHERE in the allow-set, so a SWAPPED
// attribution (where both shares are valid values) sails through the whitelist scan.
// The binding check ties each model-version LABEL to its OWN share (per-claim). The
// swap fixture is the discriminating test: correct-order passes, swapped-order is
// flagged — and BOTH values are whitelisted, so it REDs on pre-#24 code (proving
// entity-BINDING, not mere membership). Own fixture data; distinct, unambiguous shares.
function mixFixture(): DashboardData {
  const f = fixture();
  f.distributions.model_mix = { "claude-opus-4-8": 70, "claude-opus-4-7": 25, "claude-sonnet-4-6": 5 };
  return f;
}

check("correct-order model_mix prose validates (per-claim binding holds)", () => {
  const r = validateInsightNumbers("Model mix: Opus 4.8 70%, Opus 4.7 25%, Sonnet 4.6 5%.", mixFixture());
  assert.deepEqual(r.offending, []);
  assert.equal(r.ok, true);
});

check("swapped model_mix attribution is flagged (both 70 & 25 whitelisted → binding, not membership)", () => {
  const r = validateInsightNumbers("Model mix: Opus 4.8 25%, Opus 4.7 70%, Sonnet 4.6 5%.", mixFixture());
  assert.equal(r.ok, false);
  assert.ok(r.offending.some((o) => /Opus 4\.8\D*25/.test(o)), `expected Opus 4.8↔25 flagged, got ${JSON.stringify(r.offending)}`);
});

// The live arcade voice BOLDS the numbers ("Opus 4.7 **74.75%**"); the binding must
// fire THROUGH the markdown emphasis or it is vacuous on real prose. Real format below.
check("real bolded arcade prose binds through markdown and passes (non-vacuous on live format)", () => {
  const f = fixture();
  f.distributions.model_mix = { "claude-opus-4-7": 74.75, "claude-opus-4-8": 20.13, "claude-sonnet-4-6": 5.12 };
  const r = validateInsightNumbers("🌙 Model mix: Opus 4.7 **74.75%**, Opus 4.8 **20.13%**, Sonnet 4.6 **5.12%**.", f);
  assert.deepEqual(r.offending, []);
  assert.equal(r.ok, true);
});

check("real bolded prose with a SWAPPED share is flagged (binding fires through markdown bold)", () => {
  const f = fixture();
  f.distributions.model_mix = { "claude-opus-4-7": 74.75, "claude-opus-4-8": 20.13, "claude-sonnet-4-6": 5.12 };
  const r = validateInsightNumbers("🌙 Model mix: Opus 4.7 **20.13%**, Opus 4.8 **74.75%**, Sonnet 4.6 **5.12%**.", f);
  assert.equal(r.ok, false);
  assert.ok(r.offending.some((o) => /Opus 4\.7\D*20\.13/.test(o)), `expected Opus 4.7↔20.13 flagged, got ${JSON.stringify(r.offending)}`);
});

// Deliberate fail-OPEN on UNBOUND numbers: no tight "Label N%" adjacency → the per-claim
// check does not fire (70 & 5 still pass the whitelist scan). This is the defense-in-depth
// limitation AND the guarantee that the binding adds no false positives → no generate:verify
// regression on legitimately loose arcade phrasing.
// The live arcade voice uses SHORT connectors ("Opus 4.7 AT 74.35%", "Opus 4.7: 74%").
// The binding must span a short non-digit gap or it is vacuous on real prose (observed
// 2026-06-03: a fresh generation wrote "Opus 4.7 at 74.35%"). Swap-with-connector REDs
// on tight-adjacency-only code.
check("swapped attribution with an 'at' connector is flagged (binding spans short connectors)", () => {
  const r = validateInsightNumbers("Model mix: Opus 4.8 at 25%, Opus 4.7 at 70%, Sonnet 4.6 at 5%.", mixFixture());
  assert.equal(r.ok, false);
  assert.ok(r.offending.some((o) => /Opus 4\.8\D*25/.test(o)), `expected Opus 4.8↔25 flagged, got ${JSON.stringify(r.offending)}`);
});

check("loose (unbound) model_mix phrasing is NOT flagged (fail-open; no generate:verify regression)", () => {
  const r = validateInsightNumbers("Opus 4.8 led the mix this week; the long tail sat near 5%, the leader around 70%.", mixFixture());
  assert.deepEqual(r.offending, []);
  assert.equal(r.ok, true);
});

// The gap must NOT cross to a DIFFERENT model's number: cache-hit % sitting well past the
// label (long gap) stays unbound (no false positive); a model label adjacent to a
// non-share % within the gap binds to its OWN share and flags the mismatch.
check("a far-away non-share percentage is not mis-bound to a model label (bounded gap)", () => {
  const r = validateInsightNumbers("Opus 4.8 carried 70% of the mix; separately, cache hit ran at 95.4%.", mixFixture());
  // 70 is Opus 4.8's share (bound, ok); 95.4 is avg_cache_hit_pct (whitelisted) and is
  // NOT within the bounded gap of any model label → not bound, not flagged.
  assert.deepEqual(r.offending, []);
  assert.equal(r.ok, true);
});

// Binding owns SWAPS (valid-but-misattributed), not arbitrary numbers: a non-share % sitting
// adjacent to a model label (e.g. cache-hit %) must NOT flag — only a value that IS ANOTHER
// model's share is a swap. (A value matching no share is "fabricated" and already owned by the
// whitelist scan.) Without this, the wide gap false-positives on legit "Opus 4.8 at 95.4%
// cache hit" prose → silent template fallback. REDs on a bound-≠-own-share-only check.
check("a non-share % adjacent to a model label is NOT flagged (binding owns swaps, not arbitrary numbers)", () => {
  const r = validateInsightNumbers("Opus 4.8 at 95.4% cache hit; the mix held at 70%.", mixFixture());
  assert.deepEqual(r.offending, []);
  assert.equal(r.ok, true);
});

// ============================================================================
// #37 Part A — qualitative-claim detection (vacuity). HARD RULES 2 & 5 forbid model
// performance COMPARISON + SUPERLATIVES + causal language; validateInsightNumbers must
// ENFORCE them server-side, not merely request them in the prompt. A fabricated
// superlative (even WITH a valid number) must NOT wear the "agent"/"llm" trust badge.
// Offenders surface on a NEW `claims` field (numbers stay on `offending`).
// ============================================================================

check("a hype superlative WITH a valid number is rejected (claims, not numbers)", () => {
  // $12,679.22 is whitelisted (cost_usd) so the NUMBER passes; the offense is "Best…ever"
  // + "record-breaking" + "blowout" — proving the naive '≥1 number' guard wouldn't catch it.
  const r = validateInsightNumbers("**Best week ever — a record-breaking $12,679.22 blowout!**", fixture());
  assert.equal(r.ok, false);
  assert.ok(r.claims.length > 0, `expected a qualitative-claim flag, got ${JSON.stringify(r.claims)}`);
  assert.deepEqual(r.offending, [], "the number $12,679.22 is whitelisted — the offense is the superlative, not the number");
});

check("a model performance comparison is rejected (Rule 2: breakdown not comparison)", () => {
  const r = validateInsightNumbers("Opus 4.8 was faster and better than Opus 4.7 this week.", fixture());
  assert.equal(r.ok, false);
  assert.ok(r.claims.some((c) => /faster|better/i.test(c)), `expected faster/better flagged, got ${JSON.stringify(r.claims)}`);
});

check("causal language is rejected (Rule 5: no 'because'/'caused')", () => {
  const r = validateInsightNumbers("Spend climbed because of heavy subagent fan-out.", fixture());
  assert.equal(r.ok, false);
  assert.ok(r.claims.some((c) => /because/i.test(c)), `expected because flagged, got ${JSON.stringify(r.claims)}`);
});

check("a number-free superlative is rejected (the original vacuity case)", () => {
  const r = validateInsightNumbers("**Best week ever!**", fixture());
  assert.equal(r.ok, false);
  assert.ok(r.claims.length > 0);
});

// FALSE-POSITIVE GUARDS — factual cost/size rankings + arcade voice MUST pass. The live
// template writes "your priciest project"; insights.ts writes "sessions on record"; the
// live arcade voice writes "Opus 4.8 led the mix". None are forbidden value judgments.
check("a factual cost/size ranking (priciest/biggest/most) is NOT flagged", () => {
  const r = validateInsightNumbers("🔥 alpha is the priciest project — the biggest at 63% of spend, burning the most coins.", fixture());
  assert.deepEqual(r.claims, [], `factual rankings must pass, got ${JSON.stringify(r.claims)}`);
  assert.equal(r.ok, true);
});
check("playful arcade voice with 'led the mix' / 'on record' is NOT flagged (template-safe)", () => {
  const r = validateInsightNumbers("Opus 4.8 led the mix; only 597 sessions on record, with 100h of active time.", mixFixture());
  assert.deepEqual(r.claims, []);
  assert.equal(r.ok, true);
});

// ============================================================================
// #37 Part B — unit-aware matchesAllowed. The whitelist co-mingles dollars, percents,
// counts, minutes & tokens as bare numbers, so a fabricated PERCENT used to match a
// DOLLAR value of the same magnitude (cross-unit membership). A $-token must match only
// dollar-unit values; a %-token only percent-unit values; a bare token stays permissive.
// ============================================================================

function unitFixture(): DashboardData {
  const f = fixture();
  // alpha gets a $50/session figure → a DOLLAR-unit allowed value of 50; NO percent equals 50.
  f.projects = [{ name: "alpha", cost_usd: 8000, sessions: 160, active_min: 3000, cost_share: 0.63, cost_per_session: 50 }];
  return f;
}

check("a fabricated 50% is rejected even though $50 is a whitelisted dollar value (unit-aware)", () => {
  const f = unitFixture();
  assert.ok(allowedNumbers(f).includes(50), "precondition: 50 IS in the allow-set, but as a DOLLAR value");
  const r = validateInsightNumbers("Cache efficiency hit 50%.", f);
  assert.equal(r.ok, false, "50% must NOT match the $50 dollar value (cross-unit membership was the bug)");
  assert.ok(r.offending.includes("50%"), `expected 50% offending, got ${JSON.stringify(r.offending)}`);
});

check("the same $50 dollar token still validates (match within dollar unit)", () => {
  const r = validateInsightNumbers("That's about $50 per session.", unitFixture());
  assert.deepEqual(r.offending, []);
  assert.equal(r.ok, true);
});

console.log(`\n${passed} insights-validate checks passed`);
