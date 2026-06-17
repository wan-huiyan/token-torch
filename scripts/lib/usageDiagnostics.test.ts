/* Tests for the #75 usage-diagnostics derivation. Run: tsx scripts/lib/usageDiagnostics.test.ts */
import assert from "node:assert/strict";
import { deriveUsageDiagnostics, type UsageSession, HEAVY_CONTEXT_THRESHOLD } from "./usageDiagnostics";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

const MIN = 60_000;
/** dense per-minute timestamps from a..b minutes inclusive (gaps < 5min → one segment). */
const span = (a: number, b: number): number[] => {
  const t: number[] = [];
  for (let m = a; m <= b; m++) t.push(m * MIN);
  return t;
};
const sess = (over: Partial<UsageSession>): UsageSession => ({
  timestampsMs: [], totalBilledTokens: 0, heavyContextTokens: 0, peakContextTokens: 0,
  subagentTokens: 0, subagentCount: 0, ...over,
});
const driver = (d: ReturnType<typeof deriveUsageDiagnostics>, key: string) =>
  d.drivers.find((x) => x.key === key)!;

check("empty → all four drivers present, shares 0 or null, nothing fabricated", () => {
  const d = deriveUsageDiagnostics([]);
  assert.equal(d.drivers.length, 4);
  assert.equal(driver(d, "subagents").share_pct, 0);
  assert.equal(driver(d, "heavy_context").share_pct, 0);
  assert.equal(driver(d, "parallel").share_pct, 0);
  assert.equal(driver(d, "attribution").share_pct, null, "attribution is UNKNOWN, never fabricated");
  assert.equal(d.peak_concurrency, 0);
});

check("attribution is ALWAYS unknown (null), regardless of data", () => {
  const d = deriveUsageDiagnostics([sess({ totalBilledTokens: 1_000_000, subagentTokens: 500_000, subagentCount: 5 })]);
  assert.equal(driver(d, "attribution").share_pct, null);
});

check("subagent share = subagentTokens / (main billed + subagent tokens)", () => {
  const d = deriveUsageDiagnostics([
    sess({ totalBilledTokens: 750_000, subagentTokens: 250_000, subagentCount: 3 }),
  ]);
  // 250k / (750k + 250k) = 25%
  assert.equal(driver(d, "subagents").share_pct, 25);
});

check("heavy-context share = Σ heavyContextTokens / grand total; counts sessions over the threshold", () => {
  const d = deriveUsageDiagnostics([
    sess({ totalBilledTokens: 800_000, heavyContextTokens: 600_000, peakContextTokens: HEAVY_CONTEXT_THRESHOLD + 1 }),
    sess({ totalBilledTokens: 200_000, heavyContextTokens: 0, peakContextTokens: 50_000 }),
  ]);
  // 600k / 1.0M = 60%; one session over threshold
  assert.equal(driver(d, "heavy_context").share_pct, 60);
  assert.ok(driver(d, "heavy_context").detail.includes("1 session"), "names the 1 heavy session");
});

check("concurrency: 4 fully-overlapping sessions → peak 4, 100% at threshold, 4 sessions", () => {
  const d = deriveUsageDiagnostics([0, 1, 2, 3].map(() => sess({ timestampsMs: span(0, 10) })));
  assert.equal(d.peak_concurrency, 4);
  assert.equal(driver(d, "parallel").share_pct, 100);
  assert.ok(driver(d, "parallel").detail.includes("4 session"));
});

check("concurrency: 3 overlapping sessions stay BELOW the 4+ threshold → 0% share", () => {
  const d = deriveUsageDiagnostics([0, 1, 2].map(() => sess({ timestampsMs: span(0, 10) })));
  assert.equal(d.peak_concurrency, 3);
  assert.equal(driver(d, "parallel").share_pct, 0);
});

check("gap cap: a >5min idle gap splits active time (no phantom concurrency in the gap)", () => {
  // X works [0,2] then (10-min gap) [12,14]; P/Q/R work only [0,2].
  // → conc 4 during [0,2] only; X alone during [12,14]. active = 2min + 2min = 4min; ge4 = 2min.
  const X = sess({ timestampsMs: [...span(0, 2), ...span(12, 14)] });
  const P = sess({ timestampsMs: span(0, 2) });
  const Q = sess({ timestampsMs: span(0, 2) });
  const R = sess({ timestampsMs: span(0, 2) });
  const d = deriveUsageDiagnostics([X, P, Q, R]);
  assert.equal(d.peak_concurrency, 4);
  assert.equal(driver(d, "parallel").share_pct, 50, "2min of 4min total active is at 4+");
});

check("single-event sessions contribute no active time (no zero-length phantom segments)", () => {
  const d = deriveUsageDiagnostics([0, 1, 2, 3].map(() => sess({ timestampsMs: [5 * MIN] })));
  assert.equal(d.peak_concurrency, 0);
  assert.equal(driver(d, "parallel").share_pct, 0);
});

console.log(`\nusageDiagnostics: ${passed} checks passed`);
