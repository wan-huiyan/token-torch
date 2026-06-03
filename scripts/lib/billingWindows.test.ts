import assert from "node:assert/strict";
import { deriveBillingWindows, eventsFromRecords } from "./billingWindows";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

const H = 3_600_000, MIN = 60_000, WINDOW = 18_000_000;
const HOUR0 = 1_800_000_000_000; // UTC-hour aligned (÷3_600_000 = 500000)
const ev = (ms: number, sessionId = "s1", project = "p1") => ({ ms, sessionId, project });

check("empty events → undefined (panel hidden)", () => {
  assert.equal(deriveBillingWindows([], HOUR0), undefined);
});

check("floor-to-hour + single active window", () => {
  const e = [ev(HOUR0 + 47 * MIN), ev(HOUR0 + 47 * MIN + MIN), ev(HOUR0 + 47 * MIN + 2 * MIN)];
  const r = deriveBillingWindows(e, HOUR0 + 60 * MIN)!;
  assert.equal(r.window_count, 1);
  assert.equal(r.current.start_ms, HOUR0);               // 13:47 floored to 13:00
  assert.equal(r.current.end_ms, HOUR0 + WINDOW);
  assert.equal(r.current.active_min, 2);                 // two 60s gaps, both ≤120s
  assert.equal(r.current.event_count, 3);
  assert.equal(r.current.session_count, 1);
  assert.equal(r.current.project_count, 1);
  assert.equal(r.total_active_min, 2);
});

check("gap-split: >5h since last event opens a new window", () => {
  const e = [ev(HOUR0 + 47 * MIN), ev(HOUR0 + 47 * MIN + 6 * H)];
  const r = deriveBillingWindows(e, HOUR0 + 7 * H)!;
  assert.equal(r.window_count, 2);
  assert.equal(r.current.start_ms, HOUR0 + 6 * H);       // floor(13:47 + 6h) = 19:00
  assert.equal(r.recent.length, 2);
  assert.equal(r.recent[0].start_ms, r.current.start_ms); // most-recent first
});

check("since_start split: continuous activity >5h splits", () => {
  const e = [ev(HOUR0), ev(HOUR0 + 3 * H), ev(HOUR0 + 6 * H)];
  const r = deriveBillingWindows(e, HOUR0 + 7 * H)!;
  assert.equal(r.window_count, 2);
  assert.equal(r.recent[1].event_count, 2);              // older window: HOUR0 + (HOUR0+3h)
  assert.equal(r.current.event_count, 1);                // new window opened at +6h
  assert.equal(r.current.start_ms, HOUR0 + 6 * H);
});

check("active_min sums only ≤120s gaps; total + pace", () => {
  const e = [ev(HOUR0), ev(HOUR0 + MIN), ev(HOUR0 + 2 * MIN), ev(HOUR0 + 12 * MIN), ev(HOUR0 + 13 * MIN)];
  const r = deriveBillingWindows(e, HOUR0 + 20 * MIN)!;  // gaps: 60,60,600(idle),60 → 180s active
  assert.equal(r.window_count, 1);
  assert.equal(r.current.active_min, 3);
  assert.equal(r.total_active_min, 3);
  assert.equal(r.current.event_count, 5);
  assert.equal(r.pace_vs_busiest_pct, 100);              // current IS busiest
});

check("is_active true when now is within bounds and recent", () => {
  const e = [ev(HOUR0 + 47 * MIN), ev(HOUR0 + 48 * MIN), ev(HOUR0 + 49 * MIN)];
  const live = deriveBillingWindows(e, HOUR0 + 50 * MIN)!;     // 1m after last, < end
  assert.equal(live.current.is_active, true);
  const dead = deriveBillingWindows(e, HOUR0 + 100 * H)!;      // days later
  assert.equal(dead.current.is_active, false);
});

check("straddling session counted in both windows; busiest = max active", () => {
  const e = [
    ev(HOUR0, "s1", "p1"),
    ev(HOUR0 + 6 * H, "s1", "p1"),
    ev(HOUR0 + 6 * H + MIN, "s2", "p2"),
    ev(HOUR0 + 6 * H + 2 * MIN, "s1", "p1"),
  ];
  const r = deriveBillingWindows(e, HOUR0 + 7 * H)!;
  assert.equal(r.window_count, 2);
  assert.equal(r.recent[1].session_count, 1);            // older window: only s1
  assert.equal(r.current.session_count, 2);              // newer window: s1 + s2
  assert.equal(r.current.project_count, 2);
  assert.equal(r.current.active_min, 2);                 // two 60s gaps
  assert.equal(r.busiest.start_ms, r.current.start_ms);  // newer window is busiest
});

check("eventsFromRecords flattens timestampsMs with session/project", () => {
  const recs = [
    { id: "a1", project: "proj-a", timestampsMs: [10, 20] },
    { id: "b2", project: "proj-b", timestampsMs: [30] },
    { id: "c3", project: "proj-c" }, // no timestampsMs → contributes nothing
  ];
  const out = eventsFromRecords(recs);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { ms: 10, sessionId: "a1", project: "proj-a" });
  assert.deepEqual(out[2], { ms: 30, sessionId: "b2", project: "proj-b" });
});

console.log(`\n${passed} billingWindows checks passed`);
