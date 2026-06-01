/* ============================================================================
 * Effort attribution (spec §7) — the honest heuristic, with provenance.
 *
 *  observed         : transcript carried a "/effort" stdout marker → high confidence.
 *  inferred_default : no marker → the config default (current settings.json effortLevel).
 *                     confidence high  if the session STARTED on/after settings.json mtime;
 *                     confidence low   if it started before (the default may have differed; no history).
 *  unknown          : settings.json unreadable/absent → honest sentinel, never fabricate a value.
 *
 *  This module is FILESYSTEM-FREE: settings facts are injected, so it is fully
 *  unit-testable. generate.ts reads settings.json once and passes the facts down.
 * ========================================================================== */
import type { EffortTag } from "../../src/types";

/** Minimal per-session input deriveEffort needs (a SessionRecord satisfies this). */
export interface EffortInput {
  observedEffort?: string; // parsed marker value, if any
  startedAtMs?: number; // session's first event ms (for the confidence cutoff)
}

/** Settings.json facts, read once by the generator and injected here. */
export interface SettingsFacts {
  settingsEffort: string | null; // effortLevel value, or null if unreadable
  settingsMtimeMs: number | null; // settings.json mtime ms, or null if unreadable
}

/** Parse the leading effort value token out of a "Set effort level to <X> ..." string.
 *  Returns null when the text is not a genuine marker. Only the value token is taken;
 *  "(this session only)" and any trailing ": detail" are intentionally ignored, and
 *  modifiers are left unset (the corpus has no fast/1m markers — do not fabricate). */
export function parseEffortMarker(text: string): string | null {
  const m = /^Set effort level to ([A-Za-z][A-Za-z0-9-]*)/.exec(text.trim());
  return m ? m[1].toLowerCase() : null;
}

/** Derive an honest EffortTag from a session's marker (if any) + injected settings facts. */
export function deriveEffort(input: EffortInput, settings: SettingsFacts): EffortTag {
  if (input.observedEffort) {
    return { value: input.observedEffort, source: "observed", confidence: "high" };
  }
  if (settings.settingsEffort == null || settings.settingsMtimeMs == null) {
    return { value: "unknown", source: "unknown", confidence: "low" };
  }
  const confidence: "high" | "low" =
    input.startedAtMs != null && input.startedAtMs >= settings.settingsMtimeMs ? "high" : "low";
  return { value: settings.settingsEffort, source: "inferred_default", confidence };
}
