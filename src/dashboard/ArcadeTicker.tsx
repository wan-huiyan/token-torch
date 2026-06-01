import type { DashboardData } from "../types";
import { num, usd, pct } from "./helpers";

/** Arcade marquee — duplicated track scrolls via translateX(-50%) (~30s linear).
 *  Reduced-motion disables the scroll (CSS), so the (static) headline stays read. */
export function ArcadeTicker({ data }: { data: DashboardData }) {
  const t = data.totals;
  const p = data.projects[0];
  const items = [
    "INSERT COIN",
    num(t.tokens.cache_read / 1e9, 1) + "B TOKENS",
    t.sessions + " SESSIONS",
    pct(t.avg_cache_hit_pct, 1) + " CACHE HIT",
    num(t.time_saved_hours, 1) + "H SAVED BY PARALLEL",
    "$" + num(Math.floor(t.cost_usd), 0) + " SPEND",
    t.subagent_dispatches + " SUBAGENTS",
    num(t.active_hours, 1) + "H COMPUTE · " + num(t.idle_hours, 1) + "H AWAY",
    p ? "TOP BURNER — " + p.name + " " + usd(p.cost_usd, false) : "",
  ].filter(Boolean);

  const track = (key: string, ariaHidden: boolean) => (
    <>
      {items.map((x, i) => (
        <span key={`${key}-${i}`} aria-hidden={ariaHidden || undefined}>
          <b className="star">★</b> {x}
        </span>
      ))}
    </>
  );

  return (
    <div className="ticker" aria-label="Headline stats marquee">
      <div className="track">
        {track("a", false)}
        {/* duplicate for seamless loop; hidden from a11y tree */}
        {track("b", true)}
      </div>
    </div>
  );
}
