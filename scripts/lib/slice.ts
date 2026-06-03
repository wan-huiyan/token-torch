/* ============================================================================
 * Model-version slice derivation (spec §4). The dominant raw model id (most
 * assistant messages) becomes model_version; the full per-version message-share
 * map becomes model_versions (mixed-version sessions keep both). Raw ids only —
 * no fabricated labels (a family/label mapping is a downstream display concern).
 * ========================================================================== */

import { isRealModelId } from "../../src/shared/models";

export interface ModelVersionSlice {
  model_version?: string; // dominant raw id, or undefined when there are no messages
  model_versions: Record<string, number>; // per-version assistant-message counts (the map itself)
}

/** Derive the dominant REAL model id + the per-version share from a record's
 *  modelMsgCounts. Synthetic/placeholder ids (`<synthetic>`, `<unknown>`, …) are
 *  filtered here at the source so they can never surface as a model_version in
 *  any downstream breakdown card, session row, or detail (issue #14). An
 *  all-synthetic session yields `model_version: undefined` + an empty map — a
 *  rare, honest "no identifiable model" condition the consumers already tolerate
 *  (bucketOf → unknown bucket; SessionTable → model fallback; CostHeatmap filters). */
export function deriveModelVersion(modelMsgCounts: Record<string, number>): ModelVersionSlice {
  let best: string | undefined;
  let bestN = -1;
  const real: Record<string, number> = {};
  for (const [id, n] of Object.entries(modelMsgCounts)) {
    if (!isRealModelId(id)) continue;
    real[id] = n;
    if (n > bestN) { bestN = n; best = id; }
  }
  return { model_version: best, model_versions: real };
}
