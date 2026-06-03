/* ============================================================================
 * Pure honesty gate for LLM-generated insights. No API, no I/O.
 *
 * allowedNumbers(data)  -> the whitelist of numeric values the LLM is allowed to
 *                          cite, drawn from DASHBOARD-LEVEL AGGREGATES ONLY (never
 *                          sessions[], which would make the check vacuous).
 * validateInsightNumbers(prose, data) -> { ok, offending } : every $/%/integer-count
 *                          token in `prose` must match an allowed value within a
 *                          documented tolerance, else it is "offending" (fabricated).
 *
 * This file is unit-tested without any API key — it is the project's honesty spine
 * (ADR 0001/0002, L4/L7). The actual LLM call is exercised only when a key exists.
 * ========================================================================== */

import type { DashboardData } from "../../src/types";

export interface ValidationResult {
  ok: boolean;
  /** numeric tokens found in the prose that match no allowed value. */
  offending: string[];
}

/** Relative tolerance for matching a prose number to an allowed value.
 *  The insights.ts usd() helper rounds to 0 decimals, so prose "$12,985" must
 *  match data 12984.78 — ~1% relative covers integer-rounded dollars and percents. */
const REL_TOL = 0.01;

/** Year tokens (4-digit 19xx/20xx) come from dates, not metrics — never fabrication. */
const YEAR_RE = /^(?:19|20)\d{2}$/;

/** Scale multipliers for a trailing k/K/M/B/m/b suffix ("$5M" => 5_000_000). We scale
 *  the mantissa BEFORE matching so a fabricated "$5M" cannot slip through merely because
 *  the bare "5" coincides with a whitelisted aggregate (issue #9). */
const SCALE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/** The whitelist of numbers the LLM may cite. Dashboard-level aggregates ONLY. */
export function allowedNumbers(data: DashboardData): number[] {
  const t = data.totals;
  const out: number[] = [
    t.cost_usd,
    t.cost_by_fidelity.high,
    t.cost_by_fidelity.main_loop,
    t.active_minutes,
    t.active_hours,
    t.idle_minutes,
    t.idle_hours,
    t.sessions,
    t.subagent_dispatches,
    t.cost_per_active_min,
    t.avg_cache_hit_pct,
    t.tokens.input_fresh,
    t.tokens.cache_read,
    t.tokens.output,
    t.time_saved_min,
    t.time_saved_hours,
    data.meta.session_count,
    data.meta.project_count,
  ];
  if (t.floored_usd != null) out.push(t.floored_usd);
  if (t.complete_spend_usd != null) out.push(t.complete_spend_usd);
  for (const p of data.projects) {
    out.push(p.cost_usd, p.sessions, p.active_min, p.cost_per_session, p.cost_share * 100);
  }
  if (data.meta.floor) {
    const f = data.meta.floor;
    out.push(f.discovered, f.kept, f.dropped, f.dropped_with_usage, f.dropped_with_usage_usd);
  }
  for (const v of Object.values(data.distributions.model_mix)) out.push(v);
  return out;
}

/** Does `value` match any allowed number, as exact, integer-rounded, or within REL_TOL? */
function matchesAllowed(value: number, allowed: number[]): boolean {
  for (const a of allowed) {
    if (value === a) return true;
    if (Math.round(value) === Math.round(a)) return true;
    const denom = Math.max(Math.abs(a), 1);
    if (Math.abs(value - a) / denom <= REL_TOL) return true;
  }
  return false;
}

/** Extract every $/%/numeric token from prose and check each against the whitelist.
 *  Tokens are the bare numbers (commas/$/% stripped). Year tokens (date labels) and
 *  small structural integers 0–1 (bullet artifacts like "1 project") still must match
 *  an allowed value — they usually do (sessions/counts) — but are NOT auto-exempted
 *  except for 4-digit years. */
export function validateInsightNumbers(prose: string, data: DashboardData): ValidationResult {
  const allowed = allowedNumbers(data);
  const offending: string[] = [];
  // matches: $1,234.56 | 1,234 | 95.0% | .5% | $5M | 80B — captures the numeric core
  // (with commas/decimals/leading-dot) plus an optional k/K/M/B scale suffix (group 2).
  const tokenRe = /\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)([kKmMbB])?\s?%?/g;
  for (const m of prose.matchAll(tokenRe)) {
    const raw = m[1];
    // A bare 4-digit year (date label) is not a metric claim.
    if (YEAR_RE.test(raw.replace(/[,.].*$/, ""))) continue;
    let value = parseFloat(raw.replace(/,/g, ""));
    if (Number.isNaN(value)) continue;
    // Scale a trailing k/M/B suffix into the value before whitelist-matching, so a
    // fabricated scaled figure can't pass on a coincidental mantissa collision (#9).
    const suffix = m[2];
    if (suffix) value *= SCALE[suffix.toLowerCase()];
    if (!matchesAllowed(value, allowed)) offending.push(m[0].trim());
  }
  return { ok: offending.length === 0, offending };
}
