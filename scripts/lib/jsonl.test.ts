import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAgentFile } from "./jsonl";

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

console.log(`\n${passed} jsonl checks passed`);
