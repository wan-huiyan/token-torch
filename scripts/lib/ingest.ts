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
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildByCategoryPerModel, totalTokens, type TokenSet } from "./pricing";
import { normalizeProject } from "./projects";
import { parseEffortMarker } from "./effort";
import { deriveTimePhases, type TimeEvent, type TimePhases } from "./timePhases";

export const defaultProjectsDir = (): string => join(homedir(), ".claude", "projects");

// Used by deriveTime — kept here so the constants live next to the parser.
const MS_PER_MIN = 60_000;
export const GAP_IDLE_MS = 120_000; // >120s between events = you-away (idle), not compute

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

/** Merge two per-model token maps into a fresh one (used to combine main + subagent). */
export function mergePerModelTokens(
  a: Record<string, TokenSet>,
  b: Record<string, TokenSet>,
): Record<string, TokenSet> {
  const out: Record<string, TokenSet> = {};
  for (const src of [a, b]) for (const [m, t] of Object.entries(src)) { out[m] ??= zero(); addInto(out[m], t); }
  return out;
}

/** Collapse a per-model token map to one aggregate TokenSet. */
export function mergeTokenSets(perModel: Record<string, TokenSet>): TokenSet {
  const out = zero();
  for (const t of Object.values(perModel)) addInto(out, t);
  return out;
}

/** #75 — "ran long / got heavy" context threshold (tokens). Mirrors Claude Code's
 *  native /usage ">150k context" bucket. A turn's context = cache_read + cache_write +
 *  fresh_input (all input tokens that request). */
export const HEAVY_CONTEXT_THRESHOLD = 150_000;

export interface ParsedTranscript {
  tokens: TokenSet;                          // aggregate (non-sidechain)
  perModelTokens: Record<string, TokenSet>;  // model id → tokens
  modelMsgCounts: Record<string, number>;    // model id → kept assistant msg count
  toolCounts: Record<string, number>;
  assistantMsgCount: number;                 // deduped, non-sidechain
  scaffoldingFloor: number;                  // min nonzero cache_read across kept turns = base context re-read each turn (0 if none)
  turnCount: number;                         // count of kept turns with cache_read > 0
  peakContextTokens: number;                 // #75 — max per-turn (cache_read+cache_write+fresh_input)
  heavyContextTokens: number;                // #75 — Σ billed tokens on turns where context > HEAVY_CONTEXT_THRESHOLD
  timestampsMs: number[];                    // ALL row timestamps, sorted asc
  ccVersion?: string;
  observedEffort?: string;                   // value from a /effort local-command-stdout marker, if any (last-write-wins)
  // S11 redesign: REAL time-phase analytics (deriveTimePhases over ALL rows). The
  // raw events[] are NOT cached — only the derived result is stored here (bump
  // CACHE_VERSION when this shape changes).
  timePhases: TimePhases;
  headline?: string;                         // first real human prompt text (trimmed), if any
}

/** Machine-message prefixes that are NOT a real human prompt (command wrappers,
 *  caveats, system reminders, the agent task-notification relay). */
const HEADLINE_NOISE_PREFIXES = ["<local-command-", "<command-", "<system-reminder", "<task-notification", "Caveat:"];

/** A session's first REAL human prompt → a short card memory-aid. Collapses
 *  control chars/newlines, strips a leading command/reminder wrapper line, trims
 *  to ~120 chars. Returns undefined when nothing usable is found (honest omit). */
export function cleanHeadline(raw: string): string | undefined {
  let s = raw.replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  for (const p of HEADLINE_NOISE_PREFIXES) if (s.startsWith(p)) return undefined;
  if (s.length > 120) s = s.slice(0, 119).trimEnd() + "…";
  return s || undefined;
}

/** True when a user-string row is machine noise (command/caveat/reminder/relay),
 *  not a genuine human prompt. */
function isNoiseUserString(s: string): boolean {
  const t = s.trimStart();
  return HEADLINE_NOISE_PREFIXES.some((p) => t.startsWith(p));
}

/** Parse one-or-more transcript files for ONE session (worktree fanout) into raw
 *  numbers. Dedup assistant messages by message.id keeping the max-output chunk. */
export function parseMainTranscript(paths: string[]): ParsedTranscript {
  // dedup across all files: message.id → the richest (max output_tokens) message obj
  const bestMsg = new Map<string, { usage: RawUsage; model: string; content: unknown }>();
  const timestamps: number[] = [];
  let ccVersion: string | undefined;
  // /effort marker: keep the value from the latest-timestamped genuine marker (last-write-wins).
  let observedEffort: string | undefined;
  let observedEffortTsMs = -Infinity;
  // S11: ONE lightweight event per timestamped row → deriveTimePhases. Built in
  // THIS loop (independent of the token dedup) so it covers the EXACT timestamp
  // set deriveTime() walks — that makes timePhases-idle ⊆ deriveTime-idle by
  // construction, so the verify() phase-sum bounds hold (advisor point #2).
  const events: TimeEvent[] = [];
  // first real human prompt (string content, not a command/caveat/reminder/relay) → card headline.
  let headline: string | undefined;

  for (const p of paths) {
    let text: string;
    try { text = readFileSync(p, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line) continue;
      let r: any;
      try { r = JSON.parse(line); } catch { continue; }
      let rowTsMs = NaN;
      if (typeof r.timestamp === "string") {
        const t = Date.parse(r.timestamp);
        if (!Number.isNaN(t)) { timestamps.push(t); rowTsMs = t; }
      }
      if (typeof r.version === "string" && (!ccVersion || r.version > ccVersion)) ccVersion = r.version;
      // /effort marker lives in a user message whose content is the raw stdout STRING.
      // Gate tightly on the local-command-stdout wrapper to dodge assistant-quoted text.
      if (r.type === "user" && typeof r.message?.content === "string" &&
          r.message.content.includes("<local-command-stdout>Set effort level to")) {
        const inner = r.message.content.replace(/^.*<local-command-stdout>/s, "").replace(/<\/local-command-stdout>.*$/s, "");
        const val = parseEffortMarker(inner);
        const ts = Number.isNaN(rowTsMs) ? -Infinity : rowTsMs;
        if (val && ts >= observedEffortTsMs) { observedEffort = val; observedEffortTsMs = ts; }
      }

      // ---- time-phase events: one event per TIMESTAMPED row (advisor point #2) ----
      // sidechain rows are time-advancers only (their tool calls are subagent-internal),
      // so they're kind:"other" — no open/close/turn semantics from the main walk.
      if (!Number.isNaN(rowTsMs)) {
        if (r.type === "assistant" && !r.isSidechain && r.message?.id) {
          events.push({ ts: rowTsMs, kind: "assistant", msgId: r.message.id });
          // a row's content may hold tool_use block(s) (Agent/Workflow/Bash/…); each
          // opens a tool at this row's ts. (Blocks of one msg may span rows.)
          for (const b of contentBlocks(r.message.content))
            if (b.type === "tool_use" && b.id)
              events.push({ ts: rowTsMs, kind: "tool_use", toolId: b.id, toolName: b.name });
        } else if (r.type === "user" && !r.isSidechain) {
          const c = r.message?.content;
          if (Array.isArray(c)) {
            let emittedResult = false;
            for (const b of c)
              if (b && typeof b === "object" && b.type === "tool_result" && b.tool_use_id) {
                events.push({ ts: rowTsMs, kind: "tool_result", toolUseId: b.tool_use_id });
                emittedResult = true;
              }
            if (!emittedResult) events.push({ ts: rowTsMs, kind: "other" });
          } else if (typeof c === "string") {
            // a STRING user content is a human prompt (turn trigger) — unless it's
            // a command/caveat/reminder/relay wrapper, which is machine noise.
            events.push({ ts: rowTsMs, kind: isNoiseUserString(c) ? "other" : "human" });
            if (headline === undefined && !isNoiseUserString(c)) headline = cleanHeadline(c);
          } else {
            events.push({ ts: rowTsMs, kind: "other" });
          }
        } else {
          events.push({ ts: rowTsMs, kind: "other" }); // sidechain / queue-op / hook / etc.
        }
      }

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
  // scaffolding floor: the smallest nonzero cache_read across kept turns is the
  // base-context prefix (system prompt + tool/skill catalog + earliest convo) re-read
  // on EVERY turn. Calibrated; see docs/calibration/2026-06-03-context-overhead-calibration.md.
  // Running min (not Math.min(...spread)) to stay safe on very long sessions.
  let scaffoldingFloor = 0;
  let turnCount = 0;
  // #75: per-turn context size = the input context that turn (cache_read + cache_write +
  // fresh_input). peakContextTokens = the heaviest turn; heavyContextTokens = billed tokens
  // (context + output) on turns whose context exceeded HEAVY_CONTEXT_THRESHOLD — the share
  // of throughput spent in large contexts (cheap when cached, but the "ran long" signal).
  let peakContextTokens = 0;
  let heavyContextTokens = 0;
  for (const { usage, model, content } of bestMsg.values()) {
    const t = extractUsageTokens(usage);
    addInto(tokens, t);
    perModelTokens[model] ??= zero();
    addInto(perModelTokens[model], t);
    modelMsgCounts[model] = (modelMsgCounts[model] ?? 0) + 1;
    collectTools(content, toolCounts);
    const ctx = t.cache_read + t.cache_write + t.fresh_input;
    if (ctx > peakContextTokens) peakContextTokens = ctx;
    if (ctx > HEAVY_CONTEXT_THRESHOLD) heavyContextTokens += ctx + t.output;
    if (t.cache_read > 0) {
      turnCount++;
      scaffoldingFloor = scaffoldingFloor === 0 ? t.cache_read : Math.min(scaffoldingFloor, t.cache_read);
    }
  }

  return {
    tokens, perModelTokens, modelMsgCounts, toolCounts,
    assistantMsgCount: bestMsg.size,
    scaffoldingFloor,
    turnCount,
    peakContextTokens,
    heavyContextTokens,
    timestampsMs: timestamps.sort((a, b) => a - b),
    timePhases: deriveTimePhases(events),
    ...(headline ? { headline } : {}),
    ccVersion,
    ...(observedEffort ? { observedEffort } : {}),
  };
}

function collectTools(content: unknown, into: Record<string, number>): void {
  if (!Array.isArray(content)) return;
  for (const b of content)
    if (b && typeof b === "object" && (b as any).type === "tool_use" && (b as any).name)
      into[(b as any).name] = (into[(b as any).name] ?? 0) + 1;
}

/** Normalize a message.content to an array of `{type,id,name,tool_use_id}` blocks
 *  (string content → none). Used by the time-phase event collector. */
function contentBlocks(content: unknown): Array<{ type: string; id?: string; name?: string; tool_use_id?: string }> {
  if (!Array.isArray(content)) return [];
  const out: Array<{ type: string; id?: string; name?: string; tool_use_id?: string }> = [];
  for (const b of content) if (b && typeof b === "object" && (b as any).type) out.push(b as any);
  return out;
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
  scaffoldingFloor: number; // min nonzero cache_read across turns (base-context floor, issue #10)
  turnCount: number;        // turns that read the cached prefix
  peakContextTokens: number;  // #75 — heaviest per-turn context (cache_read+cache_write+fresh_input)
  heavyContextTokens: number; // #75 — Σ billed tokens on turns with context > HEAVY_CONTEXT_THRESHOLD
  toolCounts: Record<string, number>;
  hasUsage: boolean;
  ccVersion?: string;
  observedEffort?: string; // /effort marker value, if the transcript had one
  startedAtMs?: number;    // first event ms — for the effort confidence cutoff (ms precision)
  timestampsMs?: number[];   // all event timestamps (for B4 5-hour-window derivation; in-memory only, not serialized)
  timePhases: TimePhases;    // S11: real per-session time-phase analytics
  headline?: string;         // S11: first real human prompt text (trimmed)
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

export interface IngestCache {
  [path: string]: { mtimeMs: number; size: number; parsed: ParsedTranscript };
}

/** On-disk cache envelope. Bump CACHE_VERSION whenever the cached ParsedTranscript
 *  blob shape changes — a stale cache would silently serve the OLD shape. v2 added
 *  `observedEffort`; a v1/legacy cache lacking it would downgrade observed sessions
 *  to inferred_default (an L9-class silent loss), so we discard on mismatch. v3 added
 *  scaffoldingFloor/turnCount; a v2 cache lacking them would serve 0 (silent
 *  under-report of context overhead), so we discard on mismatch. v4 (S11) added
 *  timePhases + headline; a v3 cache lacking them would serve an empty time-phase
 *  degrade (silent loss of the ribbon/donut/turns), so we discard on mismatch. v5
 *  (S11) changed the phase classification — interactive (AskUserQuestion) gaps now
 *  count as you-away idle, NOT machine tool_min; a v4 cache holds the old phase
 *  results (tool_min inflated by you-answering time), so we discard on mismatch. v6
 *  (#75) added peakContextTokens/heavyContextTokens; a v5 cache lacking them would
 *  serve 0 (silent under-report of the heavy-context usage signal), so we discard. */
export const CACHE_VERSION = 6;
interface CacheFile { version: number; entries: IngestCache; }

export const cacheKeyFor = (path: string): string => path;

/** Parse a session's transcript(s), reusing cached results when every file's
 *  (mtimeMs, size) is unchanged. Mutates `cache`. `parser` is injected for tests. */
export function parseWithCache(
  paths: string[],
  cache: IngestCache,
  parser: (paths: string[]) => ParsedTranscript = parseMainTranscript,
): ParsedTranscript {
  let allHit = true;
  for (const p of paths) {
    let st;
    try { st = statSync(p); } catch { allHit = false; break; }
    const e = cache[cacheKeyFor(p)];
    if (!e || e.mtimeMs !== st.mtimeMs || e.size !== st.size) { allHit = false; break; }
  }
  // A multi-file session is cached under its first file's key (carrying the merged parse).
  const primary = cacheKeyFor(paths[0]);
  if (allHit && cache[primary]) return cache[primary].parsed;

  const parsed = parser(paths);
  try {
    const st = statSync(paths[0]);
    cache[primary] = { mtimeMs: st.mtimeMs, size: st.size, parsed };
  } catch { /* unstatable first file — skip caching */ }
  return parsed;
}

/** Load the on-disk cache, discarding anything that isn't the current versioned
 *  envelope (legacy unversioned files included → {} forces a clean re-parse). */
export function loadCache(cachePath: string): IngestCache {
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf8")) as Partial<CacheFile>;
    if (raw && raw.version === CACHE_VERSION && raw.entries) return raw.entries;
    return {};
  } catch { return {}; }
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
    scaffoldingFloor: parsed.scaffoldingFloor,
    turnCount: parsed.turnCount,
    peakContextTokens: parsed.peakContextTokens,
    heavyContextTokens: parsed.heavyContextTokens,
    toolCounts: parsed.toolCounts,
    hasUsage: tot > 0,
    ccVersion: parsed.ccVersion,
    ...(parsed.observedEffort ? { observedEffort: parsed.observedEffort } : {}),
    ...(parsed.timestampsMs.length ? { startedAtMs: parsed.timestampsMs[0] } : {}),
    timestampsMs: parsed.timestampsMs,
    timePhases: parsed.timePhases,
    ...(parsed.headline ? { headline: parsed.headline } : {}),
  };
}

export interface IngestResult {
  records: SessionRecord[];
  discovered: number;  // distinct session uuids with a main transcript
  kept: number;
  droppedFloor: number;        // TOTAL floored (incl. no-usage); kept + droppedFloor == discovered
  droppedWithUsage: number;    // subset of droppedFloor that carried real usage (would have cost $)
  droppedWithUsageUsd: number; // recomputed per-model $ of those usage-bearing floored sessions (round2)
  droppedIds: string[]; // 8-char ids dropped by the floor (count is the load-bearing field; ids for optional logging)
}

const UUID_RE = /^[0-9a-f-]{30,}$/i;

/** Enumerate + group + parse + floor. Persists the incremental cache. */
export function ingestSessions(projectsDir = defaultProjectsDir(), cachePath?: string): IngestResult {
  // uuid → { paths: string[], dirs: string[] }
  const byUuid = new Map<string, { paths: string[]; dirs: string[] }>();
  let projects: string[];
  try { projects = readdirSync(projectsDir); } catch { return { records: [], discovered: 0, kept: 0, droppedFloor: 0, droppedWithUsage: 0, droppedWithUsageUsd: 0, droppedIds: [] }; }
  for (const dir of projects) {
    const dirPath = join(projectsDir, dir);
    let entries: string[];
    try { if (!statSync(dirPath).isDirectory()) continue; entries = readdirSync(dirPath); } catch { continue; }
    for (const fn of entries) {
      if (!fn.endsWith(".jsonl")) continue;
      const uuid = fn.slice(0, -6);
      if (!UUID_RE.test(uuid)) continue;
      const e = byUuid.get(uuid) ?? { paths: [], dirs: [] };
      e.paths.push(join(dirPath, fn));
      e.dirs.push(dir);
      byUuid.set(uuid, e);
    }
  }

  const cache: IngestCache = cachePath ? loadCache(cachePath) : {};
  const records: SessionRecord[] = [];
  const droppedIds: string[] = [];
  // Floored-but-usage-bearing accounting: these sessions DID cost money but are
  // excluded from the headline total by the substance floor — surfaced honestly
  // downstream (coverage flag) instead of vanishing silently.
  let droppedWithUsage = 0;
  let droppedWithUsageUsd = 0;
  for (const [uuid, { paths, dirs }] of byUuid) {
    const parsed = parseWithCache(paths, cache);
    // choose the longest decoded project name across the session's worktree dirs
    const decoded = dirs.map(decodeProjectDir).sort((a, b) => b.length - a.length)[0] ?? "unknown";
    const rec = buildSessionRecord({
      id: uuid.slice(0, 8), sessionUuid: uuid, rawProjectDirs: dirs,
      decodedProject: decoded, projectFn: normalizeProject, parsed,
    });
    if (passesFloor(rec)) records.push(rec);
    else {
      droppedIds.push(rec.id);
      if (rec.hasUsage) {
        droppedWithUsage += 1;
        droppedWithUsageUsd += buildByCategoryPerModel(rec.perModelTokens).totalUsd;
      }
    }
  }

  if (cachePath) {
    try { mkdirSync(join(cachePath, ".."), { recursive: true }); writeFileSync(cachePath, JSON.stringify({ version: CACHE_VERSION, entries: cache })); } catch { /* cache is best-effort */ }
  }

  records.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return {
    records,
    discovered: byUuid.size,
    kept: records.length,
    droppedFloor: droppedIds.length,
    droppedWithUsage,
    droppedWithUsageUsd: round2(droppedWithUsageUsd),
    droppedIds,
  };
}
