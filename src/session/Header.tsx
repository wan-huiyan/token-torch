/* ============================================================================
 * Header — burn-tier badge + tiny flame, fidelity badge (derived from data),
 * project · date · session id · model crumb, big cost (count-up) with a
 * main/subagent split line + confidence bar, and the "estimate" note. A pixel
 * flame flickers top-right. Mirrors the prototype's header()/decorate() flame.
 * ========================================================================== */
import type { SessionDetailData } from "../types";
import { burnTier, fmtDate, num, pct, splitMoney, usd, useCountUp } from "./helpers";
import { PixelSprite } from "./PixelSprite";
import { FLM, FLM_PAL, FLM_S } from "./sprites";

export function Header({ data }: { data: SessionDetailData }) {
  const tier = burnTier(data.cost_usd, data.burn_bands);
  const { dollars, cents } = splitMoney(data.cost_usd);
  const dollarsText = useCountUp(dollars, (v) => num(Math.round(v), 0));
  const sub = data.cost.subagent_usd;
  const isHigh = data.fidelity === "high";

  // confidence split bar (main loop vs subagent) — only meaningful when sub>0
  const total = data.cost.main_loop_usd + sub;
  const mPct = total > 0 ? (data.cost.main_loop_usd / total) * 100 : 100;
  const sPct = 100 - mPct;

  return (
    <section className="head">
      <span className="tier" title="Burn tier is relative to your own usage, not an absolute price.">
        <span className="hflames">
          <PixelSprite frames={FLM_S} pal={FLM_PAL} scale={2} />
        </span>
        {tier.name}
      </span>
      <span className={isHigh ? "badge hi" : "badge ml"}>{isHigh ? "High fidelity" : "Main-loop only"}</span>

      <div className="crumb">
        <b>{data.project}</b> · {fmtDate(data.date)} · session {data.id} · {data.model.toUpperCase()}
      </div>

      <div className="bignum">
        <span className="cur">$</span>
        {dollarsText}
        <span className="cents">.{cents}</span>
      </div>

      {sub > 0 && (
        <div className="splitbar" role="img" aria-label={`main loop ${pct(mPct, 0)}, subagents ${pct(sPct, 0)}`}>
          <div className="m" style={{ width: `${mPct}%` }} />
          <div className="s" style={{ width: `${sPct}%` }} />
        </div>
      )}

      <div className="hsplit">
        <span>
          main loop <b>{usd(data.cost.main_loop_usd)}</b>
        </span>
        <span>
          subagents <b>{sub > 0 ? usd(sub) : "$0 (none this run)"}</b>
        </span>
        <span>
          cache hit <b>{pct(data.cache_pct, 1)}</b>
        </span>
      </div>

      <div className="est">
        Costs are an <b style={{ color: "var(--amber)" }}>estimate</b> ·{" "}
        {isHigh
          ? "high fidelity (subagent spend counted)"
          : "main-loop fidelity (subagent spend uncounted" + (sub > 0 ? ")" : " — none here)")}
      </div>

      <PixelSprite frames={FLM} pal={FLM_PAL} scale={4} className="flame-cv" mode={{ kind: "cycle", intervalMs: 120 }} />
    </section>
  );
}
