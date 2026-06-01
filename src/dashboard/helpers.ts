/* ============================================================================
 * TOKEN TORCH — formatting + animation helpers
 * Ported from the prototype's inline helpers ($, usd, num, pct, tokAbbr,
 * fmtDate, fmtStamp, md, burnTier) plus small React-friendly hooks.
 * ========================================================================== */
import { useEffect, useRef, useState, type CSSProperties } from "react";

export const usd = (v: number, c = true): string =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: c ? 2 : 0, maximumFractionDigits: c ? 2 : 0 });
export const num = (v: number, d = 0): string =>
  v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (v: number, d = 1): string => num(v, d) + "%";
export function tokAbbr(n: number): string {
  return n >= 1e9 ? num(n / 1e9, 2) + "B" : n >= 1e6 ? num(n / 1e6, 1) + "M" : n >= 1e3 ? num(n / 1e3, 0) + "k" : num(n, 0);
}
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
export function fmtStamp(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
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

/* --- markdown: bold (**x**) + "- " bullet lists, matching prototype md() --- */
function mdInline(s: string): string {
  // escape HTML, then re-introduce <strong> for **...**
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
export function md(src: string | null): string | null {
  if (!src) return null;
  const lines = src.split("\n");
  let out = "";
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      out += "<ul>" + list.map((x) => "<li>" + mdInline(x) + "</li>").join("") + "</ul>";
      list = [];
    }
  };
  for (const ln of lines) {
    const t = ln.trim();
    if (t.startsWith("- ")) list.push(t.slice(2));
    else {
      flush();
      if (t) out += "<p>" + mdInline(t) + "</p>";
    }
  }
  flush();
  return out;
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
 * Count-up hook. ALWAYS returns the final formatted value on first render
 * (so a backgrounded tab / reduced-motion never shows 0). When motion is
 * allowed, it animates 0→end over ~1.3s ease-out-cubic.
 * -------------------------------------------------------------------------- */
export function useCountUp(end: number, fmt: (v: number) => string, dur = 1300): string {
  const reduced = usePrefersReducedMotion();
  // Source of truth: the final value is what we render unless we animate.
  const [text, setText] = useState(() => fmt(end));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Always write final value first (covers reduced-motion + re-render).
    setText(fmt(end));
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
 * Bar/gauge grow-from-0 hook. Returns the width/offset to apply. Renders the
 * FINAL value immediately (JSX source of truth), then — if motion allowed —
 * flips 0→target on the next tick via setTimeout (guaranteed, not CSS-only).
 * Use the returned `animate` flag to start a CSS transition for smoothness.
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

/* ----------------------------------------------------------------------------
 * useGrowWidth — returns an inline style whose width renders AT TARGET on first
 * render (JSX source of truth, so reduced-motion / backgrounded tab always show
 * the final value), then grows 0→target on mount via a setTimeout-guaranteed
 * transition. Mirrors the prototype's animateBars() for the non-hero bars.
 * Merge `extra` (e.g. a custom background) into the returned style.
 * -------------------------------------------------------------------------- */
export function useGrowWidth(width: number, extra?: CSSProperties, delayMs?: number): CSSProperties {
  const grown = useGrow(delayMs ?? 90);
  return {
    ...extra,
    width: grown ? `${width}%` : "0%",
    transition: "width 1.1s cubic-bezier(.2,.7,.2,1)",
  };
}
