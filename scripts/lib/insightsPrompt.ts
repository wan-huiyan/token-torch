/* ============================================================================
 * KEY-FREE insights prompt module. NO @anthropic-ai/sdk import — this is what lets
 * `generate` emit the paste-ready agent prompt (insights-request.md) and let the
 * agent-session path run with no API key.
 *
 *   buildContextBlock(data)   -> the stable, cacheable grounding facts + HARD RULES
 *                                (shared by the API path and the agent prompt).
 *   buildInsightsRequest(data)-> the full paste-ready prompt an agent reads to write
 *                                insights.local.md (context block + output instruction).
 *   INSIGHTS_PROMPT_VERSION   -> bump on any prompt/rule/model-mix-format change (gates
 *                                the LLM insights cache key in generate.ts).
 * ========================================================================== */

import type { DashboardData } from "../../src/types";
import { allowedNumbers } from "./insightsValidate";
import { prettyModelId } from "../../src/shared/models";

/** BUMP on any prompt / rule / model-mix-format change. The insights cache key
 *  (insightsHash) is otherwise keyed only on the data numbers + model, so without
 *  this a prompt edit would serve STALE cached insights until the aggregates change. */
export const INSIGHTS_PROMPT_VERSION = "2026-06-05-vacuity-claims-unit-aware";

/** The stable, cacheable context block: the grounding facts + the rules. Built
 *  once per call; byte-identical across the regen retries so the cache holds. */
export function buildContextBlock(data: DashboardData): string {
  const t = data.totals;
  const allowed = allowedNumbers(data)
    .map((n) => (Number.isInteger(n) ? String(n) : n.toFixed(2)))
    .join(", ");
  const projectLines = data.projects
    .slice(0, 5)
    .map(
      (p) =>
        `  - ${p.name}: $${p.cost_usd} (${Math.round(p.cost_share * 100)}% of total), ${p.sessions} sessions, $${p.cost_per_session}/session`,
    )
    .join("\n");
  return [
    "You are writing a short, PLAYFUL weekly insights note over a developer's Claude Code usage data — in the voice of its retro ARCADE dashboard (the UI has pixel flames for burned spend, rising coins, a sleepy moon for idle time, a ⚡ bolt for time saved).",
    "VOICE: arcade / retro-game energy — a tasteful emoji accent or two (🔥 🪙 🌙 🎮 ⚡), light wordplay ('burned' for spend, 'sidekicks' for subagents, 'soaked up' / 'snoozing'), upbeat but never cutesy or hypey. This voice NEVER overrides the HARD RULES below: stay honest — cite only the listed numbers, describe SHARES not winners, and no superlatives. The wordplay is LEXICAL, not numeric: invent NO figures — no game 'scores', 'levels', '1-ups', or counts that aren't in the citable list. Playful framing, real figures only.",
    "",
    "GROUND TRUTH (cite ONLY these numbers — never invent or extrapolate any other figure):",
    `- Displayed cost: $${t.cost_usd}; complete spend (incl. floored short sessions): $${t.complete_spend_usd ?? t.cost_usd}`,
    `- Sessions: ${t.sessions}; subagent dispatches: ${t.subagent_dispatches}; avg cache hit: ${t.avg_cache_hit_pct}%`,
    `- Active: ${t.active_hours}h; idle: ${t.idle_hours}h; time saved (parallel subagents, a floor): ${t.time_saved_hours}h`,
    `- Projects (top 5 by cost):`,
    projectLines,
    `- Model mix (% of assistant messages): ${Object.entries(data.distributions.model_mix).map(([m, p]) => `${prettyModelId(m)} ${p}%`).join(", ")}`,
    `- Full set of citable numbers: ${allowed}`,
    "",
    "HARD RULES:",
    "1. Every number you write MUST be one of the citable numbers above. Do not compute new ratios, sums, or trends the data doesn't already contain.",
    "2. The model versions above are time-disjoint — describe the model BREAKDOWN, never a performance COMPARISON (do NOT say one model is better/faster/cheaper than another).",
    data.meta.small_n
      ? "3. small_n is TRUE: there are too few sessions for trend claims. Write an empty-state note only — no week-over-week or trend language."
      : "3. You may describe the current window, but make no causal claims the data can't support.",
    "4. Costs are ESTIMATES from per-model list rates (the billing dashboard is authoritative). Say 'estimated' where natural.",
    "5. No performance superlatives, model comparisons, or causal language — the validator now REJECTS words like 'best / worst / better / worse / faster / slower / superior / outperforms / record-breaking / blowout' and 'because / caused / due to / thanks to'. Factual cost/size rankings ('priciest', 'biggest', 'most', 'top', 'led the mix') ARE fine — they describe the data. Describe shares and rankings, never value judgments or causes.",
    "6. Do NOT write any date, or any number (including incidental counts like 'top 3 projects') that is not in the citable list above — the validator rejects unlisted numbers and the UI already supplies the date. Spell out small structural counts as words if needed.",
    "7. When citing the model mix, name each model VERSION explicitly as given (e.g. 'Opus 4.7', 'Opus 4.8', 'Sonnet 4.6'). NEVER merge two versions into one ambiguous phrase like 'Opus X% and Y%' — keep each version's share attached to its version label.",
    "",
    "FORMAT: markdown — a bold header line (a fun arcade-y title is welcome), then 2–4 '- ' bullets, each of which MAY open with a single emoji accent. Keep it under 90 words. Numbers and model-version labels stay exact.",
  ].join("\n");
}

/** The full paste-ready prompt an agent (Claude Code / Codex / Cursor / …) reads to
 *  write insights.local.md. = a short instruction + buildContextBlock + the output rule. */
export function buildInsightsRequest(data: DashboardData): string {
  return [
    "# Token Torch — generate my insights (paste this whole file to your coding agent)",
    "",
    "You are my coding agent (Claude Code / Codex / Cursor / …). Read the GROUND TRUTH and",
    "HARD RULES below and write a short insights note, then SAVE it as Markdown to a file",
    "named `insights.local.md` in this same directory. After you save it, tell me to run",
    "`pnpm generate` again — the generator re-validates every number and bakes your note in.",
    "",
    "----------------------------------------------------------------------",
    "",
    buildContextBlock(data),
    "",
    "----------------------------------------------------------------------",
    "",
    "OUTPUT INSTRUCTIONS:",
    "- Write ONLY the insights note (one bold header line, then 2–4 '- ' bullets, under 90 words).",
    "- Save it to `insights.local.md` in this directory. Do not print anything else.",
    "- Every number MUST come from the citable list above. The generator's no-fabrication gate",
    "  re-checks each number and will DISCARD the file (falling back to template insights) if it",
    "  finds any figure that isn't in the data. Playful framing is welcome; invented figures are not.",
  ].join("\n");
}
