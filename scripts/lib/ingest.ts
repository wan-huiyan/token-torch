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
import { totalTokens, type TokenSet } from "./pricing";

export const defaultProjectsDir = (): string => join(homedir(), ".claude", "projects");

// Used by deriveTime — kept here so the constants live next to the parser.
const MS_PER_MIN = 60_000;
const GAP_IDLE_MS = 120_000; // >120s between events = you-away (idle), not compute

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

/** Path-encoded project dir → logical base name (pre-alias). Strips the
 *  `--claude-worktrees-<slug>` suffix and the `-Users-<user>-Documents-` prefix
 *  encoding, returning the trailing project segment. normalizeProject() applies
 *  the user's alias map afterward. */
export function decodeProjectDir(dirName: string): string {
  let d = dirName.replace(/--claude-worktrees-.*$/i, "");
  // path-encoded: leading "-" then segments joined by "-". Drop a leading
  // "-Users-<user>-Documents-" / "-Users-<user>-" prefix; keep the remainder.
  d = d.replace(/^-Users-[^-]+-Documents-/i, "").replace(/^-Users-[^-]+-?/i, "");
  if (!d) {
    // bare "-Users-huiyanwan" → last segment of the original
    const segs = dirName.replace(/^-/, "").split("-").filter(Boolean);
    return segs[segs.length - 1] || "unknown";
  }
  return d;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface DerivedTime { wallClockMin: number; activeMin: number; idleMin: number; }

/** Wall = last−first event. Idle = Σ inter-event gaps over 120s. Active = wall−idle.
 *  Heuristic (the threshold is arbitrary) — same rule the Schema-C path documents. */
export function deriveTime(timestampsMs: number[]): DerivedTime {
  if (timestampsMs.length < 2) return { wallClockMin: 0, activeMin: 0, idleMin: 0 };
  const sorted = [...timestampsMs].sort((a, b) => a - b);
  const wallMs = sorted[sorted.length - 1] - sorted[0];
  let idleMs = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > GAP_IDLE_MS) idleMs += gap;
  }
  return {
    wallClockMin: round2(wallMs / MS_PER_MIN),
    activeMin: round2((wallMs - idleMs) / MS_PER_MIN),
    idleMin: round2(idleMs / MS_PER_MIN),
  };
}

export interface SessionRecord {
  id: string;                 // 8-char
  sessionUuid: string;
  date: string;               // ISO date (from first event)
  project: string;            // logical (decoded + normalizeProject)
  rawProjectDirs: string[];   // source dirs (worktree fanout)
  tokens: TokenSet;           // aggregate
  perModelTokens: Record<string, TokenSet>;
  modelMsgCounts: Record<string, number>;
  dominantModel: string;      // family-ish label for the existing `model` field ("opus"/"sonnet"/"haiku"/raw)
  cacheHitPct: number;        // 0–100
  wallClockMin: number;
  activeMin: number;
  idleMin: number;
  assistantMsgCount: number;
  toolCounts: Record<string, number>;
  hasUsage: boolean;
  ccVersion?: string;
}

const FLOOR_MIN_ASSISTANT_MSGS = 10;

/** Substance floor: keep only sessions with real activity AND usage data. */
export function passesFloor(r: SessionRecord): boolean {
  return r.hasUsage && r.assistantMsgCount >= FLOOR_MIN_ASSISTANT_MSGS;
}

function dominantModelLabel(modelMsgCounts: Record<string, number>): string {
  let best = "opus", bestN = -1;
  for (const [m, n] of Object.entries(modelMsgCounts)) if (n > bestN) { bestN = n; best = m; }
  // collapse to family label for the existing `model` field; keep raw if unknown family
  const lower = best.toLowerCase();
  if (lower.includes("opus")) return "opus";
  if (lower.includes("sonnet")) return "sonnet";
  if (lower.includes("haiku")) return "haiku";
  return lower;
}

/** Assemble a SessionRecord from a parsed transcript + source metadata.
 *  `projectFn` is normalizeProject (injected to avoid a cycle in tests). */
export function buildSessionRecord(args: {
  id: string; sessionUuid: string; rawProjectDirs: string[]; decodedProject: string;
  projectFn: (raw: string) => string; parsed: ParsedTranscript;
}): SessionRecord {
  const { id, sessionUuid, rawProjectDirs, decodedProject, projectFn, parsed } = args;
  const t = deriveTime(parsed.timestampsMs);
  const tot = totalTokens(parsed.tokens);
  const cacheHitPct = tot ? round2((parsed.tokens.cache_read / tot) * 100) : 0;
  const date = parsed.timestampsMs.length
    ? new Date(parsed.timestampsMs[0]).toISOString().slice(0, 10)
    : "";
  return {
    id, sessionUuid, date,
    project: projectFn(decodedProject),
    rawProjectDirs,
    tokens: parsed.tokens,
    perModelTokens: parsed.perModelTokens,
    modelMsgCounts: parsed.modelMsgCounts,
    dominantModel: dominantModelLabel(parsed.modelMsgCounts),
    cacheHitPct,
    wallClockMin: t.wallClockMin,
    activeMin: t.activeMin,
    idleMin: t.idleMin,
    assistantMsgCount: parsed.assistantMsgCount,
    toolCounts: parsed.toolCounts,
    hasUsage: tot > 0,
    ccVersion: parsed.ccVersion,
  };
}
