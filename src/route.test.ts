import assert from "node:assert/strict";
import { parseHashString } from "./route";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

check("empty / root hash → dashboard", () => {
  assert.deepEqual(parseHashString(""), { name: "dashboard" });
  assert.deepEqual(parseHashString("#/"), { name: "dashboard" });
});
check("#/breakdown → breakdown", () => {
  assert.deepEqual(parseHashString("#/breakdown"), { name: "breakdown" });
});
check("#/about → about", () => {
  assert.deepEqual(parseHashString("#/about"), { name: "about" });
});
check("#/sessions/:id → session with decoded id", () => {
  assert.deepEqual(parseHashString("#/sessions/abc%20123"), { name: "session", id: "abc 123" });
});
check("unknown hash falls back to dashboard", () => {
  assert.deepEqual(parseHashString("#/nope"), { name: "dashboard" });
});

console.log(`\n${passed} route checks passed`);
