import assert from "node:assert/strict";
import { writeFileSync, writeFileSync as wf, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractUsageTokens, parseMainTranscript, deriveTime, decodeProjectDir, passesFloor, cacheKeyFor, parseWithCache, type SessionRecord, type IngestCache } from "./ingest";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

// --- extractUsageTokens: TOP-level fields, iterations NOT summed (calibrated) ---
check("extractUsageTokens uses top-level usage, ignores iterations[] for totals", () => {
  const usage = {
    input_tokens: 133, output_tokens: 3284,
    cache_read_input_tokens: 5_000_000, cache_creation_input_tokens: 40_000,
    iterations: [
      { input_tokens: 85_429, output_tokens: 3_200, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 30_000 },
      { input_tokens: 0, output_tokens: 3_204, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      { input_tokens: 133, output_tokens: 3_284, cache_read_input_tokens: 5_000_000, cache_creation_input_tokens: 40_000 },
    ],
  };
  const t = extractUsageTokens(usage);
  assert.equal(t.fresh_input, 133);       // top-level, NOT 85_562
  assert.equal(t.output, 3284);
  assert.equal(t.cache_read, 5_000_000);   // top-level == aggregate
  assert.equal(t.cache_write, 40_000);
});

// --- parseMainTranscript: dedup by message.id (keep max output), per-model buckets, skip sidechain ---
const dir = join(tmpdir(), "tt-ingest-test");
function writeJsonl(name: string, rows: object[]) {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

check("parseMainTranscript dedups streaming chunks by message.id keeping max output", () => {
  const p = writeJsonl("a.jsonl", [
    { type: "user", timestamp: "2026-05-01T10:00:00.000Z", message: { content: "hi" } },
    // same message.id streamed twice: first chunk output≈0, final chunk full output
    { type: "assistant", timestamp: "2026-05-01T10:00:01.000Z", isSidechain: false,
      message: { id: "m1", model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 1000, cache_creation_input_tokens: 5 } } },
    { type: "assistant", timestamp: "2026-05-01T10:00:02.000Z", isSidechain: false,
      message: { id: "m1", model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 500, cache_read_input_tokens: 1000, cache_creation_input_tokens: 5 },
        content: [{ type: "tool_use", name: "Bash", input: {} }] } },
  ]);
  const r = parseMainTranscript([p]);
  assert.equal(r.assistantMsgCount, 1);                 // deduped
  assert.equal(r.tokens.output, 500);                   // kept the max-output chunk
  assert.equal(r.tokens.cache_read, 1000);              // counted once
  assert.deepEqual(r.toolCounts, { Bash: 1 });
  assert.equal(r.modelMsgCounts["claude-opus-4-8"], 1);
});

check("parseMainTranscript skips isSidechain rows and splits per model", () => {
  const p = writeJsonl("b.jsonl", [
    { type: "assistant", timestamp: "2026-05-01T10:00:00.000Z", isSidechain: false,
      message: { id: "x", model: "claude-opus-4-8", usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    { type: "assistant", timestamp: "2026-05-01T10:00:05.000Z", isSidechain: false,
      message: { id: "y", model: "claude-haiku-4-5", usage: { input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    { type: "assistant", timestamp: "2026-05-01T10:00:06.000Z", isSidechain: true,
      message: { id: "z", model: "claude-opus-4-8", usage: { input_tokens: 999, output_tokens: 999, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  ]);
  const r = parseMainTranscript([p]);
  assert.equal(r.assistantMsgCount, 2);                            // sidechain skipped
  assert.equal(r.perModelTokens["claude-opus-4-8"].fresh_input, 100);
  assert.equal(r.perModelTokens["claude-haiku-4-5"].fresh_input, 200);
  assert.equal(r.tokens.fresh_input, 300);                         // aggregate excludes sidechain
});

rmSync(dir, { recursive: true, force: true });

check("deriveTime: gaps >120s are idle, rest is active; wall = last - first", () => {
  const base = Date.parse("2026-05-01T10:00:00.000Z");
  const ts = [base, base + 30_000, base + 60_000, base + 60_000 + 600_000, base + 60_000 + 600_000 + 75_000];
  // 0..60s active (2 gaps of 30s), then a 600s gap (idle), then 75s active → 735s total
  const t = deriveTime(ts);
  assert.equal(t.wallClockMin, 12.25);  // 735s total
  assert.equal(t.idleMin, 10);          // the single 600s gap
  assert.equal(t.activeMin, 2.25);      // 135s
});

check("deriveTime: empty / single timestamp → zeros", () => {
  assert.deepEqual(deriveTime([]), { wallClockMin: 0, activeMin: 0, idleMin: 0 });
  assert.deepEqual(deriveTime([123]), { wallClockMin: 0, activeMin: 0, idleMin: 0 });
});

check("decodeProjectDir strips worktree suffix and path encoding to base name", () => {
  assert.equal(decodeProjectDir("-Users-huiyanwan-Documents-claude-retrospectives"), "claude-retrospectives");
  assert.equal(
    decodeProjectDir("-Users-huiyanwan-Documents-AMC-handover--claude-worktrees-gifted-dirac-3b05ca"),
    "AMC-handover",
  );
  assert.equal(decodeProjectDir("-Users-huiyanwan"), "huiyanwan"); // home catch-all → last segment
});

const recStub = (over: Partial<SessionRecord>): SessionRecord => ({
  id: "demo0001", sessionUuid: "demo0001-uuid", date: "2026-05-01", project: "p",
  rawProjectDirs: ["d"], tokens: { fresh_input: 1, output: 1, cache_write: 0, cache_read: 0 },
  perModelTokens: { "claude-opus-4-8": { fresh_input: 1, output: 1, cache_write: 0, cache_read: 0 } },
  modelMsgCounts: { "claude-opus-4-8": 12 }, dominantModel: "opus", cacheHitPct: 0,
  wallClockMin: 1, activeMin: 1, idleMin: 0, assistantMsgCount: 12, toolCounts: {}, hasUsage: true,
  ...over,
});

check("passesFloor: <10 assistant messages dropped", () => {
  assert.equal(passesFloor(recStub({ assistantMsgCount: 9 })), false);
  assert.equal(passesFloor(recStub({ assistantMsgCount: 10 })), true);
});
check("passesFloor: no usage dropped regardless of message count", () => {
  assert.equal(passesFloor(recStub({ assistantMsgCount: 50, hasUsage: false })), false);
});

check("parseWithCache: hit when mtime+size unchanged, miss after edit", () => {
  const dir2 = join(tmpdir(), "tt-ingest-cache");
  mkdirSync(dir2, { recursive: true });
  const p = join(dir2, "s.jsonl");
  wf(p, JSON.stringify({ type: "assistant", timestamp: "2026-05-01T10:00:00.000Z",
    message: { id: "m", model: "claude-opus-4-8", usage: { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + "\n");
  const cache: IngestCache = {};
  let parses = 0;
  const parser = (paths: string[]) => { parses++; return parseMainTranscript(paths); };

  parseWithCache([p], cache, parser);
  assert.equal(parses, 1);                 // cold → parsed
  parseWithCache([p], cache, parser);
  assert.equal(parses, 1);                 // warm → cache hit, not re-parsed
  assert.ok(cache[cacheKeyFor(p)]);        // entry stored

  // mutate the file → size changes → miss
  wf(p, JSON.stringify({ type: "assistant", timestamp: "2026-05-01T10:00:00.000Z",
    message: { id: "m", model: "claude-opus-4-8", usage: { input_tokens: 9999, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + "\n");
  const r = parseWithCache([p], cache, parser);
  assert.equal(parses, 2);                 // changed → re-parsed
  assert.equal(r.tokens.fresh_input, 9999);
  rmSync(dir2, { recursive: true, force: true });
});

console.log(`\n${passed} ingest checks passed`);
