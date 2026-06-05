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

  function finish() {
    markTourSeen();
    setDone(true);
  }

  // Resolve the next PRESENT anchor at/after index `i`; position the popover near it.
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
    el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setRect(el.getBoundingClientRect());
    popRef.current?.focus();
  }, [i, done]);

  if (done || !rect) return null;
  const step = TOUR_STEPS[i];
  const top = Math.min(rect.bottom + 10, window.innerHeight - 200);
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
