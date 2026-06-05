/* Non-blocking first-visit tour popover (Plan 7 / #16). Renders nothing once seen.
 * Anchors to live `data-tour` elements; SKIPS any step whose anchor is absent (so a
 * deep-link where the sessions tab isn't mounted just drops that step). The scrim is
 * pointer-events:none — the page scrolls/clicks freely behind it (NOT a modal).
 * Keyboard: Esc = skip, →/Enter = next, ← = back. Honors prefers-reduced-motion. */
import { useEffect, useRef, useState } from "react";
import { TOUR_STEPS, isTourSeen, markTourSeen, prefersReducedMotion } from "./tour";

export function TourOverlay() {
  const [i, setI] = useState(0);
  const [done, setDone] = useState(() => isTourSeen());
  const [rect, setRect] = useState<DOMRect | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  function finish() {
    markTourSeen();
    setDone(true);
    // restore focus to whatever the user had before the tour grabbed it (a11y).
    const o = openerRef.current as HTMLElement | null;
    if (o && document.contains(o)) o.focus?.();
  }

  // Resolve the next PRESENT anchor at/after index `i`; position the popover near it,
  // and KEEP it aligned as a smooth scroll settles / the window resizes (position:fixed
  // popover + async scrollIntoView would otherwise leave it stranded off below-fold anchors).
  useEffect(() => {
    if (done) return;
    let idx = i;
    while (idx < TOUR_STEPS.length && !document.querySelector(TOUR_STEPS[idx].selector)) idx++;
    if (idx >= TOUR_STEPS.length) {
      finish();
      return;
    }
    if (idx !== i) {
      setI(idx);
      return;
    }
    const el = document.querySelector(TOUR_STEPS[idx].selector);
    if (!el) return;
    const reposition = () => setRect(el.getBoundingClientRect());
    // Always "auto" (synchronous): a programmatic SMOOTH scrollIntoView is unreliable (it
    // no-ops in automated/headless contexts, leaving a position:fixed popover stranded off
    // a below-fold anchor). Instant scroll is motion-free + reliable for a utility tour.
    el.scrollIntoView({ block: "start", behavior: "auto" });
    reposition(); // synchronous scroll done → this rect is final
    // belt-and-suspenders: re-align after any late layout shift (sprites/count-ups settling).
    const t1 = window.setTimeout(reposition, 250);
    const t2 = window.setTimeout(reposition, 600);
    window.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reposition);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("scroll", reposition);
      window.removeEventListener("resize", reposition);
    };
  }, [i, done]);

  // Focus the popover ONCE per step, after it has actually mounted (rect drives mount, so
  // a step-0 fresh visit — where the first render returns null — still gets focus). Keyed on
  // [i, done] (NOT rect) so a scroll-driven reposition doesn't yank focus back from a button.
  useEffect(() => {
    if (done) return;
    const raf = requestAnimationFrame(() => {
      if (!openerRef.current) openerRef.current = document.activeElement;
      popRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [i, done]);

  if (done || !rect) return null;
  const step = TOUR_STEPS[i];
  // Position just below the anchor's TOP region (cap the reference at 64px tall) so a TALL
  // anchor like the sessions list doesn't push the popover to its far-off bottom edge.
  const refY = rect.top + Math.min(rect.height, 64);
  const top = Math.max(12, Math.min(refY + 10, window.innerHeight - 200));
  const left = Math.min(Math.max(rect.left, 12), window.innerWidth - 332);
  const next = () => (i + 1 >= TOUR_STEPS.length ? finish() : setI(i + 1));
  const back = () => i > 0 && setI(i - 1);

  return (
    <div className="tour-scrim" style={{ pointerEvents: "none" }}>
      <div
        ref={popRef}
        tabIndex={-1}
        role="dialog"
        aria-live="polite"
        aria-label={step.title}
        className={prefersReducedMotion() ? "tour-pop noanim" : "tour-pop"}
        style={{ position: "fixed", top, left, width: 320, pointerEvents: "auto" }}
        onKeyDown={(e) => {
          if (e.key === "Escape") finish();
          else if (e.key === "ArrowRight" || e.key === "Enter") next();
          else if (e.key === "ArrowLeft") back();
        }}
      >
        <div className="tour-title">{step.title}</div>
        <div className="tour-body">{step.body}</div>
        <div className="tour-ctl">
          <button className="tour-skip" onClick={finish}>
            Skip
          </button>
          <span className="tour-dots">
            {i + 1}/{TOUR_STEPS.length}
          </span>
          {i > 0 ? <button onClick={back}>Back</button> : null}
          <button className="tour-next" onClick={next}>
            {i + 1 >= TOUR_STEPS.length ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
