import assert from "node:assert/strict";
import { deriveAwards } from "./awards";
import type { SessionRow } from "../types";

let passed = 0;
const check = (n: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${n}`); };

// minimal SessionRow factory (only the fields deriveAwards reads)
const mk = (o: Partial<SessionRow>): SessionRow => ({
  id: "s", date: "2026-06-01", project: "p", cost_usd: 0, cost_main: 0, cost_sub: 0,
  active_min: 0, idle_min: 0, cache_pct: 0, subagents: 0, model: "opus", fidelity: "high",
  top_tools: {}, detail_href: "", ...o,
});

check("Real MVP = max active_min; Faux Marathon = max wall-clock with its idle share", () => {
  const rows = [
    mk({ id: "a", project: "alpha", active_min: 100, idle_min: 20 }),   // real champ (active 100)
    mk({ id: "b", project: "beta", active_min: 30, idle_min: 600 }),    // faux champ (wall 630, mostly idle)
  ];
  const awards = deriveAwards(rows);
  const marathon = awards.find((x) => x.id === "marathon")!;
  assert.equal(marathon.beats.length, 2);
  assert.equal(marathon.beats[0].session!.id, "b"); // faux first
  assert.equal(marathon.beats[1].session!.id, "a"); // real second
  assert.match(marathon.beats[0].comment, /wait/i); // faux beat calls out idle/waiting
});

check("Night Owl picks the deepest small-hours start + % after midnight", () => {
  const rows = [
    mk({ id: "day", start_ts: "2026-06-01T14:00:00Z" }),
    mk({ id: "owl", start_ts: "2026-06-02T03:30:00Z" }), // 3:30am-ish (deep night)
  ];
  const a = deriveAwards(rows).find((x) => x.id === "nightowl")!;
  assert.equal(a.empty, undefined);
  assert.equal(a.beats[0].session!.id, "owl");
});

check("Weekend Warrior counts Sat/Sun runs; empty state when none", () => {
  const weekday = deriveAwards([mk({ start_ts: "2026-06-01T10:00:00Z" })]) // 2026-06-01 = Monday
    .find((x) => x.id === "weekend")!;
  assert.equal(weekday.empty, true); // no weekend runs → honest empty
  const weekend = deriveAwards([mk({ start_ts: "2026-06-06T10:00:00Z" })]) // 2026-06-06 = Saturday
    .find((x) => x.id === "weekend")!;
  assert.equal(weekend.empty, undefined);
  assert.equal(weekend.beats[0].value, "1 run");
});

check("Subagent Swarm = max subagents; empty when all zero", () => {
  const none = deriveAwards([mk({ subagents: 0 })]).find((x) => x.id === "swarm")!;
  assert.equal(none.empty, true);
  const swarm = deriveAwards([mk({ id: "big", subagents: 42 })]).find((x) => x.id === "swarm")!;
  assert.equal(swarm.beats[0].session!.id, "big");
  assert.match(swarm.beats[0].value, /42/);
});

check("empty input → all four awards present, all empty (no fabrication)", () => {
  const awards = deriveAwards([]);
  assert.equal(awards.length, 4);
  assert.ok(awards.every((a) => a.empty === true));
});

console.log(`\n${passed} awards checks passed`);
