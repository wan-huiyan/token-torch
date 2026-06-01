/* ============================================================================
 * ToolLeaderboard — tool_time[] ranked by total_min, each with count + p95.
 * Interactive tools (interactive: true, e.g. AskUserQuestion) are tagged
 * "⏳ waiting on you, not machine time" (amber, hatched bar) and EXCLUDED from
 * the machine tool-time subtotal, which is shown explicitly with the honest
 * caveat. Mirrors the prototype toolBoard(). Bars grow 0→target (final-safe).
 * ========================================================================== */
import type { SessionDetailData } from "../types";
import { num, useGrowWidth } from "./helpers";

/** The bar fill grows 0→target; its colour (cyan vs amber hatch for interactive)
 *  is set by CSS via the parent row's `.inter` class. */
function ToolBar({ width }: { width: number }) {
  const style = useGrowWidth(width);
  return (
    <div className="tb">
      <i style={style} aria-hidden="true" />
    </div>
  );
}

export function ToolLeaderboard({ data }: { data: SessionDetailData }) {
  const tt = [...data.tool_time].sort((a, b) => b.total_min - a.total_min);
  const max = Math.max(...tt.map((t) => t.total_min), 0.0001);
  const machine = tt.filter((t) => !t.interactive).reduce((a, t) => a + t.total_min, 0);
  const firstInteractive = tt.find((t) => t.interactive);

  return (
    <div className="tlb">
      <div className="sec-head" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: ".7rem", letterSpacing: ".16em" }}>Tool time</h2>
      </div>
      {tt.map((t) => {
        const w = Math.max((t.total_min / max) * 100, 1.5);
        const val = t.total_min >= 0.1 ? num(t.total_min, 1) + "m" : "<0.1m";
        return (
          <div key={t.name} className={`tlrow${t.interactive ? " inter" : ""}`}>
            <div className="tn">
              {t.name}
              <small>
                {t.count}× · p95 {t.p95_s}s
              </small>
              {t.interactive && <span className="itag">⏳ waiting on you, not machine time</span>}
            </div>
            <ToolBar width={w} />
            <div className="tv">{val}</div>
          </div>
        );
      })}
      <div className="tlsub">
        <b>{num(machine, 1)} min</b> of real machine tool time (Bash/Edit/Write/Read).
        {firstInteractive ? (
          <>
            {" "}
            {firstInteractive.name}'s {num(firstInteractive.total_min, 1)} min is{" "}
            <b style={{ color: "var(--amber)" }}>you answering</b> — excluded from the machine subtotal.
          </>
        ) : null}
      </div>
    </div>
  );
}
