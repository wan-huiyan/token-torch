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
import { validateInsightNumbers, validateTaggedInsights } from "./insightsValidate";

export interface AgentInsightsDecision {
  /** the shippable, trimmed markdown (with any PCN tags STRIPPED), or null to fall back. */
  md: string | null;
  /** numeric tokens that failed the no-fabrication gate (for an honest log). */
  offending: string[];
  /** forbidden superlative/comparison/causal phrases that failed the vacuity gate (#37). */
  claims: string[];
  /** PCN model_mix tags that failed the fail-closed (entity,value) binding (#27). */
  taggedOffending: string[];
}

/** PURE: decide whether the raw agent markdown may ship as insights_source:"agent".
 *  Two gates: (1) the fail-CLOSED PCN tag check (#27) on the TAGGED text — a misattributed/
 *  fabricated/malformed [[mm:id=value]] tag rejects; (2) the existing fail-OPEN number/claim
 *  check on the STRIPPED text. The shipped md is always tag-free. */
export function acceptAgentInsights(raw: string | null, data: DashboardData): AgentInsightsDecision {
  if (raw == null || !raw.trim()) return { md: null, offending: [], claims: [], taggedOffending: [] };
  const tag = validateTaggedInsights(raw, data);
  if (!tag.ok) return { md: null, offending: [], claims: [], taggedOffending: tag.taggedOffending };
  const { ok, offending, claims } = validateInsightNumbers(tag.stripped, data);
  return ok
    ? { md: tag.stripped.trim(), offending: [], claims: [], taggedOffending: [] }
    : { md: null, offending, claims, taggedOffending: [] };
}

/** I/O wrapper: read insights.local.md, gate it, log loudly on rejection, return md or null. */
export function loadAgentInsights(path: string, data: DashboardData): string | null {
  if (!existsSync(path)) return null;
  const { md, offending, claims, taggedOffending } = acceptAgentInsights(readFileSync(path, "utf8"), data);
  if (md == null && (offending.length || claims.length || taggedOffending.length)) {
    const reasons = [
      offending.length ? `number(s) absent from the dashboard aggregates: ${offending.join(", ")}` : "",
      taggedOffending.length ? `misattributed model_mix tag(s): ${taggedOffending.join("; ")}` : "",
      claims.length ? `forbidden superlative/comparison/causal phrase(s): ${claims.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    console.warn(
      `⚠ ${path} contains ${reasons} — discarding (using template insights). ` +
        `Re-run your agent on the current data, citing only the listed numbers and no value judgments.`,
    );
  }
  return md;
}
