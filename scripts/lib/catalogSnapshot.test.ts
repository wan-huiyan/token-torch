import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeSnapshot,
  perInjectionTokens,
  appendSnapshot,
  loadSnapshots,
  type SkillEntry,
} from "./catalogSnapshot";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

check("perInjectionTokens: Σ over hidden of (len(name)+3)/4 (bare-name floor)", () => {
  const entries: SkillEntry[] = [
    { name: "alpha", hidden: true },
    { name: "bb", hidden: true },
    { name: "visible-skill", hidden: false },
  ];
  assert.equal(perInjectionTokens(entries), 3.25);
});

check("computeSnapshot: counts total + hidden + per-injection for a date", () => {
  const entries: SkillEntry[] = [
    { name: "a", hidden: true },
    { name: "bbb", hidden: true },
    { name: "c", hidden: false },
  ];
  const snap = computeSnapshot("2026-06-06", entries);
  assert.equal(snap.date, "2026-06-06");
  assert.equal(snap.total_skills, 3);
  assert.equal(snap.hidden_count, 2);
  assert.equal(snap.per_injection_tokens, 2.5);
});

check("appendSnapshot then loadSnapshots round-trips, sorted by date", () => {
  const dir = mkdtempSync(join(tmpdir(), "cpsnap-"));
  const path = join(dir, "snaps.jsonl");
  appendSnapshot(path, { date: "2026-06-04", total_skills: 900, hidden_count: 404, per_injection_tokens: 4900 });
  appendSnapshot(path, { date: "2026-06-06", total_skills: 910, hidden_count: 436, per_injection_tokens: 5201 });
  const out = loadSnapshots(path);
  assert.equal(out.length, 2);
  assert.equal(out[0].date, "2026-06-04");
  assert.equal(out[1].hidden_count, 436);
  rmSync(dir, { recursive: true, force: true });
});

check("appendSnapshot de-dupes per calendar day (last write wins)", () => {
  const dir = mkdtempSync(join(tmpdir(), "cpsnap-"));
  const path = join(dir, "snaps.jsonl");
  appendSnapshot(path, { date: "2026-06-06", total_skills: 910, hidden_count: 430, per_injection_tokens: 5100 });
  appendSnapshot(path, { date: "2026-06-06", total_skills: 910, hidden_count: 436, per_injection_tokens: 5201 });
  const out = loadSnapshots(path);
  assert.equal(out.length, 1);
  assert.equal(out[0].hidden_count, 436);
  rmSync(dir, { recursive: true, force: true });
});

check("loadSnapshots on a missing file returns []", () => {
  assert.deepEqual(loadSnapshots(join(tmpdir(), "does-not-exist-cpsnap.jsonl")), []);
});

check("loadSnapshots skips corrupt/blank lines, keeps valid ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "cpsnap-"));
  const path = join(dir, "snaps.jsonl");
  writeFileSync(
    path,
    'not-json\n\n{"date":"2026-06-05","total_skills":905,"hidden_count":420,"per_injection_tokens":5000}\n',
  );
  const out = loadSnapshots(path);
  assert.equal(out.length, 1);
  assert.equal(out[0].date, "2026-06-05");
  assert.equal(out[0].hidden_count, 420);
  rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${passed} catalogSnapshot checks passed`);
