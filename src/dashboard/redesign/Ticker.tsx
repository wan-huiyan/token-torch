import type { ReactNode } from "react";
import type { DashboardData } from "../../types";
import { usd } from "../helpers";

/** Arcade ticker (00-dashboard.html line 40 + boot script lines ~222-240).
 *  Decorative headline marquee — the .track CSS animation scrolls it via
 *  translateX(-50%) (~34s linear) and is gated off by prefers-reduced-motion
 *  in the stylesheet, so no JS is needed here. The item list is rendered TWICE
 *  for a seamless loop; the 2nd copy is aria-hidden so it isn't double-read.
 *
 *  ★ is U+2605, a bare typographic glyph (matches the boot script's bare "★ …");
 *  figures are wrapped in <b> (cyan via .ticker .track b). Bound to real fields:
 *  complete_spend_usd, subagent_dispatches, active/idle_hours, projects[0],
 *  tokens.total, avg_cache_hit_pct, time_saved_hours. */
export function Ticker({ data }: { data: DashboardData }) {
  const t = data.totals;
  const p = data.projects[0];
  const spend = t.complete_spend_usd ?? t.cost_usd;
  const totalTokens = t.tokens.total ?? t.tokens.input_fresh + t.tokens.cache_read + t.tokens.output;

  const items: ReactNode[] = [
    <>★ <b>{usd(spend, false)}</b> SPEND</>,
    <>★ <b>{t.subagent_dispatches.toLocaleString()}</b> SUBAGENTS</>,
    <>★ <b>{t.active_hours}H</b> COMPUTE · <b>{t.idle_hours.toLocaleString()}H</b> AWAY</>,
    p ? <>★ TOP BURNER — <b>{p.name}</b> ${p.cost_usd.toLocaleString()}</> : null,
    <>★ <b>{(totalTokens / 1e9).toFixed(1)}B</b> TOKENS</>,
    <>★ <b>{t.avg_cache_hit_pct}%</b> CACHE</>,
    <>★ ~<b>{t.time_saved_hours}H</b> SAVED BY PARALLEL</>,
    <>★ INSERT COIN</>,
  ].filter(Boolean);

  const track = (key: string, ariaHidden: boolean) =>
    items.map((x, i) => (
      <span key={`${key}-${i}`} aria-hidden={ariaHidden || undefined}>
        {x}
      </span>
    ));

  return (
    <div className="ticker">
      <div className="track">
        {track("a", false)}
        {/* duplicate for a seamless marquee loop; hidden from the a11y tree */}
        {track("b", true)}
      </div>
    </div>
  );
}
