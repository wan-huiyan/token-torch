import assert from "node:assert/strict";
import { deriveShippedCalendar, shippedTier } from "./shippedCalendar";
import type { SessionRow } from "../types";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

// minimal row factory — only the fields deriveShippedCalendar reads.
const row = (start_ts: string, shipped_count?: number): SessionRow =>
  ({ id: "x", date: start_ts.slice(0, 10), project: "p", start_ts, ...(shipped_count != null ? { shipped_count } : {}) } as SessionRow);

// Build the fixture timestamp from LOCAL components so `new Date(iso).getHours()` === hh and
// the local DAY === `day` in the runner's TZ (the module buckets + classifies by LOCAL time,
// matching the Awards/punchcard convention). A naive UTC stamp would drift across local
// midnight in non-UTC TZs (e.g. 23:00Z = next local day under BST) and make assertions flaky.
const at = (day: string, hh = 12) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hh, 0, 0, 0).toISOString();
};

check("empty input → empty calendar, no fabrication", () => {
  const c = deriveShippedCalendar([]);
  assert.equal(c.hasData, false);
  assert.equal(c.weeks.length, 0);
  assert.equal(c.totalShipped, 0);
  assert.equal(c.streak, 0);
  assert.equal(c.bestDayDate, null);
});

check("sums shipped_count per local day; bestDay = max; activeDays counts shipped>0", () => {
  const c = deriveShippedCalendar([
    row(at("2026-05-11", 12), 3), // Mon
    row(at("2026-05-11", 14), 2), // same day → 5
    row(at("2026-05-12", 12), 9), // Tue
    row(at("2026-05-13", 12), 0), // Wed, shipped 0 → not active
  ]);
  assert.equal(c.totalShipped, 14);
  assert.equal(c.bestDayDate, "2026-05-12");
  assert.equal(c.maxShipped, 9);
  assert.equal(c.activeDays, 2);
});

check("weeks are 7-cell Sun→Sat columns covering the padded span", () => {
  const c = deriveShippedCalendar([row(at("2026-05-12", 12), 1)]); // a single Tuesday
  assert.ok(c.weeks.length >= 1);
  for (const w of c.weeks) assert.equal(w.length, 7);
  // the only in-range cell is the Tuesday; the rest of its week is padding
  const inRange = c.weeks.flat().filter((x) => x.inRange);
  assert.equal(inRange.length, 1);
  assert.equal(inRange[0].date, "2026-05-12");
});

check("streak counts consecutive WEEKDAYS with shipped; weekends are EXEMPT (skipped)", () => {
  // Thu 5/7, Fri 5/8 shipped; Sat 5/9 + Sun 5/10 NOT shipped (weekend, exempt);
  // Mon 5/11 shipped → streak should bridge the weekend = 3 weekdays.
  const c = deriveShippedCalendar([
    row(at("2026-05-07", 12), 2), // Thu
    row(at("2026-05-08", 12), 2), // Fri
    // 5/9 Sat, 5/10 Sun: nothing
    row(at("2026-05-11", 12), 2), // Mon
  ]);
  assert.equal(c.streak, 3, "weekend gap must not break the streak");
});

check("a WEEKDAY with zero shipped DOES break the streak", () => {
  // Mon 5/11 shipped, Tue 5/12 NOT shipped, Wed 5/13 shipped → current streak (from Wed) = 1.
  const c = deriveShippedCalendar([
    row(at("2026-05-11", 12), 2), // Mon
    row(at("2026-05-13", 12), 2), // Wed (Tue missing)
  ]);
  assert.equal(c.streak, 1, "a missed weekday breaks the streak");
});

check("lateSessions is a per-day COUNT of 21:00–05:59 starts (local), and a window total", () => {
  const c = deriveShippedCalendar([
    row(at("2026-05-11", 23), 1), // 11pm → late
    row(at("2026-05-11", 2), 1),  // 2am → late
    row(at("2026-05-11", 13), 1), // 1pm → not late
  ]);
  const mon = c.weeks.flat().find((x) => x.date === "2026-05-11")!;
  assert.equal(mon.lateSessions, 2);
  assert.equal(c.lateSessions, 2);
});

check("weekendDaysWorked counts distinct Sat/Sun days with any session", () => {
  const c = deriveShippedCalendar([
    row(at("2026-05-09", 12), 0), // Sat (worked, shipped 0)
    row(at("2026-05-10", 12), 5), // Sun
    row(at("2026-05-11", 12), 5), // Mon (not weekend)
  ]);
  assert.equal(c.weekendDaysWorked, 2);
});

check("shippedTier scales RELATIVE to max (not fixed thresholds)", () => {
  assert.equal(shippedTier(0, 304), 0);   // honest empty
  assert.equal(shippedTier(304, 304), 4); // the busiest day = top tier
  assert.equal(shippedTier(76, 304), 1);  // 25% → tier 1
  assert.equal(shippedTier(160, 304), 3); // ~53% → tier 3
  // a small absolute count is NOT auto-top-tier when the window max is large
  assert.ok(shippedTier(8, 304) < 4, "fixed thresholds would have made 8 the top tier");
});

console.log(`\n${passed} shippedCalendar checks passed`);
