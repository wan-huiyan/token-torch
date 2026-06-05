import assert from "node:assert/strict";
import { orphanSessionIds } from "./orphans";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

// orphanSessionIds(diskFiles, keptIds) → the session ids on disk that are NOT in the current
// kept set. The #22 investigation: orphans are sessions whose source transcripts were deleted /
// rotated out of ~/.claude/projects — monotonic, never returning — so they are safe to prune.

check("returns on-disk ids that are not in the kept set", () => {
  const disk = ["aaa.json", "bbb.json", "ccc.json"];
  const orphans = orphanSessionIds(disk, new Set(["aaa", "ccc"]));
  assert.deepEqual(orphans, ["bbb"]);
});

check("kept ids are never returned", () => {
  const disk = ["aaa.json", "bbb.json"];
  assert.deepEqual(orphanSessionIds(disk, new Set(["aaa", "bbb"])), []);
});

check("ignores non-.json files on disk", () => {
  const disk = ["aaa.json", ".DS_Store", "notes.txt", "bbb.json"];
  assert.deepEqual(orphanSessionIds(disk, new Set(["aaa"])), ["bbb"]);
});

check("empty disk yields no orphans", () => {
  assert.deepEqual(orphanSessionIds([], new Set(["aaa"])), []);
});

check("accepts a plain array for keptIds too", () => {
  assert.deepEqual(orphanSessionIds(["aaa.json", "bbb.json"], ["aaa"]), ["bbb"]);
});

check("an empty kept set makes every on-disk json an orphan", () => {
  assert.deepEqual(orphanSessionIds(["aaa.json", "bbb.json"], new Set()), ["aaa", "bbb"]);
});

console.log(`\n${passed} orphans checks passed`);
