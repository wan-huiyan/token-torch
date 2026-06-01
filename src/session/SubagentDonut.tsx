/* ============================================================================
 * SubagentDonut — main-vs-subagent cost split. The canonical prototype only ever
 * renders the "no subagents this run" note (its subSplit() returns '' for the
 * >0 branch, which was never built); the typed contract (SessionDetailData)
 * carries cost.main_loop_usd / cost.subagent_usd / subagents_per_dispatch[], so
 * the donut is derived from those when subagent_usd > 0. Reuses the .donut conic
 * CSS. Below ~$0 it falls back to the honest note (degradation rule).
 * ========================================================================== */
import type { SessionDetailData } from "../types";
import { mins, num, usd } from "./helpers";

export function SubagentDonut({ data }: { data: SessionDetailData }) {
  const c = data.cost;
  if (c.subagent_usd <= 0) {
    return (
      <div className="note" style={{ marginTop: 16 }}>
        No subagents this run — all {usd(c.total_usd)} was main-loop cost. (Sessions that fan out show a
        main-vs-subagent donut and a per-dispatch leaderboard here.)
      </div>
    );
  }

  const total = c.main_loop_usd + c.subagent_usd || 1;
  const mainPct = (c.main_loop_usd / total) * 100;
  const stops = `var(--cyan) 0% ${mainPct}%, var(--magenta) ${mainPct}% 100%`;
  const dispatches = [...c.subagents_per_dispatch].sort((a, b) => b.usd - a.usd);

  return (
    <div className="panel subgrid" style={{ marginTop: 16 }}>
      <div className="donut" style={{ background: `conic-gradient(${stops})` }} role="img" aria-label="main vs subagent cost">
        <div className="dc">
          <div className="dn">{usd(c.subagent_usd, false)}</div>
          <div className="dl">subagent spend</div>
        </div>
      </div>
      <div>
        <div className="dleg" style={{ marginBottom: 14 }}>
          <span>
            <i style={{ background: "var(--cyan)" }} />
            main loop
            <b>{usd(c.main_loop_usd)}</b>
          </span>
          <span>
            <i style={{ background: "var(--magenta)" }} />
            subagents · {c.subagents_per_dispatch.length} dispatch
            {c.subagents_per_dispatch.length === 1 ? "" : "es"}
            <b>{usd(c.subagent_usd)}</b>
          </span>
        </div>
        {dispatches.length > 0 && (
          <div className="subdisp">
            {dispatches.map((d) => {
              const label = d.what?.trim() || d.id;
              return (
                <div className="sd" key={d.id}>
                  <div className="sdmain">
                    <span className="sdwhat" title={d.what || d.id}>
                      {label}
                    </span>
                    {d.what ? <span className="sdid">{d.id}</span> : null}
                  </div>
                  <div className="sdstats">
                    {d.span_min != null ? <span className="sdspan">{mins(d.span_min)}</span> : null}
                    <b>{usd(d.usd)}</b>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ fontFamily: "var(--mono)", fontSize: ".7rem", color: "var(--ink-faint)", marginTop: 10 }}>
          {num((c.subagent_usd / total) * 100, 0)}% of the bill was subagent fan-out.
        </div>
      </div>
    </div>
  );
}
