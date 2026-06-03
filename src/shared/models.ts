/* ============================================================================
 * Pure, React-free model-id helpers shared by the generator (scripts/lib/) and
 * the dashboard (src/dashboard/). Lives in src/shared/ so neither side imports
 * across the scripts↔dashboard boundary (mirrors burnTier/mins). No imports.
 * ========================================================================== */

/** Model ids that are NOT real Claude models — placeholders Claude Code emits for
 *  internal/synthetic messages. Filtered from the model-mix legend AND every
 *  breakdown bucket so a non-real id is never shown to the user as usage. */
export const SYNTHETIC_MODEL_IDS = new Set(["<synthetic>", "<unknown>", "unknown", "synthetic"]);

/** True when `id` is a real, displayable Claude model id (not a synthetic placeholder). */
export const isRealModelId = (id: string): boolean =>
  !!id && !SYNTHETIC_MODEL_IDS.has(id.toLowerCase());

/** "claude-opus-4-8" → "Opus 4.8" — a readable, version-distinct label. Unknown
 *  shapes pass through unchanged. SHARED so the LLM prompt (insightsLlm) and the
 *  no-fab validator (insightsValidate) agree on the exact label string — the binding
 *  check (#24) keys a prose "Opus 4.7" back to its model_mix entry through this. */
export function prettyModelId(id: string): string {
  const m = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)$/i.exec(id);
  if (!m) return id;
  const family = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return `${family} ${m[2]}.${m[3]}`;
}
