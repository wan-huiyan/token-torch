import assert from "node:assert/strict";
import { deriveAwards, resolveView, type Award } from "./awards";
import type { SessionRow } from "../types";

let passed = 0;
const check = (n: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${n}`); };

// minimal SessionRow factory (only the fields deriveAwards reads)
const mk = (o: Partial<SessionRow>): SessionRow => ({
  id: "s", date: "2026-06-01", project: "p", cost_usd: 0, cost_main: 0, cost_sub: 0,
  active_min: 0, idle_min: 0, cache_pct: 0, subagents: 0, model: "opus", fidelity: "high",
  top_tools: {}, detail_href: "", ...o,
});
// Build timestamps from LOCAL components so the local-hour / local-weekday logic is
// deterministic regardless of the test runner's timezone (a UTC-literal fixture would
// shift across the date/hour boundary by TZ). 2026-06-01 = Mon, 2026-06-06 = Sat.
const at = (y: number, mo: number, d: number, hh: number, mm = 0) => new Date(y, mo - 1, d, hh, mm).toISOString();
const find = (rows: SessionRow[], id: Award["id"]) => deriveAwards(rows).find((x) => x.id === id)!;

check("Real MVP = a 2-beat reveal: faux max-wall-clock → real max-active, value/unit split", () => {
  const rows = [
    mk({ id: "a", project: "alpha", active_min: 281, idle_min: 20 }),  // real champ (active 281 = 4h 41m)
    mk({ id: "b", project: "beta", active_min: 30, idle_min: 600 }),   // faux champ (wall 630, mostly idle)
  ];
  const m = find(rows, "marathon");
  assert.equal(m.reveal, true);
  assert.equal(m.beats.length, 2);
  assert.equal(m.beats[0].session!.id, "b");                 // faux first
  assert.equal(m.beats[0].unit, "wall-clock");
  assert.equal(m.beats[0].value, "10h 30m");                 // 630 min, NO unit baked into value
  assert.ok(!/wall-clock/.test(m.beats[0].value));
  assert.match(m.beats[0].comment, /wait/i);                 // faux beat calls out idle/waiting
  assert.equal(m.beats[1].session!.id, "a");                 // real second
  assert.equal(m.beats[1].unit, "active");
  assert.equal(m.beats[1].value, "4h 41m");                  // 281 min
});

check("Off-hours = adaptive: share is % of runs starting 7pm–6am; faces carry real numbers", () => {
  const rows = [
    mk({ id: "d1", start_ts: at(2026, 6, 3, 14, 0) }),       // 2pm — daytime
    mk({ id: "d2", start_ts: at(2026, 6, 3, 11, 0) }),       // 11am — daytime
    mk({ id: "eve", start_ts: at(2026, 6, 3, 21, 0) }),      // 9pm — off-hours (evening)
    mk({ id: "owl", project: "nightcrawl", start_ts: at(2026, 6, 4, 2, 2) }), // 2:02am — off-hours, deepest
  ];
  const a = find(rows, "offhours");
  assert.equal(a.adaptive, true);
  assert.equal(a.threshold, 10);
  assert.equal(a.share, 50);                                 // 2 of 4 runs in 7pm–6am
  assert.equal(a.session!.id, "owl");                        // deepest off-hours run cited
  assert.equal(a.nudge!.value, "2:02am");                    // deepest start clock
  assert.equal(a.praise!.value, "75%");                      // 100 − 25% after-midnight
  assert.equal(a.praise!.unit, "before midnight");
  assert.match(a.nudge!.comment, /7pm and 6am/);
});

check("Off-hours empty when no timestamped runs (honest blank)", () => {
  assert.equal(find([mk({})], "offhours").empty, true);
});

check("Weekend = adaptive: nudge when weekend share ≥5%, praise below, empty with no timestamps", () => {
  const heavy = [
    mk({ start_ts: at(2026, 6, 1, 10) }),                    // Mon
    mk({ id: "sat", project: "wkend", start_ts: at(2026, 6, 6, 10) }), // Sat
  ];
  const w = find(heavy, "weekend");
  assert.equal(w.adaptive, true);
  assert.equal(w.threshold, 5);
  assert.equal(w.share, 50);                                 // 1 of 2 on a weekend → nudge
  assert.equal(w.nudge!.value, "1 run");
  assert.equal(resolveView(w, "auto").face, "nudge");

  const clean = find([mk({ start_ts: at(2026, 6, 1, 10) }), mk({ start_ts: at(2026, 6, 2, 10) })], "weekend");
  assert.equal(clean.share, 0);                              // all weekday
  assert.equal(clean.praise!.value, "100%");                 // 100 − 0%
  assert.equal(resolveView(clean, "auto").face, "praise");

  assert.equal(find([mk({})], "weekend").empty, true);       // no timestamps → empty
});

check("Subagent Swarm = max subagents (value/unit split); empty when all zero", () => {
  const none = find([mk({ subagents: 0 })], "swarm");
  assert.equal(none.empty, true);
  const s = find([mk({ id: "big", subagents: 67 })], "swarm");
  assert.equal(s.swarmBg, true);
  assert.equal(s.beats[0].session!.id, "big");
  assert.equal(s.beats[0].value, "67");
  assert.equal(s.beats[0].unit, "subagents");
});

check("empty input → all four awards present, all empty (no fabrication)", () => {
  const awards = deriveAwards([]);
  assert.equal(awards.length, 4);
  assert.ok(awards.every((a) => a.empty === true));
  // resolveView renders the empty face (honest blank, dim pedestal) — never a zero
  const v = resolveView(awards[0], "auto");
  assert.equal(v.empty, true);
  assert.equal(v.block, "dim");
});

check("resolveView: reveal → isReveal/gold; adaptive forced faces override the share", () => {
  const m = resolveView(find([mk({ active_min: 5, idle_min: 1 })], "marathon"), "auto");
  assert.equal(m.isReveal, true);
  assert.equal(m.accent, "var(--gold)");
  // a heavy weekend award still flips to praise when the mode forces it
  const w = find([mk({ start_ts: at(2026, 6, 6, 10) })], "weekend"); // share 100 ≥ 5
  assert.equal(resolveView(w, "auto").face, "nudge");
  assert.equal(resolveView(w, "praise").face, "praise");
  assert.equal(resolveView(w, "nudge").face, "nudge");
});

console.log(`\n${passed} awards checks passed`);
