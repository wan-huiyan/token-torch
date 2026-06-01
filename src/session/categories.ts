/* ============================================================================
 * Money-category palette + labels, ported from the prototype's CATCOL/CATLAB.
 * fresh_input = amber, cache_write = magenta, cache_read = cyan, output = lime.
 * The prototype's stacking order for bars/cards/waterfall is fixed (cache_read,
 * cache_write, output, fresh_input) — exported as CAT_ORDER.
 * ========================================================================== */
import type { CostCategory } from "../types";

export const CATCOL: Record<CostCategory, string> = {
  fresh_input: "#ffb43d",
  cache_write: "#ff5ad0",
  cache_read: "#2ee6ff",
  output: "#b6ff3d",
};
export const CATLAB: Record<CostCategory, string> = {
  fresh_input: "fresh input",
  cache_write: "cache write",
  cache_read: "cache read",
  output: "output",
};
export const CAT_ORDER: CostCategory[] = ["cache_read", "cache_write", "output", "fresh_input"];
