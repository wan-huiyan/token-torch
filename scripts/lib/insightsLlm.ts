/* ============================================================================
 * Generate-time LLM insights via the Claude API. ASYNC. Called only from
 * generate.ts when ANTHROPIC_API_KEY is present.
 *
 * Honesty design:
 *   - Grounded: the prompt's stable context block lists ONLY the whitelist of
 *     dashboard-level numbers (allowedNumbers) and instructs the model to cite
 *     nothing else. Prompt caching (cache_control: ephemeral) sits on that block
 *     so the bounded regen retries reuse it.
 *   - Post-validated: validateInsightNumbers rejects any fabricated number; on
 *     failure we regenerate with a correction (appended AFTER the cached block),
 *     up to MAX_RETRIES; if still failing we return null and the caller uses
 *     the template fallback (logged loudly).
 *   - Respects existing rules: breakdown-not-comparison (L7 — no "4.8 beats 4.7"),
 *     small_n empty-states, costs-are-estimates, no superlative/causal claims.
 *   - Model: claude-opus-4-8 (latest); adaptive thinking; never blends in numbers.
 * ========================================================================== */

import Anthropic from "@anthropic-ai/sdk";
import type { DashboardData } from "../../src/types";
import { allowedNumbers, validateInsightNumbers } from "./insightsValidate";

const MODEL = "claude-opus-4-8";
const MAX_RETRIES = 2;

/** The stable, cacheable context block: the grounding facts + the rules. Built
 *  once per call; byte-identical across the regen retries so the cache holds. */
function buildContextBlock(data: DashboardData): string {
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
    "You are writing a short, honest weekly insights note over a developer's Claude Code usage data.",
    "",
    "GROUND TRUTH (cite ONLY these numbers — never invent or extrapolate any other figure):",
    `- Displayed cost: $${t.cost_usd}; complete spend (incl. floored short sessions): $${t.complete_spend_usd ?? t.cost_usd}`,
    `- Sessions: ${t.sessions}; subagent dispatches: ${t.subagent_dispatches}; avg cache hit: ${t.avg_cache_hit_pct}%`,
    `- Active: ${t.active_hours}h; idle: ${t.idle_hours}h; time saved (parallel subagents, a floor): ${t.time_saved_hours}h`,
    `- Projects (top 5 by cost):`,
    projectLines,
    `- Model mix (% of assistant messages): ${Object.entries(data.distributions.model_mix).map(([m, p]) => `${m} ${p}%`).join(", ")}`,
    `- Full set of citable numbers: ${allowed}`,
    "",
    "HARD RULES:",
    "1. Every number you write MUST be one of the citable numbers above. Do not compute new ratios, sums, or trends the data doesn't already contain.",
    "2. The model versions above are time-disjoint — describe the model BREAKDOWN, never a performance COMPARISON (do NOT say one model is better/faster/cheaper than another).",
    data.meta.small_n
      ? "3. small_n is TRUE: there are too few sessions for trend claims. Write an empty-state note only — no week-over-week or trend language."
      : "3. You may describe the current window, but make no causal claims the data can't support.",
    "4. Costs are ESTIMATES from per-model list rates (the billing dashboard is authoritative). Say 'estimated' where natural.",
    "5. No superlatives or causal language ('because', 'caused', 'best') beyond what the numbers plainly show.",
    "6. Do NOT write any date, or any number (including incidental counts like 'top 3 projects') that is not in the citable list above — the validator rejects unlisted numbers and the UI already supplies the date. Spell out small structural counts as words if needed.",
    "",
    "FORMAT: markdown, starting with a bold header line, then 2–4 '- ' bullets. Keep it under 90 words.",
  ].join("\n");
}

/** One API call. Returns the first text block's markdown (or "" if none). */
async function callClaude(
  client: Anthropic,
  contextBlock: string,
  correction: string | null,
): Promise<string> {
  const userContent: Anthropic.TextBlockParam[] = [
    { type: "text", text: contextBlock, cache_control: { type: "ephemeral" } },
  ];
  if (correction) {
    // Volatile correction goes AFTER the cached block so retries reuse the cache.
    userContent.push({ type: "text", text: correction });
  } else {
    userContent.push({ type: "text", text: "Write the insights note now." });
  }
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: userContent }],
  });
  const textBlock = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return textBlock?.text ?? "";
}

/** Produce validated LLM insights markdown, or null if validation can't be satisfied
 *  within MAX_RETRIES (caller falls back to templates). Requires ANTHROPIC_API_KEY in env. */
export async function buildInsightsLLM(data: DashboardData): Promise<string | null> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const contextBlock = buildContextBlock(data);
  let correction: string | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const prose = await callClaude(client, contextBlock, correction);
    if (!prose.trim()) {
      correction = "Your previous response was empty. Write the insights note now, following all rules.";
      continue;
    }
    const { ok, offending } = validateInsightNumbers(prose, data);
    if (ok) return prose.trim();
    correction =
      `Your previous note contained number(s) not present in the ground-truth data: ${offending.join(", ")}. ` +
      `Rewrite the note using ONLY the citable numbers listed above. Do not invent or recompute any figure.`;
  }

  console.warn(
    "⚠ LLM insights failed the no-fabrication check after retries — falling back to template insights.",
  );
  return null;
}
