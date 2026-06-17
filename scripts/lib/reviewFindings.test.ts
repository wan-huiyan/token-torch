/* Tests for the #72 review-findings ("mistakes caught") extractor — the
 * high-precision FLOOR. Run: tsx scripts/lib/reviewFindings.test.ts */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  countConfirmedFindings,
  parseFinalAssistantText,
  isReviewMeta,
  extractReviewFindings,
} from "./reviewFindings";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

// ---- countConfirmedFindings: only line-start severity-tagged findings count ----
check("counts ### header findings", () => {
  assert.equal(countConfirmedFindings("### [P1] timezone bug\n### [P2] mock gap"), 2);
});
check("counts list-item + ordered-list findings", () => {
  assert.equal(countConfirmedFindings("- [P1] a\n* [P3] b\n1. [P2] c"), 3);
});
check("counts bold-wrapped tagged header", () => {
  assert.equal(countConfirmedFindings("### **[P0]** critical\n**[P1]** also"), 2);
});
check("does NOT count inline-prose [Pn] mid-sentence", () => {
  assert.equal(countConfirmedFindings("This is a [P1] concern but only in passing."), 0);
});
check("does NOT count a scale-definition echo (the trap)", () => {
  assert.equal(
    countConfirmedFindings("I rated each finding P0/P1/P2/P3 by severity, then verified."),
    0,
  );
});
check("counts only the tagged lines in a mixed verdict", () => {
  const txt = [
    "## Findings",
    "### [P1] Real blocking issue at file.ts:10",
    "Some prose mentioning P2 considerations here.",
    "### [P3] Minor nit",
    "## Recommendation: REQUEST-CHANGES",
  ].join("\n");
  assert.equal(countConfirmedFindings(txt), 2);
});
check("empty / no-finding text → 0", () => {
  assert.equal(countConfirmedFindings(""), 0);
  assert.equal(countConfirmedFindings("APPROVE. No blocking issues found."), 0);
});

// ---- parseFinalAssistantText: last non-empty assistant message ----
check("returns the LAST assistant message text (string content)", () => {
  const raw = [
    JSON.stringify({ type: "user", message: { content: "review this" } }),
    JSON.stringify({ type: "assistant", message: { content: "First pass thoughts" } }),
    JSON.stringify({ type: "assistant", message: { content: "### [P1] final verdict finding" } }),
  ].join("\n");
  assert.equal(parseFinalAssistantText(raw), "### [P1] final verdict finding");
});
check("handles array content blocks and skips a trailing empty assistant msg", () => {
  const raw = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "### [P2] real" }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "x" }] } }),
  ].join("\n");
  assert.equal(parseFinalAssistantText(raw), "### [P2] real");
});
check("no assistant message → empty string", () => {
  assert.equal(parseFinalAssistantText(JSON.stringify({ type: "user", message: { content: "hi" } })), "");
});

// ---- isReviewMeta ----
check("identifies review meta by description or agentType", () => {
  assert.ok(isReviewMeta({ description: "Light review of S22 handoff PR" }));
  assert.ok(isReviewMeta({ agentType: "voltagent-qa-sec:code-reviewer" }));
  assert.ok(isReviewMeta({ description: "Adversarial review panel reviewer" }));
  assert.equal(isReviewMeta({ description: "Implement the parser", agentType: "general-purpose" }), false);
  assert.equal(isReviewMeta({}), false);
});

// ---- extractReviewFindings: end-to-end over a tmpdir corpus ----
function writeAgent(dir: string, name: string, meta: object, finalText: string, promptText = "review it") {
  writeFileSync(join(dir, `${name}.meta.json`), JSON.stringify(meta));
  const lines = [
    JSON.stringify({ type: "user", message: { content: promptText }, timestamp: "2026-06-10T10:00:00Z" }),
    JSON.stringify({ type: "assistant", message: { id: "m1", content: finalText }, timestamp: "2026-06-10T10:05:00Z" }),
  ];
  writeFileSync(join(dir, `${name}.jsonl`), lines.join("\n"));
}

check("end-to-end: foreground parsed, prose unknown, panel excluded, non-review ignored", () => {
  const root = mkdtempSync(join(tmpdir(), "rf-"));
  const sessionDir = join(root, "proj", "abcd1234-session-uuid");
  const subs = join(sessionDir, "subagents");
  mkdirSync(subs, { recursive: true });
  // A: foreground review, 2 tagged findings → parsed, confirmed +2
  writeAgent(subs, "agent-aaa", { description: "Code review of PR #1" }, "### [P1] bug\n### [P2] nit");
  // B: foreground review, prose verdict, NO tags → unknown (the scale text is in the PROMPT, not final msg)
  writeAgent(
    subs,
    "agent-bbb",
    { description: "Review the diff" },
    "VERDICT: REQUEST-CHANGES. The timezone handling is wrong and the test mock is incomplete.",
    "Rate findings P0 (blocker) / P1 / P2 / P3.",
  );
  // C: NON-review subagent → ignored entirely
  writeAgent(subs, "agent-ccc", { description: "Implement the feature", agentType: "general-purpose" }, "### [P1] not a review");
  // D: panel reviewer nested under workflows/ → counts toward total, NOT parsed (adjudication is the judge's)
  const wf = join(subs, "workflows", "wf_run1");
  mkdirSync(wf, { recursive: true });
  writeAgent(wf, "agent-ddd", { description: "review panel reviewer: security lens" }, "### [P0] reviewer-raised, not yet adjudicated");

  const index = new Map<string, string[]>([["abcd1234", [sessionDir]]]);
  const r = extractReviewFindings("abcd1234", index);
  assert.ok(r, "expected a ReviewFindings result");
  assert.equal(r!.confirmed, 2, "only A's 2 tagged findings are confirmed");
  assert.equal(r!.reviews_parsed, 1, "only A parsed (B prose-unknown, D panel-unknown)");
  assert.equal(r!.reviews_total, 3, "A + B + D are reviews; C is not");
  rmSync(root, { recursive: true, force: true });
});

check("session with no review subagents → undefined", () => {
  const root = mkdtempSync(join(tmpdir(), "rf-"));
  const sessionDir = join(root, "proj", "ef012345-session");
  const subs = join(sessionDir, "subagents");
  mkdirSync(subs, { recursive: true });
  writeAgent(subs, "agent-xxx", { description: "Implement parser", agentType: "general-purpose" }, "done");
  const index = new Map<string, string[]>([["ef012345", [sessionDir]]]);
  assert.equal(extractReviewFindings("ef012345", index), undefined);
  rmSync(root, { recursive: true, force: true });
});

check("unknown session id → undefined", () => {
  assert.equal(extractReviewFindings("deadbeef", new Map()), undefined);
});

console.log(`\nreviewFindings: ${passed} checks passed`);
