/* Opt-in "reduce animations" toggle (#56). Default = animated ("maximum fun").
 * Reads the live preference via the shared store hook (so the label tracks the
 * state) and flips it via setReduceMotion, which drives the canvas registry, the
 * React decorations, and the `.tt-reduced` body class in lockstep. Persisted to
 * localStorage; survives reload. */
import { usePrefersReducedMotion } from "../helpers";
import { setReduceMotion } from "../reduceMotion";

export function ReduceMotionToggle() {
  const reduced = usePrefersReducedMotion();
  return (
    <button
      type="button"
      className="rm-toggle"
      aria-pressed={reduced}
      title={
        reduced
          ? "Animations are reduced — click to turn the arcade motion back on"
          : "Reduce animations — turn off the arcade motion (saved on this device)"
      }
      onClick={() => setReduceMotion(!reduced)}
    >
      {reduced ? "▷ motion off" : "✨ motion on"}
    </button>
  );
}
