/* Radial cache gauge — gradient arc cyan→lime→amber over a dotted-tick track,
 * with a glowing pulsing tip-dot and a pulsing %. The arc grows 0→target via a
 * setTimeout-guaranteed stroke-dashoffset (renders final on reduced motion). */
import { num, useGrow } from "./helpers";

export function RadialGauge({ pct }: { pct: number }) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const off = C * (1 - pct / 100);
  // tip-dot position along the arc (start at -90deg, sweep clockwise by pct).
  const ang = ((-90 + (360 * pct) / 100) * Math.PI) / 180;
  const gdx = 42 + R * Math.cos(ang);
  const gdy = 42 + R * Math.sin(ang);
  const grown = useGrow(120);

  return (
    <svg viewBox="0 0 84 84" className="gauge-svg" role="img" aria-label={`Average cache hit ${num(pct, 1)} percent`}>
      <defs>
        <linearGradient id="tt-gg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--cyan)" }} />
          <stop offset="0.6" style={{ stopColor: "var(--lime)" }} />
          <stop offset="1" style={{ stopColor: "var(--amber)" }} />
        </linearGradient>
      </defs>
      <circle cx="42" cy="42" r={R} fill="none" style={{ stroke: "var(--line)" }} strokeWidth="9" strokeDasharray="1 5" opacity=".7" />
      <circle
        className="garc"
        cx="42"
        cy="42"
        r={R}
        fill="none"
        strokeWidth="9"
        strokeLinecap="round"
        transform="rotate(-90 42 42)"
        strokeDasharray={C}
        strokeDashoffset={grown ? off : C}
        style={{ stroke: "url(#tt-gg)", transition: "stroke-dashoffset 1.4s cubic-bezier(.2,.7,.2,1)" }}
      />
      <circle className="gdot" cx={gdx.toFixed(2)} cy={gdy.toFixed(2)} r="4.5" style={{ fill: "#fff" }} />
    </svg>
  );
}
