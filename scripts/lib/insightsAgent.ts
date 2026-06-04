/* ============================================================================
 * Agent-session insights path (#33). KEY-FREE. The user's own agent (Claude Code /
 * Codex / Cursor / …) writes insights.local.md; this reads + GATES it server-side.
 *
 *   acceptAgentInsights(raw, data) -> PURE decision: returns the shippable markdown
 *       (trimmed) IFF every number passes validateInsightNumbers, else { md: null }
 *       with the offending tokens. This is the honesty gate — a fabricated number
 *       NEVER ships as insights_source:"agent".
 *   loadAgentInsights(path, data)  -> I/O wrapper mirroring buildInsightsLLM's
 *       validated-or-null contract: reads the file (null if absent/empty), validates,
 *       logs loudly on rejection, returns the markdown or null. generate.ts treats a
 *       null identically to "no API key" → template fallback.
 *
 * NOTE (next-hardening): the gate has no correction-retry loop (unlike the LLM path) and
 * inherits validateInsightNumbers' deliberate fail-OPEN on UNBOUND numbers (#27 — inline
 * PCN tag protocol is the documented follow-up). Acceptable first cut: the threat is the
 * user's own agent being inaccurate about the user's own data, and template fallback is
 * the real safety — no weaker than today's LLM path.
 * ========================================================================== */

import { existsSync, readFileSync } from "node:fs";
import type { DashboardData } from "../../src/types";
import { validateInsightNumbers } from "./insightsValidate";

export interface AgentInsightsDecision {
  /** the shippable, trimmed markdown, or null to fall back (template). */
  md: string | null;
  /** numeric tokens that failed the no-fabrication gate (for an honest log). */
  offending: string[];
}

/** PURE: decide whether the raw agent markdown may ship as insights_source:"agent". */
export function acceptAgentInsights(raw: string | null, data: DashboardData): AgentInsightsDecision {
  if (raw == null || !raw.trim()) return { md: null, offending: [] };
  const { ok, offending } = validateInsightNumbers(raw, data);
  return ok ? { md: raw.trim(), offending: [] } : { md: null, offending };
}

/** I/O wrapper: read insights.local.md, gate it, log loudly on rejection, return md or null. */
export function loadAgentInsights(path: string, data: DashboardData): string | null {
  if (!existsSync(path)) return null;
  const { md, offending } = acceptAgentInsights(readFileSync(path, "utf8"), data);
  if (md == null && offending.length)
    console.warn(
      `⚠ ${path} cites number(s) absent from the dashboard aggregates: ${offending.join(", ")} — ` +
        `discarding (using template insights). Re-run your agent on the current data.`,
    );
  return md;
}
