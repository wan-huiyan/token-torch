import type { DashboardData } from "../types";
import { usd, pct, useGrowWidth } from "./helpers";

/** Opt-in plan-% headroom bar (B2). Renders ONLY when data.plan is present
 *  (i.e. the user supplied a gitignored plan.local.json). Always tagged
 *  [estimate] — plan limits + reset cadence are user-supplied, not verified. */
export function PlanBar({ data }: { data: DashboardData }) {
  const p = data.plan;
  if (!p) return null; // no config → no bar (no fabrication)

  const hasLimit = typeof p.limit_usd === "number" && p.limit_usd > 0;
  const usedPct = hasLimit ? Math.min(100, (p.spend_usd / (p.limit_usd as number)) * 100) : 0;

  return (
    <section className="planbar" aria-label="plan usage estimate">
      <div className="pb-head">
        <span className="pb-tier">{p.tier}</span>
        <span className="pb-est">[estimate]</span>
      </div>
      {hasLimit ? (
        <>
          <div className="pb-track">
            <i style={useGrowWidth(usedPct, { background: "var(--amber)" })} />
          </div>
          <div className="pb-cap">
            {usd(p.spend_usd, false)} of {usd(p.limit_usd as number, false)} this cycle · {pct(usedPct, 0)} used
          </div>
        </>
      ) : (
        <div className="pb-cap">
          {usd(p.spend_usd, false)} spent this cycle · no limit supplied, so headroom can't be shown
        </div>
      )}
      <div className="pb-note">{p.note}</div>
    </section>
  );
}
