/* ============================================================================
 * TOKEN TORCH — in-app "reduce animations" toggle (#56).
 *
 * The single source of truth for the OPT-IN reduced-motion preference. "Maximum
 * fun" (PR #55) made the dashboard ignore the OS `prefers-reduced-motion` for
 * decoration (owner call); this gives motion-sensitive users an explicit choice,
 * decoupled from the OS. Default = ANIMATED (off); persisted to localStorage.
 *
 * Setting it drives ALL THREE animation mechanisms in lockstep:
 *   1. the canvas sprite engine — via motionRegistry.applyReducedMotion() (stops
 *      every running rAF/interval loop; mounts gate on isReduced()).
 *   2. the React hooks — usePrefersReducedMotion() subscribes here, so
 *      FairyDust / starfield / count-up / awards re-render off.
 *   3. CSS decorations — the `.tt-reduced` body class (see redesign.css).
 *
 * Pure module state + a tiny listener set so React's useSyncExternalStore can
 * subscribe. localStorage/document access is guarded so it no-ops under tests/SSR.
 * ========================================================================== */
import { applyReducedMotion } from "./motionRegistry";

const KEY = "tt-reduce-motion";

function read(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
  } catch {
    return false; // private mode / blocked storage → animated default
  }
}

let _on = read();
const listeners = new Set<() => void>();

/** Push the current value into the canvas registry + the body class. Idempotent. */
function apply(on: boolean): void {
  applyReducedMotion(on); // sets the registry flag; on reduce, tears down running loops
  if (typeof document !== "undefined") {
    document.body.classList.toggle("tt-reduced", on);
  }
}

/** Boot hook — call once as early as possible (before sprites mount) so a
 *  reload with the preference saved starts fully static, no flash-then-stop. */
export function initReduceMotion(): void {
  apply(_on);
}

/** Live preference (snapshot for useSyncExternalStore). */
export function getReduceMotion(): boolean {
  return _on;
}

/** Flip the preference: persist, drive all three mechanisms, notify React. */
export function setReduceMotion(on: boolean): void {
  if (on === _on) return;
  _on = on;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage blocked — preference stays in-memory for this session */
  }
  apply(on);
  for (const l of listeners) l();
}

/** Subscribe to preference changes (for useSyncExternalStore). */
export function subscribeReduceMotion(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Test-only: reset module + registry state between checks. */
export function _resetForTest(): void {
  _on = false;
  listeners.clear();
  applyReducedMotion(false);
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
