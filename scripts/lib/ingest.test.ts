import assert from "node:assert/strict";
import { writeFileSync, writeFileSync as wf, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractUsageTokens, parseMainTranscript, deriveTime, decodeProjectDir, passesFloor, cacheKeyFor, parseWithCache, buildSessionRecord, loadCache, CACHE_VERSION, type SessionRecord, type IngestCache } from "./ingest";

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

// --- parseMainTranscript: capture the /effort marker from user local-command-stdout ---
const dirE = join(tmpdir(), "tt-ingest-effort");
function writeJsonlE(name: string, rows: object[]) {
  mkdirSync(dirE, { recursive: true });
  const p = join(dirE, name);
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

check("parseMainTranscript captures observedEffort from a local-command-stdout marker", () => {
  const p = writeJsonlE("eff.jsonl", [
    { type: "user", timestamp: "2026-06-01T10:00:00.000Z",
      message: { role: "user", content: "<local-command-stdout>Set effort level to ultracode (this session only): xhigh + dynamic workflow orchestration</local-command-stdout>" } },
    { type: "assistant", timestamp: "2026-06-01T10:00:01.000Z", isSidechain: false,
      message: { id: "m1", model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  ]);
  const r = parseMainTranscript([p]);
  assert.equal(r.observedEffort, "ultracode");
});

check("parseMainTranscript last-write-wins across multiple markers by timestamp", () => {
  const p = writeJsonlE("eff2.jsonl", [
    { type: "user", timestamp: "2026-06-01T10:00:05.000Z",
      message: { role: "user", content: "<local-command-stdout>Set effort level to high</local-command-stdout>" } },
    { type: "user", timestamp: "2026-06-01T10:00:01.000Z",
      message: { role: "user", content: "<local-command-stdout>Set effort level to low</local-command-stdout>" } },
    { type: "assistant", timestamp: "2026-06-01T10:00:06.000Z", isSidechain: false,
      message: { id: "m2", model: "claude-opus-4-8", usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  ]);
  const r = parseMainTranscript([p]);
  assert.equal(r.observedEffort, "high"); // 10:00:05 marker beats the 10:00:01 one
});

check("parseMainTranscript ignores assistant-quoted marker text (false-positive guard)", () => {
  const p = writeJsonlE("eff3.jsonl", [
    { type: "assistant", timestamp: "2026-06-01T10:00:00.000Z", isSidechain: false,
      message: { id: "m3", model: "claude-opus-4-8", usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        content: [{ type: "text", text: "I will Set effort level to ultracode now" }] } },
  ]);
  const r = parseMainTranscript([p]);
  assert.equal(r.observedEffort, undefined); // marker only honored from user local-command-stdout
});

rmSync(dirE, { recursive: true, force: true });

// --- buildSessionRecord carries observedEffort + startedAtMs from the parse ---
check("buildSessionRecord copies observedEffort and startedAtMs (first event) from ParsedTranscript", () => {
  const parsed = parseMainTranscript([
    writeJsonlE("rec.jsonl", [
      { type: "user", timestamp: "2026-06-01T09:00:00.000Z",
        message: { role: "user", content: "<local-command-stdout>Set effort level to max</local-command-stdout>" } },
      { type: "assistant", timestamp: "2026-06-01T09:00:01.000Z", isSidechain: false,
        message: { id: "z1", model: "claude-opus-4-8", usage: { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    ]),
  ]);
  const rec = buildSessionRecord({
    id: "deadbeef", sessionUuid: "deadbeef-uuid", rawProjectDirs: ["d"], decodedProject: "p",
    projectFn: (x) => x, parsed,
  });
  assert.equal(rec.observedEffort, "max");
  assert.equal(rec.startedAtMs, Date.parse("2026-06-01T09:00:00.000Z")); // first (earliest) event
  rmSync(dirE, { recursive: true, force: true });
});

// --- versioned cache: a v0 (legacy) cache file is discarded, not trusted ---
check("loadCache discards a cache whose version mismatches CACHE_VERSION", () => {
  const dir3 = join(tmpdir(), "tt-ingest-cachever");
  mkdirSync(dir3, { recursive: true });
  const cp = join(dir3, "c.json");
  // legacy shape: a bare path-keyed map (no version envelope)
  wf(cp, JSON.stringify({ "/some/path.jsonl": { mtimeMs: 1, size: 2, parsed: { tokens: {}, perModelTokens: {}, modelMsgCounts: {}, toolCounts: {}, assistantMsgCount: 0, timestampsMs: [] } } }));
  assert.deepEqual(loadCache(cp), {}); // legacy / unversioned → ignored

  // correctly versioned envelope round-trips
  const entry = { "/p.jsonl": { mtimeMs: 1, size: 2, parsed: parseMainTranscript([]) } };
  wf(cp, JSON.stringify({ version: CACHE_VERSION, entries: entry }));
  const loaded = loadCache(cp);
  assert.ok(loaded["/p.jsonl"]);
  rmSync(dir3, { recursive: true, force: true });
});

// --- Plan 8 / issue #10: scaffoldingFloor = min nonzero cache_read; turnCount = #(cr>0) ---
check("parseMainTranscript derives scaffoldingFloor (min nonzero cache_read) + turnCount", () => {
  const d = join(tmpdir(), "tt-overhead-floor");
  mkdirSync(d, { recursive: true });
  const p = join(d, "s.jsonl");
  const row = (id: string, ts: string, cr: number, cw: number, out: number) =>
    JSON.stringify({
      type: "assistant",
      timestamp: ts,
      message: {
        id,
        model: "claude-opus-4-8",
        usage: { input_tokens: 2, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: out },
        content: [],
      },
    });
  writeFileSync(
    p,
    [
      row("m0", "2026-06-03T09:59:00Z", 0, 80000, 50), // cr=0 turn: excluded from floor AND turnCount
      row("m1", "2026-06-03T10:00:00Z", 30000, 5000, 100), // floor candidate (min nonzero)
      row("m2", "2026-06-03T10:01:00Z", 45000, 800, 100),
      row("m3", "2026-06-03T10:02:00Z", 60000, 800, 100),
    ].join("\n"),
  );
  const parsed = parseMainTranscript([p]);
  assert.equal(parsed.scaffoldingFloor, 30000);
  assert.equal(parsed.turnCount, 3); // m0 (cr=0) excluded
  rmSync(d, { recursive: true, force: true });
});

console.log(`\n${passed} ingest checks passed`);
