/* ============================================================================
 * TOKEN TORCH — session-detail formatting + animation helpers.
 * Ported from the canonical prototype "sessions/67948bdb.html" inline helpers
 * (usd, num, pct, abbr, fmtDate, mins) plus React-friendly motion hooks that
 * always write the FINAL value first (reduced-motion / background-tab safe).
 * Self-contained in src/session/ (must not import from ../dashboard/).
 * ========================================================================== */
import { useEffect, useRef, useState, type CSSProperties } from "react";

export const usd = (v: number, c = true): string =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: c ? 2 : 0, maximumFractionDigits: c ? 2 : 0 });
export const num = (v: number, d = 0): string =>
  v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (v: number, d = 1): string => num(v, d) + "%";

/** Token abbreviation — matches prototype abbr(): B/M/k. */
export function abbr(n: number): string {
  return n >= 1e9
    ? num(n / 1e9, 2) + "B"
    : n >= 1e6
      ? num(n / 1e6, 1) + "M"
      : n >= 1e3
        ? num(n / 1e3, 0) + "k"
        : num(n, 0);
}

/** Detail-screen date: weekday + month + day + year (matches prototype fmtDate). */
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "1h 23m" / "45m" — matches prototype mins(). */
export function mins(n: number): string {
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return h ? `${h}h ${m}m` : `${num(n, 0)}m`;
}

/** UTC generated-at stamp, e.g. "2026-05-29 16:30 UTC". */
export function fmtStamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** Split a dollar value into integer dollars + 2-digit cents (matches prototype). */
export function splitMoney(v: number): { dollars: number; cents: string } {
  const dollars = Math.floor(v);
  const cents = Math.round((v - dollars) * 100)
    .toString()
    .padStart(2, "0");
  return { dollars, cents };
}

export type BurnTier = { key: "inferno" | "campfire" | "ember"; name: string; n: number };
export function burnTier(cost: number): BurnTier {
  if (cost >= 300) return { key: "inferno", name: "Inferno", n: 3 };
  if (cost >= 200) return { key: "campfire", name: "Campfire", n: 2 };
  return { key: "ember", name: "Lil’ Ember", n: 1 };
}

/* ---------------- reduced-motion ---------------- */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/* ----------------------------------------------------------------------------
 * Count-up hook. ALWAYS returns the final formatted value on first render (so a
 * backgrounded tab / reduced-motion never shows 0). When motion is allowed it
 * animates 0→end over ~1.3s ease-out-cubic.
 * -------------------------------------------------------------------------- */
export function useCountUp(end: number, fmt: (v: number) => string, dur = 1300): string {
  const reduced = usePrefersReducedMotion();
  const [text, setText] = useState(() => fmt(end));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setText(fmt(end)); // always write final value first
    if (reduced) return;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      setText(fmt(end * ease(p)));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      setText(fmt(end)); // guarantee final on cleanup
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, reduced, dur]);

  return text;
}

/* ----------------------------------------------------------------------------
 * Grow-from-0 flag for bars/donuts. Renders the FINAL value immediately (JSX is
 * the source of truth), then — if motion allowed — flips 0→target on the next
 * tick via a setTimeout-GUARANTEED transition (don't rely on CSS alone: it can
 * freeze in a background tab and hide content).
 * -------------------------------------------------------------------------- */
export function useGrow(delayMs = 90): boolean {
  const reduced = usePrefersReducedMotion();
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    if (reduced) {
      setGrown(true);
      return;
    }
    setGrown(false);
    const id = window.setTimeout(() => setGrown(true), delayMs);
    return () => window.clearTimeout(id);
  }, [reduced, delayMs]);
  return grown;
}

/** Inline style whose width animates 0→target; final value is source of truth. */
export function useGrowWidth(width: number, extra?: CSSProperties, delayMs?: number): CSSProperties {
  const grown = useGrow(delayMs ?? 90);
  return {
    ...extra,
    width: grown ? `${width}%` : "0%",
    transition: "width 1.1s cubic-bezier(.2,.7,.2,1)",
  };
}

/** Inline style whose height animates 0→target; final value is source of truth. */
export function useGrowHeight(height: number, extra?: CSSProperties, delayMs?: number): CSSProperties {
  const grown = useGrow(delayMs ?? 90);
  return {
    ...extra,
    height: grown ? `${height}%` : "0%",
    transition: "height 1.1s cubic-bezier(.2,.7,.2,1)",
  };
}
