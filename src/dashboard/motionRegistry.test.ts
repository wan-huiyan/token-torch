import assert from "node:assert/strict";
import {
  initReduced,
  isReduced,
  trackAnimation,
  applyReducedMotion,
  _activeCount,
  _resetForTest,
} from "./motionRegistry";

let passed = 0;
const check = (name: string, fn: () => void) => {
  _resetForTest();
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

check("isReduced() defaults to false before init", () => {
  assert.equal(isReduced(), false);
});

check("initReduced seeds the live preference", () => {
  initReduced(true);
  assert.equal(isReduced(), true);
  initReduced(false);
  assert.equal(isReduced(), false);
});

check("applyReducedMotion(true) flips the live preference", () => {
  assert.equal(isReduced(), false);
  applyReducedMotion(true);
  assert.equal(isReduced(), true);
});

check("on flip-to-reduce every tracked stop fires exactly once and the registry drains", () => {
  let a = 0;
  let b = 0;
  trackAnimation(() => a++);
  trackAnimation(() => b++);
  assert.equal(_activeCount(), 2);
  applyReducedMotion(true);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(_activeCount(), 0, "registry drains so a stop fn never fires twice");
});

check("flip-to-motion does NOT fire stops and does NOT auto-restart (teardown-only)", () => {
  let calls = 0;
  trackAnimation(() => calls++);
  applyReducedMotion(false);
  assert.equal(calls, 0, "no teardown on motion-restored");
  assert.equal(isReduced(), false);
  assert.equal(_activeCount(), 1, "the loop stays tracked; nothing was torn down");
});

check("the unregister handle removes a stop so it never fires on a later reduce", () => {
  let calls = 0;
  const untrack = trackAnimation(() => calls++);
  assert.equal(_activeCount(), 1);
  untrack();
  assert.equal(_activeCount(), 0);
  applyReducedMotion(true);
  assert.equal(calls, 0, "an unmounted loop's stop must not be called by a later toggle");
});

check("a throwing stop fn does not block the other registered stops", () => {
  let after = 0;
  trackAnimation(() => {
    throw new Error("boom");
  });
  trackAnimation(() => after++);
  applyReducedMotion(true); // must not throw
  assert.equal(after, 1, "the second stop still runs despite the first throwing");
  assert.equal(_activeCount(), 0);
});

check("second flip-to-reduce drains nothing new (idempotent, no double-stop)", () => {
  let calls = 0;
  trackAnimation(() => calls++);
  applyReducedMotion(true);
  assert.equal(calls, 1);
  applyReducedMotion(true); // already reduced + drained
  assert.equal(calls, 1, "stop fns are not re-invoked on a repeated reduce");
});

check("a loop tracked AFTER reduce is already active can still be torn down by a fresh toggle", () => {
  applyReducedMotion(true); // reduce now
  let calls = 0;
  // suppress-new lives in spriteEngine (mounts gate on isReduced); but if something
  // does track while reduced, a subsequent re-assert of reduce must still drain it.
  trackAnimation(() => calls++);
  applyReducedMotion(true);
  assert.equal(calls, 1);
});

console.log(`\n${passed} motionRegistry checks passed`);
