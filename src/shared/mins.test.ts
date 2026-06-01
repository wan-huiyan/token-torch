import assert from "node:assert/strict";
import { mins } from "./mins";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

check("carry: 719.7 rounds up across the hour boundary", () => {
  assert.equal(mins(719.7), "12h 0m");
});
check("carry: 59.7 carries into one hour", () => {
  assert.equal(mins(59.7), "1h 0m");
});
check("sub-hour value stays in minutes", () => {
  assert.equal(mins(45), "45m");
});
check("zero", () => {
  assert.equal(mins(0), "0m");
});
check("exactly one hour", () => {
  assert.equal(mins(60), "1h 0m");
});
check("hours + minutes", () => {
  assert.equal(mins(83), "1h 23m");
});

console.log(`\n${passed} checks passed (mins)`);
