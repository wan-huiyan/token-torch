import assert from "node:assert/strict";
import { deriveCatalogSavings } from "./catalogSavings";
import type { CatalogSnapshot } from "./catalogSnapshot";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

const snaps: CatalogSnapshot[] = [
  { date: "2026-06-04", total_skills: 900, hidden_count: 404, per_injection_tokens: 1000 },
  { date: "2026-06-06", total_skills: 910, hidden_count: 436, per_injection_tokens: 2000 },
];

check("deriveCatalogSavings: hold-last per-injection × daily injections; cumulative = running sum", () => {
  const injByDay = new Map<string, number>([
    ["2026-06-04", 3],
    ["2026-06-05", 2],
    ["2026-06-06", 4],
  ]);
  const floorsByDay = new Map<string, number[]>([
    ["2026-06-04", [30000, 50000]],
    ["2026-06-06", [20000]],
  ]);
  const cs = deriveCatalogSavings(snaps, injByDay, floorsByDay, { date: "2026-06-04", label: "404-flip" });
  assert.deepEqual(cs.daily.map((d) => d.est_saving_tokens), [3000, 2000, 8000]);
  assert.deepEqual(cs.daily.map((d) => d.date), ["2026-06-04", "2026-06-05", "2026-06-06"]);
  assert.equal(cs.daily[0].observed_floor, 40000);
  assert.equal(cs.daily[1].observed_floor, 0);
  assert.equal(cs.daily[2].observed_floor, 20000);
  assert.equal(cs.cumulative_tokens, 13000);
  assert.equal(cs.hidden_count, 436);
  assert.equal(cs.total_skills, 910);
  assert.equal(cs.per_injection_tokens, 2000);
  assert.equal(cs.flip_marker?.date, "2026-06-04");
  assert.equal(cs.est_usd, 0.01); // 13000 × opus cache_read $0.5/MTok = 0.0065 → round2 0.01
  assert.match(cs.note, /[Ee]stimate/);
});

check("deriveCatalogSavings: empty snapshots → empty daily, zero headline (panel hides)", () => {
  const cs = deriveCatalogSavings([], new Map(), new Map(), undefined);
  assert.deepEqual(cs.daily, []);
  assert.equal(cs.cumulative_tokens, 0);
  assert.equal(cs.hidden_count, 0);
  assert.equal(cs.per_injection_tokens, 0);
  assert.equal(cs.est_usd, 0);
});

check("deriveCatalogSavings: days before the first snapshot contribute 0 (no fabricated backfill)", () => {
  const injByDay = new Map<string, number>([
    ["2026-06-01", 5],
    ["2026-06-04", 3],
  ]);
  const cs = deriveCatalogSavings(snaps, injByDay, new Map(), undefined);
  const d0601 = cs.daily.find((d) => d.date === "2026-06-01")!;
  assert.equal(d0601.est_saving_tokens, 0);
  assert.equal(cs.cumulative_tokens, 3000);
});

check("deriveCatalogSavings: correct for UNSORTED snapshot input (defensive sort)", () => {
  const unsorted: CatalogSnapshot[] = [snaps[1], snaps[0]]; // 06-06 then 06-04
  const injByDay = new Map<string, number>([
    ["2026-06-04", 3], // hold-last 1000 → 3000
    ["2026-06-06", 4], // hold-last 2000 → 8000
  ]);
  const cs = deriveCatalogSavings(unsorted, injByDay, new Map(), undefined);
  assert.deepEqual(cs.daily.map((d) => d.est_saving_tokens), [3000, 8000]);
  assert.equal(cs.hidden_count, 436); // latest = 06-06 even though passed first
});

console.log(`\n${passed} catalogSavings checks passed`);
