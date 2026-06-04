/* ============================================================================
 * SessionHero — the `.dhero` block of 01-session-detail.html (lines 29-44) +
 * `.weekend-banner`, recreated pixel-perfectly from REAL SessionDetailData.
 * Mirrors the hero part of detail.js render() (dFlame / dTier / dCost / dSplit /
 * weekend chip + banner). Honesty spine: ≈estimate on the $, Full/Partial cost
 * badge with the fidelity tooltip card, recon ⓘ, and a weekend chip derived
 * from the real date. No emoji — the moon is a pixel sprite. Content is the
 * source of truth at rest (useCountUp/useGrowWidth always write the final value).
 * ========================================================================== */
import { useEffect } from "react";
import type { SessionDetailData } from "../../types";
import { Sprite } from "../../dashboard/Sprite";
import { mountFlame, miniFlames, mountIcon } from "../../dashboard/spriteEngine";
import { tierOf } from "../../dashboard/windowAgg";
import { prettyModelId } from "../../shared/models";
import { Cents } from "../../dashboard/redesign/ui";
import { usd, pct, fmtDate, useCountUp, useGrowWidth } from "../helpers";

export function SessionHero({ data }: { data: SessionDetailData }) {
  const ti = tierOf(data.cost_usd);

  // Tier theme: the prototype sets `body.classList.add("t-"+tier)` (detail.js:143)
  // which is what defines `--tc` (used by `.dhero::before` + `.dtier`). Nothing
  // else in the React tree sets it, so own it here for the hero's lifetime.
  useEffect(() => {
    const cls = "t-" + ti.tier;
    document.body.classList.add(cls);
    return () => document.body.classList.remove(cls);
  }, [ti.tier]);

  const partial = data.fidelity === "main_loop";

  // weekend = real UTC day-of-week from the session date (0=Sun, 6=Sat).
  const wkDate = new Date(data.date + "T00:00:00Z");
  const dow = wkDate.getUTCDay();
  const isWeekend = dow === 0 || dow === 6;
  const dayName = wkDate.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

  // main/sub split — match the prototype denominator exactly (main / total).
  const main = data.cost.main_loop_usd;
  const sub = data.cost.subagent_usd;
  const mp = Math.round((main / data.cost_usd) * 100);
  const mStyle = useGrowWidth(mp);
  const sStyle = useGrowWidth(100 - mp);

  const animatedCost = Number(useCountUp(data.cost_usd, (v) => v.toFixed(2)));

  return (
    <>
      <section className="dhero">
        <Sprite className="dflame" mount={(h) => mountFlame(h, 5, ti.tier)} />

        <div className="dhbadges">
          <span className="dtier">
            <Sprite mount={(h) => miniFlames(h, ti.flames, ti.tier, 2)} />
            <span>{ti.name}</span>
          </span>

          <span id="dFid">
            <span className="fidwrap" tabIndex={0}>
              <span className={"badge " + (partial ? "ml" : "hi")}>
                {partial ? "Partial cost" : "Full cost"}
              </span>
              <span className={"fidtip " + (partial ? "amber" : "lime")}>
                <span className="th">{partial ? "Partial cost · main-loop only" : "Full cost · high fidelity"}</span>
                {partial ? (
                  <>
                    Only the main loop was measured — <b>subagent spend is missing</b>, so the real cost is higher.
                  </>
                ) : (
                  <>
                    Every subagent dispatch was counted — this figure is the <b>whole story</b>.
                  </>
                )}
              </span>
            </span>
            {data.data_tier && <span className="dtier-badge">{data.data_tier}</span>}
          </span>

          {isWeekend && (
            <span className="wkchip">
              <Sprite className="wkchip-ic" mount={(h) => mountIcon(h, "moon", 2)} />
              weekend run
            </span>
          )}
        </div>

        <div className="dproj">{data.project}</div>

        <div className="dmeta">
          {fmtDate(data.date)} · session #{data.id}
          {data.model_version ? <> · {prettyModelId(data.model_version)}</> : null}
          {data.reconciliation_note ? (
            <>
              {" "}
              <span title={data.reconciliation_note} aria-label={"reconciliation note: " + data.reconciliation_note}>
                ⓘ
              </span>
            </>
          ) : null}
        </div>

        <div className="dcost">
          <Cents v={animatedCost} />
        </div>

        <div className="dsplit" style={{ maxWidth: 560 }}>
          <i className="m" style={mStyle} />
          <i className="s" style={sStyle} />
        </div>

        <div className="dsplitleg">
          <span>
            main loop <b>{usd(main)}</b>
          </span>
          <span>
            subagents <b>{sub ? usd(sub) : "—"}</b>
          </span>
          <span>
            cache <b>{pct(data.cache_pct, 1)}</b>
          </span>
        </div>

        <div className="dnote">
          <span className="est">≈</span> Costs are an estimate ·{" "}
          {partial ? "main-loop fidelity (subagent spend not counted)" : "high fidelity (subagent spend counted)"}
        </div>
      </section>

      {isWeekend && (
        <div className="weekend-banner">
          <Sprite className="wkic" mount={(h) => mountIcon(h, "moon", 4)} />
          <div>
            <b>It’s a {dayName}.</b> Oh no — you ran this on the weekend. The machine doesn’t mind a Saturday…{" "}
            <span className="wkdim">but maybe go outside? The tokens will wait.</span>
          </div>
        </div>
      )}
    </>
  );
}
