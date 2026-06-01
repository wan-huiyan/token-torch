import type { DashboardData } from "../types";
import { num, usd, fmtDate } from "./helpers";
import { Section } from "./Section";

/** Hand-rolled neon SVG combo chart: glowing cost line + area, magenta session
 *  bars, gridlines, $ axis, value labels. No chart library. */
function Chart({ tl }: { tl: DashboardData["timeline"] }) {
  const W = 900;
  const H = 300;
  const pad = { l: 62, r: 24, t: 30, b: 48 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const rawMax = Math.max(...tl.map((d) => d.cost_usd));
  const niceMax = Math.max(200, Math.ceil(rawMax / 200) * 200);
  const maxS = Math.max(1, ...tl.map((d) => d.sessions));
  const x = (i: number) => pad.l + (tl.length === 1 ? iw / 2 : (i / (tl.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / niceMax) * ih;

  const grid: React.ReactNode[] = [];
  const ylab: React.ReactNode[] = [];
  for (let g = 0; g <= 4; g++) {
    const gv = (niceMax * g) / 4;
    const gy = y(gv);
    grid.push(<line key={`g${g}`} x1={pad.l} y1={gy} x2={pad.l + iw} y2={gy} style={{ stroke: "var(--line-soft)" }} strokeWidth="1" />);
    ylab.push(
      <text key={`yl${g}`} x={pad.l - 12} y={gy + 4} textAnchor="end" fontFamily="ui-monospace,monospace" fontSize="12" style={{ fill: "var(--ink-faint)" }}>
        ${num(gv, 0)}
      </text>,
    );
  }
  const bw = Math.min(54, (iw / tl.length) * 0.36);
  const bars = tl.map((d, i) => {
    const bh = (d.sessions / maxS) * ih * 0.66;
    return (
      <g key={`b${i}`}>
        <rect x={x(i) - bw / 2} y={pad.t + ih - bh} width={bw} height={bh} rx="6" style={{ fill: "var(--magenta)" }} opacity=".26" />
        <text x={x(i)} y={pad.t + ih - bh - 9} textAnchor="middle" fontFamily="ui-monospace,monospace" fontSize="11" style={{ fill: "var(--magenta)" }}>
          {d.sessions} {d.sessions > 1 ? "runs" : "run"}
        </text>
      </g>
    );
  });
  const pts = tl.map((d, i) => [x(i), y(d.cost_usd)] as const);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
  const area = `M ${pad.l} ${pad.t + ih} ` + pts.map((p) => "L" + p[0] + " " + p[1]).join(" ") + ` L ${pad.l + iw} ${pad.t + ih} Z`;
  const dots = pts.map((p, i) => (
    <g key={`d${i}`}>
      <circle cx={p[0]} cy={p[1]} r="6" style={{ fill: "var(--cyan)", stroke: "var(--bg)" }} strokeWidth="3" filter="url(#tt-tlgl)" />
      <text x={p[0]} y={p[1] - 15} textAnchor="middle" fontFamily="ui-monospace,monospace" fontSize="14" fontWeight="700" style={{ fill: "var(--cyan)" }}>
        {usd(tl[i].cost_usd, false)}
      </text>
    </g>
  ));
  const labs = tl.map((d, i) => (
    <text key={`l${i}`} x={x(i)} y={H - 16} textAnchor="middle" fontFamily="ui-monospace,monospace" fontSize="12" style={{ fill: "var(--ink-dim)" }}>
      {fmtDate(d.date)}
    </text>
  ));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ overflow: "visible" }} role="img" aria-label="Cost and sessions per day">
      <defs>
        <linearGradient id="tt-ag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--cyan)", stopOpacity: 0.4 }} />
          <stop offset="1" style={{ stopColor: "var(--cyan)", stopOpacity: 0 }} />
        </linearGradient>
        <filter id="tt-tlgl" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {grid}
      {ylab}
      {bars}
      <path d={area} fill="url(#tt-ag)" />
      <path d={line} fill="none" style={{ stroke: "var(--cyan)" }} strokeWidth="3" strokeLinecap="round" filter="url(#tt-tlgl)" />
      {dots}
      {labs}
    </svg>
  );
}

export function TimelineChart({ data }: { data: DashboardData }) {
  const small = data.meta.small_n;
  return (
    <Section title="Timeline · cost & sessions per day" n={small ? "preview · small N" : "daily"}>
      <div className="panel">
        <div className="chart-pad">
          {small && (
            <div className="tl-badge">
              <b>📉 sample only</b> {data.meta.session_count} runs so far — shown as a layout reference, not a real
              trend. Honest trends need ~10 sessions; check back later.
            </div>
          )}
          <div className="tl-legend">
            <span>
              <i className="cy" />
              cost / day
            </span>
            <span>
              <i className="mg" />
              sessions / day
            </span>
          </div>
          <Chart tl={data.timeline} />
        </div>
      </div>
    </Section>
  );
}
