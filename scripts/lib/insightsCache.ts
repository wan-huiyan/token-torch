/* ============================================================================
 * Input-hash cache for LLM insights, stored in the gitignored .cache/ dir.
 * Keyed on a SHA-256 of the dashboard-level aggregates the LLM was grounded on —
 * so re-`generate` with unchanged aggregates returns the cached prose (no API
 * call), keeping generate deterministic and cheap. No SDK import here.
 * ========================================================================== */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DashboardData } from "../../src/types";
import { allowedNumbers } from "./insightsValidate";

interface CacheFile {
  hash: string;
  insights_md: string;
}

/** Stable hash of the inputs the prose depends on: the whitelist of aggregate
 *  numbers (sorted) + the model id. Sessions[] is intentionally excluded — it
 *  is not part of the grounding, so it must not bust the cache. */
export function insightsHash(data: DashboardData, model: string): string {
  const nums = allowedNumbers(data)
    .map((n) => n.toFixed(4))
    .sort();
  return createHash("sha256").update(model + "\n" + nums.join("\n")).digest("hex");
}

/** Return cached prose iff the file exists and its hash matches; else null. */
export function readInsightsCache(cachePath: string, hash: string): string | null {
  if (!existsSync(cachePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as CacheFile;
    return parsed.hash === hash ? parsed.insights_md : null;
  } catch {
    return null;
  }
}

/** Persist prose under its input hash. */
export function writeInsightsCache(cachePath: string, hash: string, insightsMd: string): void {
  mkdirSync(dirname(cachePath), { recursive: true });
  const payload: CacheFile = { hash, insights_md: insightsMd };
  writeFileSync(cachePath, JSON.stringify(payload, null, 2) + "\n");
}
