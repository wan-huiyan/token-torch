/* ============================================================================
 * TOKEN TORCH — Timeline tab (redesign)
 * Recreates 00-dashboard.html .tabpanel[data-panel=timeline] (lines 142-149) +
 * dashboard.js renderTimeline()/wireTimelineHover(). The chart is an inline SVG
 * built from dailySeries(windowed sessions, range) — which INCLUDES zero-session
 * days, so real gaps break the cost line (never interpolated). All geometry,
 * colours (oklch literals), padding and segment logic are ported verbatim from
 * the prototype; only the host (vanilla innerHTML) → JSX/React-state changes.
 *
 * Honesty: zero-day gaps are real (the line breaks, no bridging); the $-axis is
 * the genuine per-day cost; the weekend tally is descriptive, not a judgement.
 * Reduced motion: the SVG is fully static (no entrance reveal hides content) —
 * the only motion is the moon pixel sprite, which respects reduced-motion itself.
 *
 * The B4 5-hour-window panel (<BillingWindows>) lives here by design decision;
 * it self-hides when data.billing_windows is absent and carries its own honest
 * "local lower-bound, not a quota" caveat.
 * ========================================================================== */
import { useLayoutEffect, useRef, useState } from "react";
import type { DashboardData } from "../../types";
import { usd, num, fmtDate } from "../helpers";
import { useWindow } from "../useWindow";
import { dailySeries, fmtMin, type DailyPoint } from "../windowAgg";
import { Sprite } from "../Sprite";
import { mountIcon } from "../spriteEngine";
import { BillingWindows } from "../BillingWindows";

interface Tip {
  d: DailyPoint;
  x: number; // clientX
  y: number; // clientY
}

const isWeekend = (dow: number): boolean => dow === 0 || dow === 6;

export function TimelineTab({ data }: { data: DashboardData }) {
  const { sessions, range, isAll } = useWindow();
  const series = dailySeries(sessions, range);

  // Responsive width: ResizeObserver re-measures on tab-switch / window resize
  // (a one-shot measure can read 0 before layout settles). Height fixed at 300.
  const chartRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(960);
  useLayoutEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const measure = () => setW(Math.max(320, el.clientWidth - 4));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [tip, setTip] = useState<Tip | null>(null);

  // ---- geometry (ported verbatim) ----
  const H = 300;
  const padL = 52, padR = 14, padT = 28, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = series.length; // range guarantees n >= 1
  const maxCost = Math.max(10, ...series.map((d) => d.cost));
  const maxSess = Math.max(1, ...series.map((d) => d.sessions));
  const bw = iw / n;
  const x = (i: number) => padL + bw * (i + 0.5);
  const yC = (c: number) => padT + ih - (c / maxCost) * ih;
  const yB = (s: number) => (s / maxSess) * (ih * 0.42);

  // ---- cost line broken into contiguous runs of session-bearing days ----
  // (zero-session days break the line; single-day runs render as a dot — no
  //  interpolation across gaps.)
  const segs: number[][] = [];
  let seg: number[] = [];
  series.forEach((d, i) => {
    if (d.sessions > 0) seg.push(i);
    else { if (seg.length) segs.push(seg); seg = []; }
  });
  if (seg.length) segs.push(seg);

  // ---- top-4 cost peaks ----
  const ranked = series
    .map((d, i) => ({ i, c: d.cost }))
    .filter((o) => o.c > 0)
    .sort((a, b) => b.c - a.c)
    .slice(0, 4);

  // ---- x-axis labels (~every 9 days) ----
  const step = Math.max(1, Math.round(n / 9));
  const xLabels: number[] = [];
  for (let xi = 0; xi < n; xi += step) xLabels.push(xi);

  // ---- weekend tally (descriptive) ----
  let wkSess = 0, wkCost = 0, totCost = 0;
  series.forEach((d) => {
    totCost += d.cost;
    if (isWeekend(d.dow)) { wkSess += d.sessions; wkCost += d.cost; }
  });
  const wkPct = totCost ? Math.round((wkCost / totCost) * 100) : 0;

  let wkMsg: JSX.Element;
  if (wkSess === 0) {
    wkMsg = <div><b>Zero weekend runs</b> in this window — respect, you actually logged off.</div>;
  } else if (wkPct >= 25) {
    wkMsg = (
      <div>
        Oh <b>no</b>. <b>{num(wkSess)} weekend runs</b> torched <b>{usd(wkCost, false)}</b> across Saturdays &amp; Sundays — that's <b>{wkPct}%</b> of the window. Why are you working weekends?! Go touch grass.
      </div>
    );
  } else {
    wkMsg = (
      <div>
        <b>{num(wkSess)} weekend runs</b> burned <b>{usd(wkCost, false)}</b> (Sat &amp; Sun) — <b>{wkPct}%</b> of the window. The tokens don't need a day off, but you might.
      </div>
    );
  }

  const onMove = (e: React.MouseEvent<SVGRectElement>, d: DailyPoint) =>
    setTip({ d, x: e.clientX, y: e.clientY });
  const onLeave = () => setTip(null);

  return (
    <>
      <div className="tl-badge" id="tlBadge">
        {isAll
          ? <><b>Full history.</b> Weekends are shaded; days with no runs break the line (real gaps, not interpolated). Pick a preset above to zoom.</>
          : <><b>{fmtDate(range.from)} – {fmtDate(range.to)}</b> Weekends are shaded; days with no runs break the line (real gaps, not interpolated).</>}
      </div>

      <div className="chart-pad">
        <div className="tl-legend">
          <span><i className="cy" />cost / day</span>
          <span><i className="mg" />sessions / day</span>
          <span><i className="wk" />weekend</span>
        </div>
        <div id="tlChart" ref={chartRef}>
          <svg className="tl-svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
            <defs>
              <linearGradient id="tlfill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="oklch(0.83 0.145 210 / .34)" />
                <stop offset="1" stopColor="transparent" />
              </linearGradient>
              <pattern id="wkhatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                <rect width="7" height="7" fill="oklch(0.74 0.19 350 / .07)" />
                <line x1="0" y1="0" x2="0" y2="7" stroke="oklch(0.74 0.19 350 / .22)" strokeWidth="2.5" />
              </pattern>
            </defs>

            {/* weekend hatch bands (+ SAT·SUN tick on Saturday) */}
            {series.map((d, i) =>
              isWeekend(d.dow) ? (
                <g key={`wk${i}`}>
                  <rect x={(padL + bw * i).toFixed(1)} y={padT} width={bw.toFixed(1)} height={ih} fill="url(#wkhatch)" />
                  {d.dow === 6 && (
                    <text
                      x={(padL + bw * (i + 1)).toFixed(1)}
                      y={padT - 9}
                      textAnchor="middle"
                      fontFamily="var(--mono)"
                      fontSize="8"
                      letterSpacing="1"
                      fill="oklch(0.74 0.19 350 / .8)"
                    >
                      SAT·SUN
                    </text>
                  )}
                </g>
              ) : null,
            )}

            {/* gridlines + $-axis labels (5 lines) */}
            {[0, 1, 2, 3, 4].map((g) => {
              const gy = padT + ih - (g / 4) * ih;
              const gv = (maxCost * g) / 4;
              return (
                <g key={`grid${g}`}>
                  <line x1={padL} y1={gy.toFixed(1)} x2={W - padR} y2={gy.toFixed(1)} stroke="var(--line-soft)" strokeWidth="1" />
                  <text x={padL - 8} y={(gy + 3).toFixed(1)} textAnchor="end" fontFamily="var(--mono)" fontSize="10" fill="var(--ink-faint)">
                    ${num(Math.round(gv))}
                  </text>
                </g>
              );
            })}

            {/* session-count bars (magenta) */}
            {series.map((d, i) =>
              d.sessions > 0 ? (
                <rect
                  key={`bar${i}`}
                  x={(x(i) - bw * 0.28).toFixed(1)}
                  y={(padT + ih - yB(d.sessions)).toFixed(1)}
                  width={(bw * 0.56).toFixed(1)}
                  height={yB(d.sessions).toFixed(1)}
                  rx="2"
                  fill="oklch(0.74 0.19 350 / .5)"
                />
              ) : null,
            )}

            {/* cost line — contiguous runs only (gaps break the line) */}
            {segs.map((sg, si) => {
              if (sg.length === 1) {
                const i0 = sg[0];
                return <circle key={`seg${si}`} cx={x(i0).toFixed(1)} cy={yC(series[i0].cost).toFixed(1)} r="3" fill="var(--cyan)" />;
              }
              const pts = sg.map((i) => `${x(i).toFixed(1)},${yC(series[i].cost).toFixed(1)}`);
              const area = `M${x(sg[0]).toFixed(1)},${padT + ih} L${pts.join(" L")} L${x(sg[sg.length - 1]).toFixed(1)},${padT + ih} Z`;
              return (
                <g key={`seg${si}`}>
                  <path d={area} fill="url(#tlfill)" />
                  <polyline points={pts.join(" ")} fill="none" stroke="var(--cyan)" strokeWidth="2" style={{ filter: "drop-shadow(0 0 5px var(--cyan))" }} />
                </g>
              );
            })}

            {/* weekend cost markers (magenta rings) */}
            {series.map((d, i) =>
              isWeekend(d.dow) && d.cost > 0 ? (
                <circle
                  key={`wm${i}`}
                  cx={x(i).toFixed(1)}
                  cy={yC(d.cost).toFixed(1)}
                  r="4.5"
                  fill="none"
                  stroke="var(--magenta)"
                  strokeWidth="2"
                  style={{ filter: "drop-shadow(0 0 5px var(--magenta))" }}
                />
              ) : null,
            )}

            {/* top-4 peak labels */}
            {ranked.map((o) => (
              <text
                key={`pk${o.i}`}
                x={x(o.i).toFixed(1)}
                y={(yC(series[o.i].cost) - 9).toFixed(1)}
                textAnchor="middle"
                fontFamily="var(--mono)"
                fontSize="10"
                fontWeight="700"
                fill="var(--cyan)"
              >
                ${num(Math.round(series[o.i].cost))}
              </text>
            ))}

            {/* x-axis date labels (~weekly) */}
            {xLabels.map((xi) => (
              <text key={`xl${xi}`} x={x(xi).toFixed(1)} y={H - 9} textAnchor="middle" fontFamily="var(--mono)" fontSize="9.5" fill="var(--ink-faint)">
                {fmtDate(series[xi].date)}
              </text>
            ))}

            {/* hover capture rects (one per day) */}
            {series.map((d, i) => (
              <rect
                key={`hit${i}`}
                className="tlhit"
                x={(padL + bw * i).toFixed(1)}
                y={padT}
                width={bw.toFixed(1)}
                height={ih}
                fill="transparent"
                onMouseMove={(e) => onMove(e, d)}
                onMouseLeave={onLeave}
              />
            ))}
          </svg>
        </div>
      </div>

      <div className="tl-weekend" id="tlWeekend">
        <Sprite mount={(h) => mountIcon(h, "moon", 3)} className="wkic" />
        {wkMsg}
      </div>

      {/* tooltip — position:fixed at cursor (no transform on any ancestor) */}
      <div className="tl-tip" id="tlTip" style={{ opacity: tip ? 1 : 0, left: tip ? tip.x + 14 : 0, top: tip ? tip.y - 10 : 0 }}>
        {tip && (
          <>
            <b>{fmtDate(tip.d.date)}</b> · {isWeekend(tip.d.dow) ? "weekend" : "weekday"}
            <br />
            {tip.d.sessions ? (
              <>
                {usd(tip.d.cost, false)} · <span className="mg">{tip.d.sessions} runs</span> · {fmtMin(tip.d.active)} active
              </>
            ) : (
              "no runs"
            )}
          </>
        )}
      </div>

      {/* B4 — 5-hour-window panel (self-hides when absent) */}
      <BillingWindows data={data} />
    </>
  );
}
