import assert from "node:assert/strict";
import type { SessionDetailData } from "../../src/types";
import { sessionDemo } from "../../src/fixtures/session-demo.fixture";
import {
  selectTakeawaySessions,
  buildSessionTakeawaysRequest,
  parseSessionTakeaways,
  acceptSessionTakeaways,
  loadSessionTakeaways,
} from "./sessionTakeaways";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

/** Build a session variant with distinct id / cost / date for selection + binding tests. */
function mk(id: string, cost: number, date: string): SessionDetailData {
  return {
    ...sessionDemo,
    id,
    date,
    cost_usd: cost,
    cost: { ...sessionDemo.cost, total_usd: cost, main_loop_usd: cost, by_category: undefined },
  };
}

const byId = (arr: SessionDetailData[]) => new Map(arr.map((s) => [s.id, s]));

check("select: top-cost ∪ most-recent, de-duped", () => {
  const sessions = [
    mk("aaaa1111", 500, "2026-01-01"), // priciest, oldest
    mk("bbbb2222", 10, "2026-12-31"), // cheap, newest
    mk("cccc3333", 50, "2026-06-15"),
  ];
  const ids = selectTakeawaySessions(sessions);
  assert.ok(ids.includes("aaaa1111"), "priciest selected");
  assert.ok(ids.includes("bbbb2222"), "newest selected (recent track)");
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids");
});

check("request: lists every selected id + its citable numbers + the hard rules", () => {
  const req = buildSessionTakeawaysRequest([sessionDemo]);
  assert.ok(req.includes(`### ${sessionDemo.id}`), "session block heading present");
  assert.ok(req.includes("130.91"), "session cost is a citable number in the block");
  assert.ok(req.includes("session-takeaways.local.md"), "names the output file");
  assert.ok(/no superlatives/i.test(req), "carries the no-superlative rule");
});

check("parse: splits `## <id>` sections, body = lines until the next heading", () => {
  const raw = [
    "## demo0004",
    "🔥 A short takeaway.",
    "",
    "## other001",
    "🪙 Another one.",
  ].join("\n");
  const parsed = parseSessionTakeaways(raw);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, "demo0004");
  assert.ok(parsed[0].md.includes("short takeaway"));
  assert.equal(parsed[1].id, "other001");
});

check("accept: a valid note (only this session's numbers) is accepted", () => {
  const raw = "## demo0004\n🔥 Spanned 169.4 min but only 77.8 were real compute; cache hit 97.3%.";
  const d = acceptSessionTakeaways(raw, byId([sessionDemo]));
  assert.equal(d.accepted.size, 1);
  assert.ok(d.accepted.get("demo0004")?.includes("real compute"));
  assert.equal(d.rejected.length, 0);
});

check("accept: a fabricated number is rejected → not accepted (template fallback)", () => {
  const raw = "## demo0004\n🔥 This run burned $9,999.99.";
  const d = acceptSessionTakeaways(raw, byId([sessionDemo]));
  assert.equal(d.accepted.size, 0);
  assert.equal(d.rejected.length, 1);
  assert.equal(d.rejected[0].id, "demo0004");
});

check("accept: a number valid for ANOTHER session is rejected here (per-session binding)", () => {
  const other = mk("other001", 42.5, "2026-06-10");
  // cite demo0004's $130.91 under other001's heading → fabrication for other001.
  const raw = "## other001\nThis run cost about $130.91.";
  const d = acceptSessionTakeaways(raw, byId([sessionDemo, other]));
  assert.equal(d.accepted.size, 0, "another session's cost must not validate here");
  assert.equal(d.rejected[0].id, "other001");
});

check("accept: an unknown / stale id is ignored (not accepted, not crash)", () => {
  const raw = "## zzzz9999\nGhost session.";
  const d = acceptSessionTakeaways(raw, byId([sessionDemo]));
  assert.equal(d.accepted.size, 0);
  assert.deepEqual(d.unknown, ["zzzz9999"]);
});

check("accept: null / empty input → empty decision (no crash)", () => {
  const d = acceptSessionTakeaways(null, byId([sessionDemo]));
  assert.equal(d.accepted.size, 0);
  assert.equal(d.rejected.length, 0);
});

check("load: a non-existent file → empty decision", () => {
  const d = loadSessionTakeaways("/tmp/token-torch-no-such-takeaways-file.local.md", byId([sessionDemo]));
  assert.equal(d.accepted.size, 0);
});

console.log(`\n${passed} session-takeaways checks passed`);
