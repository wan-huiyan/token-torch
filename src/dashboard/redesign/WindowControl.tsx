/* ============================================================================
 * TOKEN TORCH redesign — time-window control (00-dashboard.html lines 88-116).
 * The single driver of the shared window state: presets (7/14/30/all), a
 * draggable brush over the full-corpus cost sparkline, and a calendar range
 * picker all funnel into useWindow().setMode / setCustom so the hero, podium,
 * stat strip + every tab re-derive in lockstep. This is a FILTER control —
 * correctness IS the honesty bar: the window must actually filter, and every
 * label/axis is bound to the REAL corpus bounds (never a hardcoded date).
 *
 * Ports dashboard.js windowRange / winLabel / setMode / buildCalendar /
 * buildBrushSpark / paintBrush / applyBrush / syncBrush / wireBrush onto React
 * (refs + state + pointer-capture). The brush position DERIVES from the shared
 * `range` (so clicking a preset / picking a calendar range moves it for free —
 * the prototype's syncBrush); a transient drag snapshot overrides only while a
 * handle is held.
 * ========================================================================== */
import { useEffect, useMemo, useRef, useState } from "react";
import type { DashboardData } from "../../types";
import { fmtDate } from "../helpers";
import { dailySeries } from "../windowAgg";
import { useWindow } from "../useWindow";

const DAY_MS = 864e5;
const parseDay = (iso: string): number => Date.parse(iso + "T00:00:00Z");
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

interface Frac {
  L: number;
  R: number;
}

export function WindowControl({ data }: { data: DashboardData }) {
  const { state, bounds, range, sessions, setMode, setCustom } = useWindow();

  const [showBrush, setShowBrush] = useState(false);
  const [showCal, setShowCal] = useState(false);

  // Outside-click closes the calendar popover (prototype wire()): the toggle +
  // .pop stop propagation, so any other document click dismisses it.
  useEffect(() => {
    if (!showCal) return;
    const onDoc = () => {
      setShowCal(false);
      setPending(null); // discard a half-made (first-click) range on dismiss
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [showCal]);

  // ----- frac <-> ISO mapping over the corpus [bounds.from, bounds.to] -----
  const fromMs = parseDay(bounds.from);
  const nDays = Math.round((parseDay(bounds.to) - fromMs) / DAY_MS) + 1;
  const fracToISO = (f: number): string => isoOf(fromMs + Math.round(f * (nDays - 1)) * DAY_MS);

  // Brush position derives from the shared range (presets/calendar move it for
  // free); `dragFrac` only overrides while a handle is held.
  const baseFrac = useMemo<Frac>(() => {
    const denom = nDays - 1 || 1;
    return {
      L: clamp01((parseDay(range.from) - fromMs) / DAY_MS / denom),
      R: clamp01((parseDay(range.to) - fromMs) / DAY_MS / denom),
    };
  }, [range.from, range.to, fromMs, nDays]);
  const [dragFrac, setDragFrac] = useState<Frac | null>(null);
  const frac = dragFrac ?? baseFrac;

  const brushRef = useRef<HTMLDivElement>(null);

  // ----- full-corpus cost sparkline (matches buildBrushSpark geometry) -----
  const spark = useMemo(() => {
    const series = dailySeries(data.sessions, { from: bounds.from, to: bounds.to, all: true });
    const n = series.length;
    const mx = Math.max(1, ...series.map((d) => d.cost));
    let pts = "";
    let area = "M0,64 ";
    series.forEach((d, i) => {
      const x = (i / (n - 1 || 1)) * 280;
      const yv = 64 - (d.cost / mx) * 58;
      pts += `${x.toFixed(1)},${yv.toFixed(1)} `;
      area += `L${x.toFixed(1)},${yv.toFixed(1)} `;
    });
    area += "L280,64 Z";
    return { pts, area };
  }, [data.sessions, bounds.from, bounds.to]);

  // ----- drag (pointer-capture); release commits via setCustom -----------
  const startDrag = (e: React.PointerEvent, isL: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    let cur: Frac = { ...baseFrac };
    setDragFrac(cur);
    const onMove = (ev: PointerEvent) => {
      const rect = brushRef.current?.getBoundingClientRect();
      if (!rect) return;
      const f = clamp01((ev.clientX - rect.left) / rect.width);
      cur = isL ? { ...cur, L: Math.min(f, cur.R - 0.02) } : { ...cur, R: Math.max(f, cur.L + 0.02) };
      setDragFrac(cur);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setCustom(fracToISO(cur.L), fracToISO(cur.R));
      setDragFrac(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ----- window label (refreshAll line 705: bold main · dim meta) ---------
  const label = useMemo(() => {
    if (range.all) {
      return {
        main: "all time",
        meta: `${data.meta.session_count} sessions · ${fmtDate(bounds.from)}–${fmtDate(bounds.to)}`,
      };
    }
    const days = Math.round((parseDay(range.to) - parseDay(range.from)) / DAY_MS) + 1;
    return {
      main: `${fmtDate(range.from)} – ${fmtDate(range.to)}`,
      meta: `${days} days · ${sessions.length} sessions`,
    };
  }, [range.all, range.from, range.to, sessions.length, data.meta.session_count, bounds.from, bounds.to]);

  // ----- calendar -------------------------------------------------------
  // calMonth = first-of-month being viewed; init to the corpus end month.
  const [calMonthMs, setCalMonthMs] = useState(() => {
    const d = new Date(parseDay(bounds.to));
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  });
  // First-click pending date (local until a 2nd click commits the range).
  const [pending, setPending] = useState<string | null>(null);

  const onDayClick = (di: string) => {
    if (!pending) {
      setPending(di);
      return;
    }
    const from = di < pending ? di : pending;
    const to = di < pending ? pending : di;
    setPending(null);
    setCustom(from, to);
  };

  const cal = useMemo(() => {
    const m = new Date(calMonthMs);
    const y = m.getUTCFullYear();
    const mo = m.getUTCMonth();
    const startDow = new Date(Date.UTC(y, mo, 1)).getUTCDay();
    const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const monName = new Date(Date.UTC(y, mo, 1)).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    // Active range for highlighting: pending wins (first click), else a
    // committed custom range; presets/all show no calendar range.
    const fromI = pending ?? (state.mode === "custom" ? range.from : null);
    const toI = pending ? null : state.mode === "custom" ? range.to : null;
    const days: { iso: string; n: number; cls: string }[] = [];
    for (let d = 1; d <= dim; d++) {
      const di = isoOf(Date.UTC(y, mo, d));
      let cls = "day";
      if (di === fromI || di === toI) cls += " edge";
      else if (fromI && toI && di > fromI && di < toI) cls += " in";
      days.push({ iso: di, n: d, cls });
    }
    return { y, mo, startDow, monName, days };
  }, [calMonthMs, pending, state.mode, range.from, range.to]);

  return (
    <div className="windowbar">
      <span className="wlead">Time window</span>

      <div className="seg" id="winSeg">
        <button className={state.mode === 7 ? "on" : undefined} onClick={() => setMode(7)}>
          7d
        </button>
        <button className={state.mode === 14 ? "on" : undefined} onClick={() => setMode(14)}>
          14d
        </button>
        <button className={state.mode === 30 ? "on" : undefined} onClick={() => setMode(30)}>
          30d
        </button>
        <button className={state.mode === "all" ? "on" : undefined} onClick={() => setMode("all")}>
          all
        </button>
      </div>

      <button
        className="btn-ghost"
        onClick={(e) => {
          e.stopPropagation();
          setShowBrush((v) => !v);
          setShowCal(false);
        }}
      >
        ▬ brush
      </button>

      <div style={{ position: "relative" }}>
        <button
          className="btn-ghost"
          onClick={(e) => {
            e.stopPropagation();
            setShowCal((v) => !v);
            setShowBrush(false);
          }}
        >
          ▦ calendar
        </button>
        <div
          className={"pop" + (showCal ? " open" : "")}
          id="calPop"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pl">Pick a range</div>
          <div className="cal" id="calBox">
            <div className="mh">
              <span onClick={() => setCalMonthMs(Date.UTC(cal.y, cal.mo - 1, 1))}>‹</span>
              <span>{cal.monName}</span>
              <span onClick={() => setCalMonthMs(Date.UTC(cal.y, cal.mo + 1, 1))}>›</span>
            </div>
            <div className="grid">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div className="dow" key={i}>
                  {d}
                </div>
              ))}
              {Array.from({ length: cal.startDow }, (_, i) => (
                <div className="day mut" key={"mut" + i} />
              ))}
              {cal.days.map((c) => (
                <div className={c.cls} data-d={c.iso} key={c.iso} onClick={() => onDayClick(c.iso)}>
                  {c.n}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <span className="winlabel" id="winLabel">
        showing <b>{label.main}</b> · <span className="dim">{label.meta}</span>
      </span>

      <div className={"brush-row" + (showBrush ? " open" : "")} id="brushRow">
        <div className="brush-wrap">
          <div className="brush-head">
            <span>drag handles to set window</span>
            <span>
              {fmtDate(bounds.from)} — {fmtDate(bounds.to)} · all history
            </span>
          </div>
          <div className="brush" id="brush" ref={brushRef}>
            <div className="mask" id="bMaskL" style={{ left: 0, width: `${frac.L * 100}%` }} />
            <div className="mask" id="bMaskR" style={{ left: `${frac.R * 100}%`, width: `${(1 - frac.R) * 100}%` }} />
            <div className="window" id="bWin" style={{ left: `${frac.L * 100}%`, width: `${(frac.R - frac.L) * 100}%` }} />
            <div
              className="handle"
              id="bhL"
              style={{ left: `${frac.L * 100}%` }}
              onPointerDown={(e) => startDrag(e, true)}
            />
            <div
              className="handle"
              id="bhR"
              style={{ left: `${frac.R * 100}%` }}
              onPointerDown={(e) => startDrag(e, false)}
            />
            <svg id="brushSpark" viewBox="0 0 280 64" preserveAspectRatio="none">
              <defs>
                <linearGradient id="bs" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="oklch(0.83 0.145 210 / .3)" />
                  <stop offset="1" stopColor="transparent" />
                </linearGradient>
              </defs>
              <path d={spark.area} fill="url(#bs)" />
              <polyline
                points={spark.pts}
                fill="none"
                stroke="var(--cyan)"
                strokeWidth={1.3}
                style={{ filter: "drop-shadow(0 0 4px var(--cyan))" }}
              />
            </svg>
          </div>
          <div className="brush-ax">
            <span>{fmtDate(bounds.from)}</span>
            <span>{fmtDate(bounds.to)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
