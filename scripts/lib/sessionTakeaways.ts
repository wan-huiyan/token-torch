/* ============================================================================
 * KEY-FREE per-session AI takeaway handshake (#52). NO @anthropic-ai/sdk import — this is what
 * lets `generate` emit the paste-ready bulk request and bake the agent's reply with no API key.
 * Mirrors the dashboard insights handshake (insightsPrompt.ts + insightsAgent.ts):
 *
 *   selectTakeawaySessions(details) -> the BOUNDED subset worth a hand-written note (top-cost
 *       ∪ most-recent). The template Takeaway is already honest, so partial coverage degrades
 *       gracefully — this just picks which sessions get an AI note.
 *   buildSessionTakeawaysRequest(selected) -> the paste-ready bulk prompt the user's own agent
 *       reads (per-session GROUND TRUTH + HARD RULES + an exact `## <id>` output format).
 *   acceptSessionTakeaways(raw, byId) -> PURE: parse the reply, validate EACH note against THAT
 *       session's own whitelist (validateSessionTakeaway), keep only survivors. A number from
 *       another session is fabrication for this one and is rejected → template fallback.
 *   loadSessionTakeaways(path, byId) -> I/O wrapper (absent file => empty decision).
 *
 * The safety gate is server-side (here), never in the agent — any agent / hand-edited file is
 * untrusted input. A rejected note simply falls back to the deterministic template Takeaway.
 * ========================================================================== */

import { existsSync, readFileSync } from "node:fs";
import type { SessionDetailData } from "../../src/types";
import { allowedNumbersSession, validateSessionTakeaway } from "./insightsValidate";

/** BUMP on any prompt/rule/format change (surfaced in the request header for provenance). */
export const SESSION_TAKEAWAY_PROMPT_VERSION = "2026-06-17-v1";

/** Bounded-subset scope (#52, user pick S19): the sessions a user actually inspects — the
 *  priciest + the most recent. Union, de-duped. Easy to widen later by raising these. */
export const TAKEAWAY_TOP_COST = 40;
export const TAKEAWAY_RECENT = 15;

/** The in-scope session ids: top TAKEAWAY_TOP_COST by cost ∪ TAKEAWAY_RECENT most recent
 *  (date desc, cost as tiebreak). Order: cost-ranked first, then any recent-only additions. */
export function selectTakeawaySessions(details: SessionDetailData[]): string[] {
  const byCost = [...details].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, TAKEAWAY_TOP_COST);
  const byRecent = [...details]
    .sort((a, b) => (a.date === b.date ? b.cost_usd - a.cost_usd : a.date < b.date ? 1 : -1))
    .slice(0, TAKEAWAY_RECENT);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const d of [...byCost, ...byRecent]) {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      ids.push(d.id);
    }
  }
  return ids;
}

/** One session's GROUND-TRUTH block: the figures a takeaway may cite, in MINUTES for durations,
 *  plus the explicit citable-number list the validator re-checks against. */
export function buildSessionContextBlock(s: SessionDetailData): string {
  const t = s.time;
  const ab = t.active_breakdown;
  const allowed = allowedNumbersSession(s)
    .map((n) => (Number.isInteger(n) ? String(n) : n.toFixed(2)))
    .join(", ");
  const activeShare = t.wall_clock_min > 0 ? ((t.active_min / t.wall_clock_min) * 100).toFixed(1) : null;
  const cacheRead = s.cost.by_category?.cache_read;
  return [
    `### ${s.id} — project ${s.project}`,
    `- Wall-clock: ${t.wall_clock_min} min; real compute (active): ${t.active_min} min${activeShare ? ` (${activeShare}% of wall-clock)` : ""}; idle (you-away): ${t.idle_min} min`,
    `- Active split (min): thinking ${ab.thinking_min}, tool ${ab.tool_min}, subagent ${ab.subagent_min}, planning ${ab.planning_min}`,
    `- Cache hit: ${s.tokens.cache_hit_pct}%; estimated cost: $${s.cost_usd}${cacheRead ? `; cache-read share of the bill: ${cacheRead.cost_pct}%` : ""}`,
    `- Citable numbers (cite ONLY these; durations in minutes): ${allowed}`,
  ].join("\n");
}

/** The full paste-ready bulk prompt an agent reads to write session-takeaways.local.md. */
export function buildSessionTakeawaysRequest(selected: SessionDetailData[]): string {
  const head = [
    "# Token Torch — write my per-session takeaways (paste this whole file to your coding agent)",
    `<!-- prompt version: ${SESSION_TAKEAWAY_PROMPT_VERSION} -->`,
    "",
    "You are my coding agent (Claude Code / Codex / Cursor / …). For EACH session below, write ONE",
    "short, punchy takeaway sentence in the retro-ARCADE voice of the dashboard (a single tasteful",
    "emoji accent is welcome: 🔥 🪙 🌙 ⚡ 🎮). Tie the run's time-vs-money story together — wall-clock",
    "vs real compute, cache, estimated cost. Then SAVE them all to a file named",
    "`session-takeaways.local.md` in this directory and tell me to run `pnpm generate` again.",
    "",
    "OUTPUT FORMAT (exact) — for each session, a heading line `## <id>` (the id shown in its block),",
    "then the single takeaway sentence on the next line:",
    "",
    "## 0044c133",
    "🔥 Spanned 73 min but only 18 were real compute — cache hits at 96% kept the est. bill light.",
    "",
    "HARD RULES (the generator re-validates every number server-side and DISCARDS — falling back to",
    "the built-in template — any note that breaks them; a wrong figure can never ship):",
    "1. Every number MUST be one of THAT session's citable numbers in its block below. Invent NO",
    "   figures and do not recompute ratios/sums/trends. Cite durations in MINUTES.",
    "2. No superlatives, performance comparisons, or causal claims (no best / worst / faster /",
    "   slower / because / due to …). Describe the run; pass no judgment.",
    "3. Costs are ESTIMATES — say 'about' or 'est.' where natural. Write no dates (the UI supplies them).",
    "4. ONE sentence per session, under ~35 words. Spell out small structural counts as words.",
    "",
    "----------------------------------------------------------------------",
    "",
  ];
  const blocks = selected.map(buildSessionContextBlock).join("\n\n");
  const tail = [
    "",
    "----------------------------------------------------------------------",
    "",
    "Write `session-takeaways.local.md` (one `## <id>` heading + one sentence per session), then run `pnpm generate`.",
  ];
  return [...head, blocks, ...tail].join("\n");
}

/* ---- parse + validate the agent's reply ------------------------------------------------- */

export interface ParsedTakeaway {
  id: string;
  md: string;
}

/** A heading line keying the next takeaway: `## <id>`, tolerating `### `, an optional "session"
 *  prefix, and backticks. The id is captured permissively (any \w-ish token); unknown ids are
 *  dropped at the accept step, so over-matching a stray heading is harmless. */
const HEADER_RE = /^#{1,6}\s*(?:session[:\s]+)?`?([\w-]{4,40})`?\s*$/i;

/** Split the reply into { id, md } sections by `## <id>` headings (body = lines until the next). */
export function parseSessionTakeaways(raw: string): ParsedTakeaway[] {
  const out: ParsedTakeaway[] = [];
  let curId: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (curId) {
      const md = buf.join("\n").trim();
      if (md) out.push({ id: curId, md });
    }
    buf = [];
  };
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(HEADER_RE);
    if (m) {
      flush();
      curId = m[1].toLowerCase();
    } else if (curId) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

export interface SessionTakeawayDecision {
  /** id -> validated takeaway markdown (the survivors that may bake as source "agent"). */
  accepted: Map<string, string>;
  /** notes whose numbers/claims failed THIS session's gate (logged; fall back to template). */
  rejected: { id: string; offending: string[]; claims: string[] }[];
  /** ids in the file with no matching in-corpus session (stale/typo; ignored). */
  unknown: string[];
}

/** PURE: parse + validate each note against ITS session's whitelist. Survivors only. */
export function acceptSessionTakeaways(
  raw: string | null,
  byId: Map<string, SessionDetailData>,
): SessionTakeawayDecision {
  const accepted = new Map<string, string>();
  const rejected: SessionTakeawayDecision["rejected"] = [];
  const unknown: string[] = [];
  if (!raw || !raw.trim()) return { accepted, rejected, unknown };
  for (const { id, md } of parseSessionTakeaways(raw)) {
    const s = byId.get(id);
    if (!s) {
      unknown.push(id);
      continue;
    }
    const { ok, offending, claims } = validateSessionTakeaway(md, s);
    if (ok) accepted.set(id, md);
    else rejected.push({ id, offending, claims });
  }
  return { accepted, rejected, unknown };
}

/** I/O wrapper: read session-takeaways.local.md, validate, return the decision (empty if absent). */
export function loadSessionTakeaways(path: string, byId: Map<string, SessionDetailData>): SessionTakeawayDecision {
  if (!existsSync(path)) return { accepted: new Map(), rejected: [], unknown: [] };
  return acceptSessionTakeaways(readFileSync(path, "utf8"), byId);
}
