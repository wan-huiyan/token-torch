import assert from "node:assert/strict";
import { buildContextBlock, buildInsightsRequest } from "./insightsPrompt";
import { dashboardFixture } from "./testFixtures";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

// The emitted prompt must be self-contained: grounding facts + the no-fab rules + the
// output-file instruction. If any is missing, an agent could write an ungrounded note.
check("buildInsightsRequest embeds the grounding facts, the rules, and the output target", () => {
  const md = buildInsightsRequest(dashboardFixture());
  assert.ok(md.includes("insights.local.md"), "names the output file");
  assert.ok(md.includes("HARD RULES"), "includes the no-fab rules");
  assert.ok(md.includes("Full set of citable numbers"), "includes the citable whitelist line");
  assert.ok(/DISCARD|no-fabrication|re-?validates/i.test(md), "warns the generator re-validates");
});

// The request reuses the exact same context block the API path would send — one source of truth.
check("buildInsightsRequest contains the contextBlock verbatim", () => {
  const f = dashboardFixture();
  assert.ok(buildInsightsRequest(f).includes(buildContextBlock(f)), "embeds buildContextBlock verbatim");
});

// #27 — the prompt instructs the model to emit the inline PCN model_mix binding tags with the
// exact ids+values, and notes they are stripped before display.
check("buildContextBlock instructs the [[mm:id=value]] model_mix binding tags (exact ids+values, stripped)", () => {
  const f = dashboardFixture();
  f.distributions.model_mix = { "claude-opus-4-8": 80, "claude-opus-4-7": 20 };
  const b = buildContextBlock(f);
  assert.ok(/\[\[mm:/.test(b), "names the [[mm: tag syntax");
  assert.ok(b.includes("[[mm:claude-opus-4-8=80]]"), "lists the exact tag for each model_mix id");
  assert.ok(/strip/i.test(b), "notes the tags are stripped before display");
});

console.log(`\n${passed} insights-prompt checks passed`);
