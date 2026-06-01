/* ============================================================================
 * CostWaterfall — a stacked share-bar over rows that sum to cost.total_usd. Each
 * row is labeled with tokens + rate_per_mtok and the dollar contribution.
 * Mirrors the prototype waterfall().
 * ========================================================================== */
import type { SessionDetailData } from "../types";
import { abbr, usd } from "./helpers";
import { CATCOL, CATLAB, CAT_ORDER } from "./categories";

export function CostWaterfall({ data }: { data: SessionDetailData }) {
  const bc = data.cost.by_category!;
  const tot = data.cost.total_usd;
  return (
    <>
      <div className="sec-head" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: ".7rem", letterSpacing: ".16em" }}>Cost waterfall</h2>
        <div className="ln" />
        <div className="n">= {usd(tot)}</div>
      </div>
      <div className="wfbar" role="img" aria-label="cost breakdown by category">
        {CAT_ORDER.map((k) => (
          <div className="s" key={k} style={{ flex: `${bc[k].cost_pct} 0 0`, background: CATCOL[k] }} />
        ))}
      </div>
      {CAT_ORDER.map((k) => (
        <div className="wfrow" key={k}>
          <div className="wl">
            <i style={{ background: CATCOL[k] }} />
            {CATLAB[k]}
          </div>
          <div className="wm">
            {abbr(bc[k].tokens)} tok · {usd(bc[k].rate_per_mtok)}/M
          </div>
          <div className="wv" style={{ color: CATCOL[k] }}>
            {usd(bc[k].usd)}
          </div>
        </div>
      ))}
    </>
  );
}
