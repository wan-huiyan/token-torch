/* ============================================================================
 * Corpus loader + multi-schema reconciler.
 *
 * Reads ~/.claude/usage-tracking/*.json. THREE record schemas coexist:
 *   - Schema A (cctime per-session): key `sessionId`. Rich enhancedSegments /
 *     toolLatencies / turnMetrics / tokens / subagents. Canonical for the
 *     time-ribbon, tool latencies, and per-turn pulse.
 *   - Schema B (`_full`, key `schema` = "s222-full-usage-v1"): pricing table +
 *     grand_total + reconciliation_note. A point-in-time snapshot; contributes
 *     only the reconciliation note.
 *   - Schema C (key `schema_version` + `session_id`): the per-model cost record.
 *     Has tokens.{main_loop,subagents_total,grand_total}, per-model cost, AND
 *     cost_estimate_usd.subagents_per_dispatch. No segments/latencies/turns, so
 *     its detail degrades (no ribbon/pulse/tool-leaderboard).
 *
 * One session id can have several files (086db3e4 = A + B). We never average
 * across schemas/fidelities (lesson cctime-record-main-loop-inflated-by-stale-
 * binary): costs are ALWAYS recomputed from token counts at one rate table, so
 * the dashboard is internally consistent. A record's stored $ (incl. Schema C's
 * per-model figure) is surfaced as a reconciliation note, not blended in.
 * ========================================================================== */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SchemaASubagents {
  count: number;
  workflowCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  costUsd: number;
}

export interface SchemaARecord {
  sessionId: string;
  summary?: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  stats?: Record<string, number>;
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  cacheHitRate: number;
  models: Record<string, number>;
  tools: Record<string, number>;
  enhancedStats?: {
    humanWait: number;
    humanAway: number;
    claudeThink: number;
    toolExec: number;
    subagent: number;
    planning: number;
  };
  enhancedSegments?: { phase: string; startTime: number; endTime: number; durationMs: number; toolName?: string }[];
  toolLatencies?: { name: string; count: number; totalMs: number; avgMs: number; p50Ms: number; p95Ms: number }[];
  turnMetrics?: { turnIndex: number; responseMs: number }[];
  turnCount?: number;
  avgResponseMs?: number;
  estimatedCostUsd?: number;
  subagents?: SchemaASubagents;
}

export interface SchemaBRecord {
  schema: string;
  session: string;
  date?: string;
  project?: string;
  pricing_per_mtok_usd?: { input: number; output: number; cache_write: number; cache_read: number };
  main_loop?: { in_fresh: number; output: number; cache_write: number; cache_read: number; cost_usd: number };
  grand_total?: { in_fresh: number; output: number; cache_write: number; cache_read: number; cost_usd: number };
  subagents_only?: { share_of_grand_total_pct?: number; cost_usd?: number };
  reconciliation_note?: string;
  cross_check?: string;
}

export interface SchemaCTokenBlock {
  input_fresh: number;
  output: number;
  cache_read: number;
  cache_creation: number;
}

export interface SchemaCRecord {
  schema_version: string;
  session_id: string;
  project?: string;
  started_at_utc?: string;
  ended_at_utc?: string;
  elapsed_wall_clock_hours?: number;
  claude_active_minutes?: number;
  human_idle_minutes?: number;
  tokens: {
    main_loop: SchemaCTokenBlock;
    subagents_total?: SchemaCTokenBlock;
    grand_total: SchemaCTokenBlock;
    cache_hit_pct?: number;
  };
  cost_estimate_usd?: {
    main_loop?: number;
    subagents_total?: number;
    grand_total?: number;
    subagents_per_dispatch?: Record<string, number>;
    pricing_basis?: string;
  };
  tool_calls_main_loop?: Record<string, number>;
  subagent_dispatches?: { count: number; per_agent?: Record<string, unknown> };
}

export interface SessionGroup {
  id: string; // 8-char id
  date: string; // ISO date from filename, fallback from record
  project: string; // raw project from filename (normalize later)
  a?: SchemaARecord;
  b?: SchemaBRecord;
  c?: SchemaCRecord;
  fileCount: number;
}

const isSchemaA = (o: any): o is SchemaARecord => o && typeof o.sessionId === "string";
const isSchemaB = (o: any): o is SchemaBRecord =>
  o && typeof o.schema === "string" && (o.grand_total || o.main_loop);
const isSchemaC = (o: any): o is SchemaCRecord =>
  o && typeof o.schema_version === "string" && typeof o.session_id === "string" && o.tokens;

/** Parse `YYYY-MM-DD_<id8>_<project...>[_full].json` → {date,id,project,isFull}. */
export function parseFilename(name: string): { date?: string; id?: string; project?: string; isFull: boolean } | null {
  if (!name.endsWith(".json")) return null;
  const base = name.slice(0, -".json".length);
  const isFull = base.endsWith("_full");
  const core = isFull ? base.slice(0, -"_full".length) : base;
  const m = core.match(/^(\d{4}-\d{2}-\d{2})_([0-9a-f]{6,})_(.+)$/i);
  if (m) return { date: m[1], id: m[2].slice(0, 8), project: m[3], isFull };
  return { isFull }; // dateless / id-only file — fall back to record fields
}

export function loadCorpus(dir: string): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue; // skip .md companions, extensionless files, dirs
    const meta = parseFilename(name);
    let obj: any;
    try {
      obj = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      continue;
    }

    let id: string | undefined;
    if (isSchemaA(obj)) id = obj.sessionId.slice(0, 8);
    else if (isSchemaC(obj)) id = (obj.session_id || meta?.id || "").slice(0, 8);
    else if (isSchemaB(obj)) id = (obj.session || meta?.id || "").slice(0, 8);
    if (!id && meta?.id) id = meta.id;
    if (!id) continue;

    const g =
      groups.get(id) ??
      ({ id, date: meta?.date ?? "", project: meta?.project ?? "", fileCount: 0 } as SessionGroup);
    g.fileCount += 1;
    if (meta?.date && !g.date) g.date = meta.date;
    if (meta?.project && (!g.project || meta.project.length > g.project.length)) g.project = meta.project;

    if (isSchemaA(obj)) g.a = obj;
    else if (isSchemaC(obj)) g.c = obj;
    else if (isSchemaB(obj)) g.b = obj;

    groups.set(id, g);
  }

  // fallbacks for date/project from record bodies if filename lacked them
  for (const g of groups.values()) {
    if (!g.date) {
      const ts = g.a?.startTime ?? undefined;
      if (ts) g.date = new Date(ts).toISOString().slice(0, 10);
      else if (g.c?.started_at_utc) g.date = g.c.started_at_utc.slice(0, 10);
      else if (g.b?.date) g.date = g.b.date;
    }
    if (!g.project) g.project = g.c?.project ?? g.b?.project ?? g.project;
  }
  return [...groups.values()];
}

/** Build the reconciliation note when Schema A and B disagree, or carry B's note. */
export function reconciliationNote(g: SessionGroup, recomputedTotalUsd: number): string | undefined {
  if (!g.b) return undefined;
  if (g.b.reconciliation_note) return g.b.reconciliation_note;
  const bTotal = g.b.grand_total?.cost_usd;
  if (bTotal != null && Math.abs(bTotal - recomputedTotalUsd) >= 1) {
    const delta = Math.abs(bTotal - recomputedTotalUsd).toFixed(2);
    return `A second record for this session disagreed by $${delta}; kept the recomputed cctime figure (subagent-inclusive, current rates).`;
  }
  return undefined;
}
