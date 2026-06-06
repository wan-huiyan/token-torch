/* ============================================================================
 * TOKEN TORCH — tiny React host for the spriteEngine mount functions.
 * Renders a <span> and, after mount, calls `mount(host)` once. If the mount
 * returns a cleanup function it is invoked on unmount (or before a re-run);
 * if it returns a canvas (static sprite) there is nothing to dispose. The host
 * is cleared at the top of each effect run so StrictMode double-invocation /
 * re-runs never leave a doubled canvas. No React state churn.
 *
 * The mount effect re-runs when the reduced-motion preference flips (#56): the
 * imperative sprite engine reads isReduced() only at mount, so without this a
 * flip BACK to animated would leave already-mounted sprites frozen (the registry
 * is teardown-only). Re-mounting on the flag makes every sprite re-check and
 * restart/stop in lockstep with the toggle — no page remount, no lost state.
 * ========================================================================== */
import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "./helpers";

type MountResult = (() => void) | HTMLElement | null | void;

export function Sprite({
  mount,
  className,
  title,
  "aria-label": ariaLabel,
}: {
  mount: (host: HTMLElement) => MountResult;
  className?: string;
  title?: string;
  "aria-label"?: string;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.textContent = "";
    const r = mount(host);
    return () => {
      if (typeof r === "function") r();
    };
    // re-run on `reduced` so a motion-restore re-mounts the sprite (mount reads
    // isReduced() once). `mount` is intentionally excluded — it's a fresh closure
    // each render and would re-run every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return <span ref={hostRef} className={className} title={title} aria-label={ariaLabel} aria-hidden="true" style={{ display: "inline-flex" }} />;
}
