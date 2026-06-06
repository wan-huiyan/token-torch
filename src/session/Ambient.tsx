/* ============================================================================
 * Ambient — page-level neon ambience for the session screen: drifting radial
 * glow + faint grid (the prototype's body::before/::after), twinkling stars, and
 * the cursor fairy-dust canvas (neon pixel sparkles on pointer-move, burst on
 * click). All scoped under .tt-session; honors prefers-reduced-motion (no drift,
 * no fairy-dust). pointer-events:none throughout. Ported from the prototype's
 * decorate() stars + the trailing fairy-dust IIFE.
 * ========================================================================== */
import { useEffect, useMemo, useRef } from "react";
import { usePrefersReducedMotion } from "./helpers";

const STAR_COLORS = ["var(--cyan)", "var(--lime)", "var(--magenta)"];

export function Ambient() {
  const reduced = usePrefersReducedMotion();
  const stars = useMemo(
    () =>
      Array.from({ length: 48 }, () => ({
        left: Math.random() * 100,
        top: Math.random() * 100,
        delay: Math.random() * 3,
        color: STAR_COLORS[(Math.random() * STAR_COLORS.length) | 0],
      })),
    []
  );

  return (
    <>
      <div className="tt-bg-grad" aria-hidden="true" />
      <div className="tt-bg-grid" aria-hidden="true" />
      <div className="tt-stars" aria-hidden="true">
        {stars.map((s, i) => (
          <i
            key={i}
            style={{
              left: `${s.left}%`,
              top: `${s.top}%`,
              animationDelay: `${s.delay}s`,
              background: s.color,
              // #44: use the LONGHAND `animationName` (not the `animation` shorthand) so it
              // doesn't clash with the longhand `animationDelay` above — mixing shorthand +
              // longhand across re-renders made React flood the console on a runtime motion flip.
              ...(reduced ? { animationName: "none", opacity: 0.5 } : {}),
            }}
          />
        ))}
      </div>
      {!reduced && <FairyDust />}
    </>
  );
}

/** Full-screen canvas: neon pixel sparkles on pointer-move, burst on click. */
function FairyDust() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let W = 0;
    let H = 0;
    let DPR = 1;
    const rs = () => {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = innerWidth * DPR;
      cv.height = innerHeight * DPR;
      cv.style.width = innerWidth + "px";
      cv.style.height = innerHeight + "px";
      W = innerWidth;
      H = innerHeight;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.imageSmoothingEnabled = false;
    };
    rs();
    addEventListener("resize", rs);

    const COLORS = ["#2ee6ff", "#b6ff3d", "#ff5ad0", "#ffe14d", "#ffffff"];
    type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; grav: number; tw: number };
    const P: P[] = [];
    const MAX = 240;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const sp = (
      x: number,
      y: number,
      o: Partial<{ vx: number; vy: number; max: number; size: number; color: string; grav: number }> = {}
    ) => {
      if (P.length >= MAX) return;
      P.push({
        x,
        y,
        vx: o.vx ?? rnd(-0.3, 0.3),
        vy: o.vy ?? rnd(-0.2, 0.6),
        life: 0,
        max: o.max || rnd(46, 82),
        size: o.size || ((Math.random() * 2) | 0) + 2,
        color: o.color || COLORS[(Math.random() * COLORS.length) | 0],
        grav: o.grav ?? 0.012,
        tw: rnd(0, 6.28),
      });
    };
    let lx: number | null = null;
    let ly = 0;
    const onMove = (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      if (lx !== null && Math.hypot(x - lx, y - ly) < 6) return;
      lx = x;
      ly = y;
      for (let i = 0, n = 1 + ((Math.random() * 2) | 0); i < n; i++)
        sp(x + rnd(-3, 3), y + rnd(-3, 3), { vy: rnd(0.05, 0.6), vx: rnd(-0.25, 0.25) });
    };
    const onDown = (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * 6.283 + rnd(-0.2, 0.2);
        const s = rnd(1.2, 3.4);
        sp(x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, grav: 0.045, max: rnd(28, 54) });
      }
      for (let i = 0; i < 6; i++) sp(x + rnd(-6, 6), y + rnd(-6, 6), { vy: rnd(-0.5, 0.1), grav: 0.008, max: rnd(54, 84) });
    };
    addEventListener("pointermove", onMove, { passive: true });
    addEventListener("pointerdown", onDown, { passive: true });

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i];
        p.life++;
        p.vy += p.grav;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.99;
        if (p.life >= p.max) {
          P.splice(i, 1);
          continue;
        }
        const t = 1 - p.life / p.max;
        const tw = 0.5 + 0.5 * Math.sin(p.tw + p.life * 0.35);
        ctx.globalAlpha = Math.max(0, t) * tw;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        const s = p.size * (0.6 + t * 0.6);
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", rs);
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerdown", onDown);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999 }}
    />
  );
}
