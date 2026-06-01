/* Ambient cuteness: a twinkling starfield + a full-screen cursor fairy-dust
 * canvas (sparkles on pointer-move, burst on click). Both are disabled under
 * prefers-reduced-motion and fully cleaned up on unmount. */
import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "./helpers";

export function Starfield() {
  const reduced = usePrefersReducedMotion();
  if (reduced) return null;
  const stars = Array.from({ length: 64 }, (_, i) => {
    const c = Math.random() > 0.5 ? "var(--cyan)" : Math.random() > 0.5 ? "var(--lime)" : "var(--magenta)";
    return (
      <i
        key={i}
        style={{
          left: `${Math.random() * 100}%`,
          top: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 3}s`,
          background: c,
        }}
      />
    );
  });
  return (
    <div className="stars" aria-hidden="true">
      {stars}
    </div>
  );
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  grav: number;
  tw: number;
}

export function FairyDust() {
  const reduced = usePrefersReducedMotion();
  const mountedRef = useRef(false);

  useEffect(() => {
    if (reduced || mountedRef.current) return;
    mountedRef.current = true;
    const cv = document.createElement("canvas");
    cv.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999";
    document.body.appendChild(cv);
    const ctx = cv.getContext("2d")!;
    let W = 0;
    let H = 0;
    let DPR = 1;
    const resize = () => {
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
    resize();
    addEventListener("resize", resize);

    const COLORS = ["#2ee6ff", "#b6ff3d", "#ff5ad0", "#ffe14d", "#ffffff"];
    const P: Particle[] = [];
    const MAX = 260;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    function spawn(x: number, y: number, o: Partial<Particle> = {}) {
      if (P.length >= MAX) return;
      P.push({
        x,
        y,
        vx: o.vx !== undefined ? o.vx : rnd(-0.3, 0.3),
        vy: o.vy !== undefined ? o.vy : rnd(-0.2, 0.6),
        life: 0,
        max: o.max || rnd(46, 82),
        size: o.size || ((Math.random() * 2) | 0) + 2,
        color: o.color || COLORS[(Math.random() * COLORS.length) | 0],
        grav: o.grav !== undefined ? o.grav : 0.012,
        tw: rnd(0, 6.28),
      });
    }
    let lx: number | null = null;
    let ly: number | null = null;
    const onMove = (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      if (lx !== null && ly !== null && Math.hypot(x - lx, y - ly) < 6) return;
      lx = x;
      ly = y;
      const n = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) spawn(x + rnd(-3, 3), y + rnd(-3, 3), { vy: rnd(0.05, 0.6), vx: rnd(-0.25, 0.25) });
    };
    const onDown = (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.283 + rnd(-0.2, 0.2);
        const sp = rnd(1.2, 3.4);
        spawn(x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, grav: 0.045, max: rnd(28, 54) });
      }
      for (let i = 0; i < 6; i++) spawn(x + rnd(-6, 6), y + rnd(-6, 6), { vy: rnd(-0.5, 0.1), grav: 0.008, max: rnd(54, 84) });
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
      removeEventListener("resize", resize);
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerdown", onDown);
      cv.remove();
      mountedRef.current = false;
    };
  }, [reduced]);

  return null;
}
