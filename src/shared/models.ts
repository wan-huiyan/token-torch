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
