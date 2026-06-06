import assert from "node:assert/strict";
import { parseEffortMarker, deriveEffort, type EffortInput, type SettingsFacts } from "./effort";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

// settings.json mtime cutoff: 2026-05-29 10:33 local → use a fixed ms for tests.
const CUTOFF_MS = Date.parse("2026-05-29T10:33:00.000Z");
const settings: SettingsFacts = { settingsEffort: "high", settingsMtimeMs: CUTOFF_MS };

// --- parseEffortMarker: extract the value token, ignore "(this session only)" & detail ---
check("parseEffortMarker extracts the leading value token from the real corpus marker", () => {
  const m = parseEffortMarker("Set effort level to ultracode (this session only): xhigh + dynamic workflow orchestration");
  assert.equal(m, "ultracode");
});
check("parseEffortMarker handles a bare 'Set effort level to high'", () => {
  assert.equal(parseEffortMarker("Set effort level to high"), "high");
});
check("parseEffortMarker returns null for non-marker text", () => {
  assert.equal(parseEffortMarker("the user asked to set effort level to something"), null);
  assert.equal(parseEffortMarker(""), null);
});

// --- deriveEffort: OBSERVED (marker present) is always high-confidence ---
check("observed marker -> source observed, confidence high, regardless of date", () => {
  const before: EffortInput = { observedEffort: "ultracode", startedAtMs: CUTOFF_MS - 5_000_000 };
  const tag = deriveEffort(before, settings);
  assert.equal(tag.value, "ultracode");
  assert.equal(tag.source, "observed");
  assert.equal(tag.confidence, "high");
});

// --- deriveEffort: INFERRED_DEFAULT, confidence keyed on the mtime cutoff (ms precision) ---
check("no marker, started on/after settings mtime -> inferred_default, high confidence", () => {
  const onAfter: EffortInput = { startedAtMs: CUTOFF_MS }; // exactly at cutoff counts as on/after
  const after: EffortInput = { startedAtMs: CUTOFF_MS + 1 };
  assert.deepEqual(deriveEffort(onAfter, settings), { value: "high", source: "inferred_default", confidence: "high" });
  assert.deepEqual(deriveEffort(after, settings), { value: "high", source: "inferred_default", confidence: "high" });
});
check("no marker, started before settings mtime -> inferred_default, low confidence", () => {
  const before: EffortInput = { startedAtMs: CUTOFF_MS - 1 };
  assert.deepEqual(deriveEffort(before, settings), { value: "high", source: "inferred_default", confidence: "low" });
});
check("no marker and no startedAtMs -> inferred_default, low confidence (can't place it)", () => {
  assert.deepEqual(deriveEffort({}, settings), { value: "high", source: "inferred_default", confidence: "low" });
});

// --- deriveEffort: TIME-AWARE prior default (the settings effortLevel CHANGED; the
//     backup carries the value that was in effect before). Sessions that started before
//     the change ran under the PRIOR default, not today's value. ---
const changed: SettingsFacts = { settingsEffort: "xhigh", settingsMtimeMs: CUTOFF_MS, priorEffort: "high" };
check("no marker, started BEFORE the change -> PRIOR default (high), low confidence", () => {
  assert.deepEqual(deriveEffort({ startedAtMs: CUTOFF_MS - 1 }, changed), {
    value: "high", source: "inferred_default", confidence: "low",
  });
});
check("no marker, started ON/AFTER the change -> CURRENT default (xhigh), high confidence", () => {
  assert.deepEqual(deriveEffort({ startedAtMs: CUTOFF_MS }, changed), {
    value: "xhigh", source: "inferred_default", confidence: "high",
  });
});
check("no marker, no startedAtMs, prior known -> PRIOR default (high), low confidence", () => {
  assert.deepEqual(deriveEffort({}, changed), { value: "high", source: "inferred_default", confidence: "low" });
});
check("no prior default (no backup) -> current value before mtime, low confidence (back-compat)", () => {
  assert.deepEqual(deriveEffort({ startedAtMs: CUTOFF_MS - 1 }, settings), {
    value: "high", source: "inferred_default", confidence: "low",
  });
});

// --- deriveEffort: UNKNOWN when settings unreadable (honest sentinel, never fabricate "high") ---
check("settings unreadable -> source unknown, value unknown, confidence low", () => {
  const noSettings: SettingsFacts = { settingsEffort: null, settingsMtimeMs: null };
  assert.deepEqual(deriveEffort({ startedAtMs: CUTOFF_MS }, noSettings), {
    value: "unknown", source: "unknown", confidence: "low",
  });
});
check("observed marker still wins even when settings unreadable", () => {
  const noSettings: SettingsFacts = { settingsEffort: null, settingsMtimeMs: null };
  assert.deepEqual(deriveEffort({ observedEffort: "max", startedAtMs: 1 }, noSettings), {
    value: "max", source: "observed", confidence: "high",
  });
});

console.log(`\n${passed} effort checks passed`);
