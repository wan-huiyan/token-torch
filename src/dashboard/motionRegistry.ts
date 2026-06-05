/* ============================================================================
 * TOKEN TORCH — reduced-motion runtime registry (issue #38).
 *
 * The canvas sprite engine (spriteEngine.ts) reads prefers-reduced-motion ONCE
 * at import, so a preference flipped AFTER load never reaches the running rAF /
 * setInterval / setTimeout loops. This registry fixes that: every running loop
 * registers a `stop` fn here, spriteEngine wires a single matchMedia "change"
 * listener, and on a flip TO reduce we drain + stop every registered loop and
 * suppress new ones (mounts gate on `isReduced()`).
 *
 * Teardown-on-reduce only — a flip BACK to motion does NOT auto-restart already-
 * mounted loops (that needs a restartable mount across 9 sprites; it's a rare edge
 * of an already-rare runtime toggle, out of scope for #38). On flip-back the sprites
 * stay consistently frozen until a re-mount (React) or reload — NOT a half-broken
 * state. (Newly-mounted sprites after a motion-restore DO animate, since each mount
 * re-checks isReduced(); the shared flame ticker matches this via lazy restart in
 * spriteEngine._regFlame.) Scope note: the WAAPI confetti/coin/ember SPAWNERS stop
 * immediately on reduce (no new sprites), but a handful of already-airborne sprites
 * finish their short (≤~2s) fade-out — gentler than freezing them mid-air. Pure +
 * DOM-free so it unit-tests with no real matchMedia.
 * ========================================================================== */

/** Live preference. Seeded by spriteEngine at import; flipped by the listener. */
let _reduced = false;

/** Stop fns for the currently-running animation loops. A stop halts ONE loop's
 *  timer/rAF (it does NOT remove the loop's DOM node — the sprite freezes on its
 *  current frame, like the CSS `animation:none` path). */
const _active = new Set<() => void>();

/** Seed the initial preference (spriteEngine calls this once with the
 *  import-time matchMedia value, before the flame ticker starts). */
export function initReduced(value: boolean): void {
  _reduced = value;
}

/** Live preference — true when motion is currently suppressed (NOT the
 *  import-time snapshot). Mounts gate new loops on `!isReduced()`. */
export function isReduced(): boolean {
  return _reduced;
}

/** Register a running loop's stop fn. Returns an unregister handle the caller
 *  MUST invoke from its own unmount cleanup, so a disposed loop's stop is not
 *  held (and never fired) by a later toggle. */
export function trackAnimation(stop: () => void): () => void {
  _active.add(stop);
  return () => {
    _active.delete(stop);
  };
}

/** Apply a runtime preference flip. On flip TO reduce: drain + stop every
 *  registered loop. Draining first makes a stop fire at most once; a throwing
 *  stop never blocks the rest. Flip to motion only updates the live flag
 *  (teardown-only — no auto-restart). */
export function applyReducedMotion(next: boolean): void {
  _reduced = next;
  if (!next) return;
  const stops = [..._active];
  _active.clear();
  for (const stop of stops) {
    try {
      stop();
    } catch {
      /* a misbehaving stop fn must not abort the teardown of the others */
    }
  }
}

/** Test-only: number of currently-tracked loops. */
export function _activeCount(): number {
  return _active.size;
}

/** Test-only: reset module state between checks. */
export function _resetForTest(): void {
  _reduced = false;
  _active.clear();
}
