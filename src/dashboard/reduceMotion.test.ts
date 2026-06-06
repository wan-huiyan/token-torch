import assert from "node:assert/strict";

/* Stub the browser globals BEFORE importing reduceMotion so its localStorage /
 * document guards see them. The module reads localStorage once at import for its
 * initial value (none set here → false). */
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;
const classes = new Set<string>();
(globalThis as unknown as { document: { body: { classList: DOMTokenList } } }).document = {
  body: {
    classList: {
      toggle: (c: string, on?: boolean) => {
        const next = on ?? !classes.has(c);
        if (next) classes.add(c);
        else classes.delete(c);
        return next;
      },
    } as unknown as DOMTokenList,
  },
};

const { getReduceMotion, setReduceMotion, subscribeReduceMotion, _resetForTest } = await import("./reduceMotion");
const { isReduced } = await import("./motionRegistry");

let passed = 0;
const check = (name: string, fn: () => void) => {
  _resetForTest();
  classes.clear();
  store.clear();
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

check("defaults to animated (getReduceMotion false)", () => {
  assert.equal(getReduceMotion(), false);
});

check("setReduceMotion(true) flips the store, registry, body class, and persists", () => {
  setReduceMotion(true);
  assert.equal(getReduceMotion(), true);
  assert.equal(isReduced(), true, "canvas registry must see reduced");
  assert.ok(classes.has("tt-reduced"), "body must get .tt-reduced");
  assert.equal(store.get("tt-reduce-motion"), "1", "must persist '1'");
});

check("setReduceMotion(false) restores motion across all three + persists '0'", () => {
  setReduceMotion(true);
  setReduceMotion(false);
  assert.equal(getReduceMotion(), false);
  assert.equal(isReduced(), false);
  assert.ok(!classes.has("tt-reduced"));
  assert.equal(store.get("tt-reduce-motion"), "0");
});

check("subscribers fire on a real change", () => {
  let n = 0;
  const unsub = subscribeReduceMotion(() => n++);
  setReduceMotion(true);
  assert.equal(n, 1);
  unsub();
});

check("setting the SAME value is a no-op (no notify)", () => {
  let n = 0;
  subscribeReduceMotion(() => n++);
  setReduceMotion(false); // already false
  assert.equal(n, 0, "no notification when value is unchanged");
});

check("unsubscribe stops notifications", () => {
  let n = 0;
  const unsub = subscribeReduceMotion(() => n++);
  setReduceMotion(true);
  unsub();
  setReduceMotion(false);
  assert.equal(n, 1, "only the pre-unsub change is observed");
});

console.log(`\n${passed} reduceMotion checks passed`);
