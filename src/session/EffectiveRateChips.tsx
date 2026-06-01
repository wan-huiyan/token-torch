/* ============================================================================
 * EffectiveRateChips — two chips: the blended all-in rate (cost.blended_per_mtok
 * _usd) and the cache hit (tokens.cache_hit_pct). Mirrors the prototype chips().
 * ========================================================================== */
import type { SessionDetailData } from "../types";
import { abbr, pct, usd } from "./helpers";

export function EffectiveRateChips({ data }: { data: SessionDetailData }) {
  const c = data.cost;
  const tk = data.tokens;
  return (
    <div className="chips">
      <div className="panel chip">
        <div className="k">Blended rate · all-in</div>
        <div className="v" style={{ color: "var(--cyan)" }}>
          {usd(c.blended_per_mtok_usd)}
          <span style={{ fontSize: ".5em", color: "var(--ink-faint)" }}> / 1M tok</span>
        </div>
        <div className="s">
          {abbr(tk.total)} tokens · {usd(c.total_usd)}
        </div>
      </div>
      <div className="panel chip">
        <div className="k">Cache hit</div>
        <div className="v" style={{ color: "var(--lime)" }}>
          {pct(tk.cache_hit_pct, 1)}
        </div>
        <div className="s">share of input served from cache</div>
      </div>
    </div>
  );
}
