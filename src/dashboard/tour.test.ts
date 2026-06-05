import assert from "node:assert/strict";
import { TOUR_STEPS, TOUR_SEEN_KEY, isTourSeen, markTourSeen } from "./tour";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

const fakeStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

check("tour is 1–7 steps, each with a data-tour anchor + title + body", () => {
  assert.ok(TOUR_STEPS.length >= 1 && TOUR_STEPS.length <= 7);
  for (const s of TOUR_STEPS) {
    assert.ok(s.selector.startsWith("[data-tour="), `step ${s.id} anchors via data-tour, got ${s.selector}`);
    assert.ok(s.title.length > 0 && s.body.length > 0, `step ${s.id} has title + body`);
  }
});

check("the tour targets the honesty affordances (estimate / coverage / breakdown / tier)", () => {
  const blob = TOUR_STEPS.map((s) => `${s.id} ${s.title} ${s.body}`).join(" ").toLowerCase();
  for (const kw of ["estimate", "coverage", "breakdown", "tier"]) assert.ok(blob.includes(kw), `tour mentions ${kw}`);
});

check("isTourSeen / markTourSeen round-trip via injected storage", () => {
  const s = fakeStore();
  assert.equal(isTourSeen(s), false);
  markTourSeen(s);
  assert.equal(isTourSeen(s), true);
  assert.equal(s.getItem(TOUR_SEEN_KEY), "1");
});

console.log(`\n${passed} tour checks passed`);
