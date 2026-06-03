import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAgentFile, extractShipped } from "./jsonl";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

// --- Plan 8 / issue #10: per-dispatch base-context floor = min nonzero cache_read ---
check("parseAgentFile captures scaffoldingFloor = min nonzero cache_read for a dispatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-agent-"));
  const p = join(dir, "agent-deadbeef.jsonl");
  const row = (id: string, ts: string, cr: number, cw: number) =>
    JSON.stringify({
      type: "assistant",
      timestamp: ts,
      message: {
        id,
        model: "claude-opus-4-8",
        usage: { input_tokens: 1, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: 10 },
        content: [],
      },
    });
  // a1 is a write-heavy first turn (cr 25000), a2 reads a larger prefix (41000) → floor = 25000.
  writeFileSync(
    p,
    [row("a1", "2026-06-03T10:00:00Z", 25000, 8000), row("a2", "2026-06-03T10:00:30Z", 41000, 800)].join("\n"),
  );
  const parse = parseAgentFile(p);
  assert.ok(parse, "parse should not be null");
  assert.equal(parse!.scaffoldingFloor, 25000);
});

check("extractShipped nests commits + a review under their PR, keeps direct commits separate, never puts $ on a PR", () => {
  const dir = mkdtempSync(join(tmpdir(), "ship-"));
  const sid = "abcd1234";
  const rec = (ts: string, content: any[]) =>
    JSON.stringify({ timestamp: ts, message: { content } });
  const bash = (cmd: string) => ({ type: "tool_use", name: "Bash", input: { command: cmd } });
  const result = (txt: string) => ({ type: "tool_result", content: txt });
  const lines = [
    rec("2026-06-03T10:00:00Z", [bash(`git commit -m "feat: a"`)]),
    rec("2026-06-03T10:01:00Z", [bash(`gh pr create --title "Plan 6"`)]),
    rec("2026-06-03T10:01:05Z", [result("https://github.com/wan-huiyan/token-torch/pull/15")]),
    rec("2026-06-03T10:05:00Z", [bash(`git commit -m "fix: review nit"`)]),
    rec("2026-06-03T10:06:00Z", [bash(`gh pr merge 15 --squash`)]),
    rec("2026-06-03T10:10:00Z", [bash(`git commit -m "docs: direct to main"`)]),
  ];
  writeFileSync(join(dir, sid + ".jsonl"), lines.join("\n"));
  // a review subagent meta that refs PR 15 → must nest under PR #15 (collectMetaFiles finds *.meta.json under <sessionDir>/subagents)
  mkdirSync(join(dir, sid, "subagents"), { recursive: true });
  writeFileSync(join(dir, sid, "subagents", "r.meta.json"), JSON.stringify({ description: "review PR 15 changes" }));
  const index = new Map<string, string[]>([[sid, [join(dir, sid)]]]);

  const sh = extractShipped(sid, index)!;
  assert.ok(sh.prs && sh.prs.length === 1, "one PR");
  const pr = sh.prs[0];
  assert.equal(pr.ref, "#15");
  assert.equal(pr.meta, "merged");
  assert.ok(!/\$/.test(pr.meta ?? ""), "PR meta must never contain a $ cost figure");
  assert.deepEqual(pr.commits?.map((c) => c.title), ["feat: a", "fix: review nit"]);
  assert.deepEqual(sh.commits?.map((c) => c.title), ["docs: direct to main"]);
  // review nested under the PR, NOT left at top level
  assert.equal(pr.reviews?.length, 1, "the PR-linked review nests under the PR");
  assert.ok(!sh.reviews || sh.reviews.length === 0, "no unlinked top-level reviews");
  // Scoreboard-equivalent tally (Shipped.tsx) must still count the nested review (L9 guard)
  const scoreboardReviews =
    (sh.reviews?.length ?? 0) + (sh.prs?.reduce((n, p) => n + (p.reviews?.length ?? 0), 0) ?? 0);
  assert.equal(scoreboardReviews, 1, "scoreboard review count includes nested reviews");
});

check("extractShipped: heredoc-wrapped commit appears ONCE with the clean subject (no garbled $(cat prefix, no duplicate)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ship-heredoc-"));
  const sid = "aabb1122";
  const rec = (ts: string, content: any[]) =>
    JSON.stringify({ timestamp: ts, message: { content } });
  const bash = (cmd: string) => ({ type: "tool_use", name: "Bash", input: { command: cmd } });
  const result = (txt: string) => ({ type: "tool_result", content: txt });
  // This is the actual command shape used in these sessions:
  //   git commit -m "$(cat <<'EOF'
  //   fix(actions): correct stale hero copy — Ten->Nine
  //   body line
  //   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  //   EOF
  //   )"
  const heredocCmd = `git commit -m "$(cat <<'EOF'\nfix(actions): correct stale hero copy — Ten->Nine\nbody line\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nEOF\n)"`;
  const lines = [
    rec("2026-06-03T11:00:00Z", [bash(`git commit -m "feat: before-pr"`)]),
    rec("2026-06-03T11:01:00Z", [bash(`gh pr create --title "Plan 6 fixes"`)]),
    rec("2026-06-03T11:01:05Z", [result("https://github.com/wan-huiyan/token-torch/pull/864")]),
    rec("2026-06-03T11:02:00Z", [bash(heredocCmd)]),
    rec("2026-06-03T11:03:00Z", [bash(`gh pr merge 864 --squash`)]),
  ];
  writeFileSync(join(dir, sid + ".jsonl"), lines.join("\n"));
  const index = new Map<string, string[]>([[sid, [join(dir, sid)]]]);

  const sh = extractShipped(sid, index)!;
  const pr864 = sh.prs?.find((p) => p.ref === "#864");
  assert.ok(pr864, "PR #864 must exist");
  const commits = pr864!.commits ?? [];
  const titles = commits.map((c) => c.title);
  // must be exactly 2 clean subjects — no $(cat prefix, no duplicate
  assert.equal(commits.length, 2, `Expected 2 commits but got ${commits.length}: ${JSON.stringify(titles)}`);
  assert.equal(titles[0], "feat: before-pr");
  assert.equal(titles[1], "fix(actions): correct stale hero copy — Ten->Nine");
  assert.ok(!titles.some((t) => t.startsWith("$(cat")), "no commit title may start with $(cat");
});

console.log(`\n${passed} jsonl checks passed`);
