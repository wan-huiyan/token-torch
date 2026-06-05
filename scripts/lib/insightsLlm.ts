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
import { validateInsightNumbers, validateTaggedInsights } from "./insightsValidate";
import { buildContextBlock } from "./insightsPrompt";

// buildContextBlock + INSIGHTS_PROMPT_VERSION moved to the KEY-FREE ./insightsPrompt module
// (so prompt-emission for the agent path doesn't pull in @anthropic-ai/sdk); generate.ts
// imports INSIGHTS_PROMPT_VERSION from there directly.

const MODEL = "claude-opus-4-8";
const MAX_RETRIES = 2;

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
    max_tokens: 2048, // headroom so adaptive thinking can't truncate the (short) note
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: userContent }],
  });
  const textBlock = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return textBlock?.text ?? "";
}

/** Produce validated LLM insights markdown, or null if validation can't be satisfied
 *  within MAX_RETRIES (caller falls back to templates). Requires ANTHROPIC_API_KEY in env. */
export async function buildInsightsLLM(data: DashboardData): Promise<string | null> {
  let client: Anthropic;
  try {
    client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  } catch (err) {
    console.warn(`⚠ Anthropic client init failed (${(err as Error).message}) — using template insights.`);
    return null;
  }
  const contextBlock = buildContextBlock(data);
  let correction: string | null = null;

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const prose = await callClaude(client, contextBlock, correction);
      if (!prose.trim()) {
        correction = "Your previous response was empty. Write the insights note now, following all rules.";
        continue;
      }
      // #27 — fail-CLOSED PCN tag check FIRST, on the TAGGED prose; strip tags before the rest.
      // A misattributed tag is a BINDING error (the number IS present, just bound to the wrong
      // model) — a kind-specific correction so the retry actually self-corrects (it previously
      // got the wrong "number not present" message and just fell back to templates).
      const tag = validateTaggedInsights(prose, data);
      if (!tag.ok) {
        correction =
          `Your previous note had misattributed model_mix tag(s): ${tag.taggedOffending.join("; ")}. ` +
          `Each [[mm:<model-id>=<value>]] tag's value MUST equal that model's actual share from the data ` +
          `above (or drop the tag). Rewrite the note.`;
        continue;
      }
      // fail-OPEN number/claim check on the STRIPPED text — what ships + what --verify re-checks.
      const { ok, offending, claims } = validateInsightNumbers(tag.stripped, data);
      if (ok) return tag.stripped.trim();
      const parts = [
        offending.length
          ? `number(s) not present in the ground-truth data: ${offending.join(", ")} — use ONLY the citable numbers above, do not invent or recompute any figure`
          : "",
        claims.length
          ? `forbidden superlative/comparison/causal phrase(s): ${claims.join(", ")} — drop them; describe shares and factual rankings, never value judgments, model comparisons, or causes (HARD RULES 2 & 5)`
          : "",
      ].filter(Boolean);
      correction = `Your previous note contained ${parts.join("; and ")}. Rewrite the note accordingly.`;
    }
  } catch (err) {
    // Invalid key (401), network, rate-limit, etc. — never crash generate; fall back to template.
    console.warn(`⚠ LLM insights API call failed (${(err as Error).message}) — using template insights.`);
    return null;
  }

  // Validation never satisfied within MAX_RETRIES (NOT an API error) — template fallback.
  console.warn(
    "⚠ LLM insights failed the no-fabrication check after retries — falling back to template insights.",
  );
  return null;
}
