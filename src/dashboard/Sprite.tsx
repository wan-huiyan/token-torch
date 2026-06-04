/* ============================================================================
 * TOKEN TORCH — tiny React host for the spriteEngine mount functions.
 * Renders a <span> and, after mount, calls `mount(host)` once. If the mount
 * returns a cleanup function it is invoked on unmount (or before a re-run);
 * if it returns a canvas (static sprite) there is nothing to dispose. The host
 * is cleared at the top of each effect run so StrictMode double-invocation /
 * re-runs never leave a doubled canvas. No React state churn.
 * ========================================================================== */
import { useEffect, useRef } from "react";

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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.textContent = "";
    const r = mount(host);
    return () => {
      if (typeof r === "function") r();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <span ref={hostRef} className={className} title={title} aria-label={ariaLabel} aria-hidden="true" style={{ display: "inline-flex" }} />;
}
