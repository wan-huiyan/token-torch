/* ============================================================================
 * TOKEN TORCH redesign — Hero. Recreates 00-dashboard.html <section class="hero">
 * + renderHero(). Two columns: LEFT = burn $ + confidence split + token mix;
 * RIGHT = where the time went (active vs idle) + parallel time saved.
 *
 * Honesty spine (mined from HeroConsole): headline = complete_spend (incl.
 * floored short sessions) when all-sessions; the confidence split (HIGH vs
 * main-loop-only) is the centerpiece; <Est/> on the hero $; the time-saved chip
 * degrades to an honest "no measurable parallel time saved" when 0; the token
 * mix is corpus-wide ONLY (fresh/cache aren't per-session) and is labelled
 * "all-time token mix" when a window is selected so we never fake a split.
 * ========================================================================== */
import type { DashboardData } from "../../types";
import { num, usd, pct, tokAbbr, useCountUp, useGrowWidth } from "../helpers";
import { useWindow } from "../useWindow";
import { Sprite } from "../Sprite";
import { mountFlame, mountIcon, mountCoinBurst } from "../spriteEngine";
import { Est } from "./ui";

const share = (part: number, whole: number): number => (whole ? (part / whole) * 100 : 0);

export function Hero({ data }: { data: DashboardData }) {
  const { isAll, agg } = useWindow();
  const t = data.totals;

  /* --- headline $: all → complete_spend (incl. floored); windowed → agg.cost --- */
  const completeSpend = t.complete_spend_usd ?? t.cost_usd;
  const headline = isAll ? completeSpend : agg.cost;
  const flooredUsd = t.floored_usd ?? 0;
  const shortSessions = data.meta.floor?.dropped_with_usage ?? 0;
  const showFloored = isAll && flooredUsd > 0;

  // count-up the integer dollars; cur/cents are static spans (centsSpan style).
  const dollarsInt = Math.floor(headline);
  const cents = Math.round((headline - dollarsInt) * 100).toString().padStart(2, "0");
  const bigDollars = useCountUp(dollarsInt, (v) => num(Math.round(v), 0));

  /* --- confidence split: HIGH vs main-loop-only (subagents not counted) --- */
  const hi = isAll ? t.cost_by_fidelity.high : agg.hi;
  const ml = isAll ? t.cost_by_fidelity.main_loop : agg.ml;
  const confTot = hi + ml;
  const hiPct = share(hi, confTot);
  const mlPct = confTot ? 100 - hiPct : 0; // complementary → exactly 100
  const hiStyle = useGrowWidth(hiPct);
  const mlStyle = useGrowWidth(mlPct);

  /* --- token mix: ALWAYS corpus-wide (fresh/cache aren't per-session). --- */
  const tk = t.tokens;
  const totTok = tk.total ?? tk.input_fresh + tk.cache_read + tk.output;
  const freshP = share(tk.input_fresh, totTok);
  const cacheP = share(tk.cache_read, totTok);
  const outP = share(tk.output, totTok);
  const freshStyle = useGrowWidth(freshP);
  const cacheStyle = useGrowWidth(cacheP);
  const outStyle = useGrowWidth(outP);

  /* --- right column: where the time went (hours) --- */
  const actHrs = isAll ? t.active_hours : agg.active / 60;
  const idleHrs = isAll ? t.idle_hours : agg.idle / 60;
  const actMin = isAll ? t.active_minutes : agg.active;
  const idleMin = isAll ? t.idle_minutes : agg.idle;
  const timeSpan = actMin + idleMin;
  const aPct = share(actMin, timeSpan);
  const iPct = timeSpan ? 100 - aPct : 0;
  const actBig = useCountUp(actHrs, (v) => num(v, 1));
  const idleBig = useCountUp(idleHrs, (v) => num(v, 1));
  const aStyle = useGrowWidth(aPct);
  const iStyle = useGrowWidth(iPct);

  /* --- parallel time saved (honest zero-guard) --- */
  const savedMin = isAll ? t.time_saved_min : agg.saved;
  const savedHrs = isAll ? t.time_saved_hours : agg.saved / 60;
  const subs = isAll ? t.subagent_dispatches : agg.subs;
  const savedMeasured = savedMin > 0;

  return (
    <section className="hero">
      <div style={{ position: "relative" }}>
        {/* pixel flame flickers; coins rise & fade (money burning) — RM-gated in-engine */}
        <Sprite mount={(h) => mountFlame(h, 5, "inferno")} className="flame-cv" />
        <div id="heroCoins" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <Sprite mount={mountCoinBurst} />
        </div>

        <div className="kicker">Total burned · {isAll ? "all sessions" : "selected window"}</div>
        <div className="bignum">
          <span className="cur">$</span>
          {bigDollars}
          <span className="cents">.{cents}</span>
        </div>
        <div className="burned-cap" data-tour="cost-est">
          <Est /> <a href="#/about" className="estlink">how?</a> · on a plan, so $ is just FYI
          {showFloored && (
            <>
              {" "}· incl. <b>{num(shortSessions)}</b> short sessions rolled into the total (≈{usd(flooredUsd)})
            </>
          )}
        </div>

        {/* confidence split bar — the headline honesty feature */}
        <div className="conf" data-tour="coverage-flag">
          <div className="conf-k">How much of this spend is fully measured?</div>
          <div className="conf-bar">
            <i className="hi" style={hiStyle} />
            <i className="ml" style={mlStyle} />
          </div>
          <div className="conf-leg">
            <span>
              <i className="dot cy" /> Fully counted · {usd(hi)} · {pct(hiPct, 0)}
            </span>
            <span>
              <i className="dot am" /> Subagents not counted · {usd(ml)} · {pct(mlPct, 0)}
            </span>
          </div>
          <div className="conf-note">
            Striped/partial sessions count main-loop spend only — subagent cost isn't attributed.
          </div>
        </div>

        {/* token mix — corpus-wide; relabelled when a window is active */}
        <div className="htok">
          <div className="htok-top">
            <span className="htok-k">{isAll ? "Tokens this cycle" : "all-time token mix"}</span>
            <span className="htok-big">{tokAbbr(totTok)}</span>
          </div>
          <div className="tbar">
            <i className="fresh" style={freshStyle} />
            <i className="cache" style={cacheStyle} />
            <i className="out" style={outStyle} />
          </div>
          <div className="ttleg">
            <span>
              <i className="dot am" /> fresh {tokAbbr(tk.input_fresh)} · {pct(freshP, 1)}
            </span>
            <span>
              <i className="dot cy" /> cache {tokAbbr(tk.cache_read)} · {pct(cacheP, 1)}
            </span>
            <span>
              <i className="dot li" /> output {tokAbbr(tk.output)}
            </span>
          </div>
        </div>
      </div>

      {/* Right: where the time went — active (lime) vs idle (magenta) */}
      <div className="contrast">
        <div className="kicker">Where the time went</div>
        <div className="cstat act">
          <div className="v">{actBig}h</div>
          <div className="lab">
            real compute<small>{num(Math.round(actMin))} active minutes</small>
          </div>
        </div>
        <div className="cstat idle">
          <div className="v" style={{ position: "relative" }}>
            {idleBig}h
            <Sprite mount={(h) => mountIcon(h, "moon", 3)} className="moon-cv" />
            <span className="zzz" style={{ left: "130px", top: "-2px" }}>z</span>
            <span className="zzz" style={{ left: "150px", top: "-10px", animationDelay: ".8s" }}>z</span>
          </div>
          <div className="lab">
            me being away / asleep<small>{num(Math.round(idleMin))} idle minutes</small>
          </div>
        </div>
        <div className="ratio">
          <i className="a" style={aStyle} />
          <i className="i" style={iStyle} />
        </div>
        <div className="ratio-note">
          Only <b>{pct(aPct, 0)}</b> of the clock was real compute — the rest is you away or asleep (costs nothing).
        </div>

        <div className="saved" data-tour="time-saved">
          <span className="sic" aria-hidden="true">
            <Sprite mount={(h) => mountIcon(h, "bolt", 2)} />
          </span>
          {savedMeasured ? (
            <div>
              <b>{num(savedHrs, 1)}h saved</b> — {num(subs)} subagents ran in parallel
              <small>serially, that work would've added hours of wall-clock</small>
            </div>
          ) : (
            <div>
              <b>no measurable parallel time saved</b> — {num(subs)} subagents ran, but wall-clock savings aren't captured for this window
              <small>the generator can't measure parallel time-savings here</small>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
