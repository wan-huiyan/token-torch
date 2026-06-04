/* ============================================================================
 * TOKEN TORCH — model→color + effort→(label, sprite-bot) maps (pure, no imports)
 * Lives in src/shared/ so both dashboard + session-detail use ONE stable color
 * per model version (the prototype expects a per-model color; the old app cycled
 * a 4-color palette). Colors are CSS var refs into the Neon Mission Control
 * palette (styles-tokens.css). Effort maps the REAL enum (low/medium/high/xhigh/
 * max/ultracode/unknown) — "ultra-high"/"team" are display/sprite labels, NOT
 * values; the bot kinds are the sprite-engine's mountEffortBot kinds.
 * ========================================================================== */

const PALETTE = ["var(--cyan)", "var(--magenta)", "var(--lime)", "var(--amber)"] as const;

/** Stable color for a raw model version id. Known versions are pinned to the
 *  prototype's choices; anything else hashes deterministically into the palette
 *  (so a never-seen version still gets a consistent, distinct color). */
const KNOWN: Record<string, string> = {
  "claude-opus-4-8": "var(--cyan)",
  "claude-opus-4-7": "var(--magenta)",
  "claude-sonnet-4-6": "var(--lime)",
};
export function modelColor(versionId: string | undefined | null): string {
  if (!versionId) return "var(--ink-dim)";
  const hit = KNOWN[versionId];
  if (hit) return hit;
  let h = 0;
  for (let i = 0; i < versionId.length; i++) h = (h * 31 + versionId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export type EffortBotKind = "low" | "medium" | "high" | "ultra-high" | "max" | "team";
export interface EffortMeta {
  label: string;
  botKind: EffortBotKind;
}
/** Real effort value → display label + sprite-bot kind. `xhigh`→"ultra-high" bot,
 *  `ultracode`→"team" bot (mommy+babies = the fan-out persona). Unknown is neutral. */
export function effortMeta(value: string | undefined | null): EffortMeta {
  switch ((value ?? "").toLowerCase()) {
    case "low": return { label: "Low", botKind: "low" };
    case "medium": return { label: "Medium", botKind: "medium" };
    case "high": return { label: "High", botKind: "high" };
    case "xhigh": return { label: "Ultra-high", botKind: "ultra-high" };
    case "max": return { label: "Max", botKind: "max" };
    case "ultracode": return { label: "Ultracode", botKind: "team" };
    default: return { label: value || "Unknown", botKind: "medium" };
  }
}
