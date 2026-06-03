import assert from "node:assert/strict";
import { linkCommitsToPrs, cleanCommitSubject, type ShipEvent } from "./shippedLink";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

check("pre-create commits attach to the PR that bundles them", () => {
  const ev: ShipEvent[] = [
    { kind: "commit", subject: "feat: a" },
    { kind: "commit", subject: "feat: b" },
    { kind: "pr_open", num: "15", title: "Plan 6" },
    { kind: "pr_merge", num: "15" },
  ];
  const r = linkCommitsToPrs(ev);
  assert.deepEqual(r.prCommits.get("15"), ["feat: a", "feat: b"]);
  assert.deepEqual(r.unlinkedCommits, []);
});

check("post-create review-fixup commits attach to the still-open PR (boundary is merge, not create)", () => {
  const ev: ShipEvent[] = [
    { kind: "commit", subject: "feat: a" },
    { kind: "pr_open", num: "15", title: "Plan 6" },
    { kind: "commit", subject: "fix: review nit" },
    { kind: "pr_merge", num: "15" },
  ];
  const r = linkCommitsToPrs(ev);
  assert.deepEqual(r.prCommits.get("15"), ["feat: a", "fix: review nit"]);
  assert.deepEqual(r.unlinkedCommits, []);
});

check("two serial PRs keep their own commits", () => {
  const ev: ShipEvent[] = [
    { kind: "commit", subject: "a1" },
    { kind: "pr_open", num: "15", title: "P6" },
    { kind: "pr_merge", num: "15" },
    { kind: "commit", subject: "b1" },
    { kind: "pr_open", num: "16", title: "P7" },
    { kind: "pr_merge", num: "16" },
  ];
  const r = linkCommitsToPrs(ev);
  assert.deepEqual(r.prCommits.get("15"), ["a1"]);
  assert.deepEqual(r.prCommits.get("16"), ["b1"]);
  assert.deepEqual(r.unlinkedCommits, []);
});

check("commits after a merge with no new PR fall to unlinked (direct-to-main), never mis-attributed", () => {
  const ev: ShipEvent[] = [
    { kind: "pr_open", num: "15", title: "P6" },
    { kind: "commit", subject: "in15" },
    { kind: "pr_merge", num: "15" },
    { kind: "commit", subject: "docs: direct" },
  ];
  const r = linkCommitsToPrs(ev);
  assert.deepEqual(r.prCommits.get("15"), ["in15"]);
  assert.deepEqual(r.unlinkedCommits, ["docs: direct"]);
});

check("a session that opens no PR → all commits unlinked", () => {
  const ev: ShipEvent[] = [
    { kind: "commit", subject: "c1" },
    { kind: "commit", subject: "c2" },
  ];
  const r = linkCommitsToPrs(ev);
  assert.equal(r.prCommits.size, 0);
  assert.deepEqual(r.unlinkedCommits, ["c1", "c2"]);
});

check("a numberless merge (gh pr merge --auto) still closes the active PR → later commits are unlinked", () => {
  const ev: ShipEvent[] = [
    { kind: "pr_open", num: "15", title: "P6" },
    { kind: "commit", subject: "in15" },
    { kind: "pr_merge" }, // no num — bare `gh pr merge`
    { kind: "commit", subject: "after" },
  ];
  const r = linkCommitsToPrs(ev);
  assert.deepEqual(r.prCommits.get("15"), ["in15"]);
  assert.deepEqual(r.unlinkedCommits, ["after"]);
});

check("cleanCommitSubject: heredoc-wrapped blob → first meaningful subject line", () => {
  const raw = "$(cat <<'EOF'\nfix(actions): correct stale hero copy — Ten->Nine\nbody\nCo-Authored-By: X <x@y>\nEOF\n)";
  assert.equal(cleanCommitSubject(raw), "fix(actions): correct stale hero copy — Ten->Nine");
});

check("cleanCommitSubject: already-clean subject passes through unchanged", () => {
  const raw = "fix(actions): correct stale hero copy — Ten->Nine";
  assert.equal(cleanCommitSubject(raw), raw);
});

check("cleanCommitSubject: simple plain subject passes through unchanged", () => {
  assert.equal(cleanCommitSubject("feat: simple subject"), "feat: simple subject");
});

console.log(`${passed} shippedLink checks passed`);
