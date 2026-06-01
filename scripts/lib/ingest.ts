/* ============================================================================
 * JSONL-PRIMARY ingestion. Derives a per-session SessionRecord from raw main-loop
 * transcripts (~/.claude/projects/<dir>/<session-uuid>.jsonl).
 *
 * Token extraction (extractUsageTokens) is CALIBRATED (see Plan 2 §calibration):
 * top-level message.usage, deduped by message.id keeping the max-output chunk.
 * iterations[] is NOT summed (top-level cache_* is already the aggregate; summing
 * iteration input grossly overcounts). cctime usage-tracking is a reconciliation
 * overlay, never blended.
 * ========================================================================== */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TokenSet } from "./pricing";

export const defaultProjectsDir = (): string => join(homedir(), ".claude", "projects");

// Used by deriveTime (Task 3) — kept here so the constant lives next to the parser.
// Exported with underscore prefix to satisfy noUnusedLocals until Task 3 consumes them.
export const _MS_PER_MIN = 60_000;
export const _GAP_IDLE_MS = 120_000; // >120s between events = you-away (idle), not compute

type RawUsage = {
  input_tokens?: number; output_tokens?: number;
  cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
};

/** THE single token-extraction funnel. Top-level fields only (calibrated). */
export function extractUsageTokens(u: RawUsage): TokenSet {
  return {
    fresh_input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cache_write: u.cache_creation_input_tokens ?? 0,
    cache_read: u.cache_read_input_tokens ?? 0,
  };
}

const addInto = (a: TokenSet, b: TokenSet) => {
  a.fresh_input += b.fresh_input; a.output += b.output;
  a.cache_write += b.cache_write; a.cache_read += b.cache_read;
};
const zero = (): TokenSet => ({ fresh_input: 0, output: 0, cache_write: 0, cache_read: 0 });

export interface ParsedTranscript {
  tokens: TokenSet;                          // aggregate (non-sidechain)
  perModelTokens: Record<string, TokenSet>;  // model id → tokens
  modelMsgCounts: Record<string, number>;    // model id → kept assistant msg count
  toolCounts: Record<string, number>;
  assistantMsgCount: number;                 // deduped, non-sidechain
  timestampsMs: number[];                    // ALL row timestamps, sorted asc
  ccVersion?: string;
}

/** Parse one-or-more transcript files for ONE session (worktree fanout) into raw
 *  numbers. Dedup assistant messages by message.id keeping the max-output chunk. */
export function parseMainTranscript(paths: string[]): ParsedTranscript {
  // dedup across all files: message.id → the richest (max output_tokens) message obj
  const bestMsg = new Map<string, { usage: RawUsage; model: string; content: unknown }>();
  const timestamps: number[] = [];
  let ccVersion: string | undefined;

  for (const p of paths) {
    let text: string;
    try { text = readFileSync(p, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line) continue;
      let r: any;
      try { r = JSON.parse(line); } catch { continue; }
      if (typeof r.timestamp === "string") {
        const t = Date.parse(r.timestamp);
        if (!Number.isNaN(t)) timestamps.push(t);
      }
      if (typeof r.version === "string" && (!ccVersion || r.version > ccVersion)) ccVersion = r.version;
      if (r.type !== "assistant" || r.isSidechain) continue;
      const m = r.message;
      if (!m?.id || !m.usage) continue;
      const out = m.usage.output_tokens ?? 0;
      const prev = bestMsg.get(m.id);
      // keep ONLY the richest (max-output) chunk; duplicate rows carry identical
      // content, so counting tools from the kept chunk alone avoids overcounting.
      if (prev && (prev.usage.output_tokens ?? 0) >= out) continue;
      bestMsg.set(m.id, { usage: m.usage, model: (m.model ?? "unknown").toLowerCase(), content: m.content });
    }
  }

  const tokens = zero();
  const perModelTokens: Record<string, TokenSet> = {};
  const modelMsgCounts: Record<string, number> = {};
  const toolCounts: Record<string, number> = {};
  for (const { usage, model, content } of bestMsg.values()) {
    const t = extractUsageTokens(usage);
    addInto(tokens, t);
    perModelTokens[model] ??= zero();
    addInto(perModelTokens[model], t);
    modelMsgCounts[model] = (modelMsgCounts[model] ?? 0) + 1;
    collectTools(content, toolCounts);
  }

  return {
    tokens, perModelTokens, modelMsgCounts, toolCounts,
    assistantMsgCount: bestMsg.size,
    timestampsMs: timestamps.sort((a, b) => a - b),
    ccVersion,
  };
}

function collectTools(content: unknown, into: Record<string, number>): void {
  if (!Array.isArray(content)) return;
  for (const b of content)
    if (b && typeof b === "object" && (b as any).type === "tool_use" && (b as any).name)
      into[(b as any).name] = (into[(b as any).name] ?? 0) + 1;
}
