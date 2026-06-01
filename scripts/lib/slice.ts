/* ============================================================================
 * Model-version slice derivation (spec §4). The dominant raw model id (most
 * assistant messages) becomes model_version; the full per-version message-share
 * map becomes model_versions (mixed-version sessions keep both). Raw ids only —
 * no fabricated labels (a family/label mapping is a downstream display concern).
 * ========================================================================== */

export interface ModelVersionSlice {
  model_version?: string; // dominant raw id, or undefined when there are no messages
  model_versions: Record<string, number>; // per-version assistant-message counts (the map itself)
}

/** Derive the dominant model id + the per-version share from a record's modelMsgCounts. */
export function deriveModelVersion(modelMsgCounts: Record<string, number>): ModelVersionSlice {
  let best: string | undefined;
  let bestN = -1;
  for (const [id, n] of Object.entries(modelMsgCounts)) {
    if (n > bestN) { bestN = n; best = id; }
  }
  return { model_version: best, model_versions: { ...modelMsgCounts } };
}
