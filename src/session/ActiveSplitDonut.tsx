/* ============================================================================
 * ActiveSplitDonut — conic-gradient donut of time.active_breakdown as shares of
 * ACTIVE minutes (not wall-clock), with a legend. Only nonzero phases appear.
 * Returns null when every breakdown phase is zero (degraded record) so the
 * caller can skip it — a conic-gradient with no stops is invalid CSS and would
 * render blank. Mirrors the prototype activeSplit().
 * ========================================================================== */
import type { SessionDetailData } from "../types";
import { mins, pct } from "./helpers";

const ITEMS: [keyof SessionDetailData["time"]["active_breakdown"], string, string][] = [
  ["thinking_min", "Thinking", "var(--cyan)"],
  ["tool_min", "Tool calls", "var(--lime)"],
  ["subagent_min", "Subagents", "var(--magenta)"],
  ["planning_min", "Planning", "var(--amber)"],
];

/** True when at least one active-breakdown phase has nonzero minutes. */
export function hasActiveBreakdown(data: SessionDetailData): boolean {
  const b = data.time.active_breakdown;
  return ITEMS.some(([k]) => b[k] > 0);
}

export function ActiveSplitDonut({ data }: { data: SessionDetailData }) {
  const b = data.time.active_breakdown;
  const act = data.time.active_min || 1;
  const items = ITEMS.filter(([k]) => b[k] > 0);
  if (!items.length) return null;

  let cum = 0;
  const stops = items
    .map(([k, , col]) => {
      const share = (b[k] / act) * 100;
      const seg = `${col} ${cum}% ${cum + share}%`;
      cum += share;
      return seg;
    })
    .join(",");

  return (
    <div className="donut-wrap">
      <div className="donut" style={{ background: `conic-gradient(${stops})` }} role="img" aria-label="active compute split">
        <div className="dc">
          <div className="dn">{mins(data.time.active_min)}</div>
          <div className="dl">active compute</div>
        </div>
      </div>
      <div className="dleg">
        {items.map(([k, label, col]) => (
          <span key={k}>
            <i style={{ background: col }} />
            {label}
            <b>
              {mins(b[k])} · {pct((b[k] / act) * 100, 0)}
            </b>
          </span>
        ))}
      </div>
      <div style={{ fontFamily: "var(--mono)", fontSize: ".7rem", color: "var(--ink-faint)", lineHeight: 1.5 }}>
        Shares are of <b style={{ color: "var(--ink-dim)" }}>active compute</b>, not wall-clock.
        {items.length < 3 ? " No subagent or planning time this run." : ""}
      </div>
    </div>
  );
}
