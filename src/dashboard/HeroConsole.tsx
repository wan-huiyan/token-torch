import type { DashboardData } from "../types";
import { num, usd, pct, tokAbbr, splitMoney, useCountUp, useGrow } from "./helpers";
import { PixelSprite } from "./PixelSprite";
import { FLM, FLM_PAL, COIN, COIN_PAL, MOON, MOON_PAL, BOLT, BOLT_PAL } from "./sprites";
import { RisingCoins } from "./RisingCoins";

/** Count-up <span>; renders the final formatted value first, then animates. */
function Num({ end, fmt }: { end: number; fmt: (v: number) => string }) {
  const text = useCountUp(end, fmt);
  return <span>{text}</span>;
}

/** Width that renders at its target immediately (JSX truth) but grows 0→target
 *  on mount when motion is allowed, via a setTimeout-guaranteed transition. */
function growStyle(targetPct: number, grown: boolean): React.CSSProperties {
  return {
    width: grown ? `${targetPct}%` : "0%",
    transition: "width 1.1s cubic-bezier(.2,.7,.2,1)",
  };
}

export function HeroConsole({ data }: { data: DashboardData }) {
  const t = data.totals;
  const f = t.cost_by_fidelity;
  const total = f.high + f.main_loop;
  const hiPct = total ? (f.high / total) * 100 : 0;
  const mlPct = total ? (f.main_loop / total) * 100 : 0;

  const actMin = t.active_minutes;
  const idleMin = t.idle_minutes;
  const span = actMin + idleMin;
  const aPct = span ? (actMin / span) * 100 : 0;
  const iPct = span ? (idleMin / span) * 100 : 0;

  // Headline = COMPLETE spend (displayed + floored usage-bearing). The per-session
  // list / projects / fidelity bar stay about the displayed (cost_usd) sessions.
  const completeSpend = t.complete_spend_usd ?? t.cost_usd;
  const flooredUsd = t.floored_usd ?? 0;
  const hasFloored = flooredUsd > 0;
  const shortSessions = data.meta.floor?.dropped_with_usage ?? 0;
  const { dollars, cents } = splitMoney(completeSpend);

  const tk = t.tokens;
  const inTot = tk.input_fresh + tk.cache_read;
  const freshP = inTot ? (tk.input_fresh / inTot) * 100 : 0;
  const cacheP = inTot ? (tk.cache_read / inTot) * 100 : 0;
  const totTok = inTot + tk.output;

  // Honesty: time_saved_min may be 0 (generator can't measure it yet) — show a
  // graceful "not yet measured" state, NOT "0h saved".
  const timeSavedMeasured = t.time_saved_min > 0;
  // …and it's a lower bound when some subagent sessions' transcripts weren't found
  // (the generator emits a coverage flag in that case) → present as "≥", not a bare figure.
  const timeSavedLowerBound = data.flags.some(
    (fl) => fl.metric === "coverage" && /time.?saved/i.test(fl.title),
  );

  const grown = useGrow();

  return (
    <section className="hero">
      <div style={{ position: "relative" }}>
        {/* pixel flame flickers top-right; coins rise & fade (money burning) */}
        <PixelSprite frames={FLM} pal={FLM_PAL} scale={4} className="flame-cv" mode={{ kind: "cycle", intervalMs: 120 }} />
        <RisingCoins frames={[COIN]} pal={COIN_PAL} />

        <div className="kicker">Total burned · all sessions</div>
        <div className="bignum">
          <span className="cur">$</span>
          <Num end={dollars} fmt={(v) => num(Math.round(v), 0)} />
          <span className="cents">.{cents}</span>
        </div>
        <div className="burned-cap">
          {hasFloored ? (
            <>
              <b>{usd(completeSpend)}</b> total spend · <b>{usd(t.cost_usd)}</b> across{" "}
              <b>{t.sessions} listed sessions</b> + <b>{usd(flooredUsd)}</b> from{" "}
              <b>{shortSessions} short sessions</b> (shown in aggregate only)
              <br />
              <b>{data.meta.project_count} projects</b> · <b>{usd(t.cost_per_active_min)}</b>/active-min ·{" "}
              <span style={{ color: "var(--ink-faint)" }}>on a plan, so $ is just FYI</span>
            </>
          ) : (
            <>
              across <b>{t.sessions} sessions</b> · <b>{data.meta.project_count} projects</b> ·{" "}
              <b>{usd(t.cost_per_active_min)}</b>/active-min ·{" "}
              <span style={{ color: "var(--ink-faint)" }}>on a plan, so $ is just FYI</span>
            </>
          )}
        </div>

        {/* confidence split bar — HIGH vs MAIN-LOOP (hatched amber) */}
        <div className="conf">
          <div className="conf-bar">
            <div className="hi" style={growStyle(hiPct, grown)} />
            <div className="ml" style={growStyle(mlPct, grown)} />
          </div>
          <div className="conf-leg">
            <span>
              <i className="dot cy" /> HIGH {usd(f.high)} · {pct(hiPct, 0)}
            </span>
            <span>
              <i className="dot am" /> MAIN-LOOP ONLY {usd(f.main_loop)} · {pct(mlPct, 0)}
            </span>
          </div>
        </div>

        {/* tokens this cycle (folded into the hero, as the prototype renders it) */}
        <div className="htok">
          <div className="htok-top">
            <span className="kicker">Tokens this cycle</span>
            <span className="htok-big">
              <Num end={totTok} fmt={tokAbbr} />
            </span>
          </div>
          <div className="conf-bar">
            <div className="fresh" style={growStyle(Math.max(freshP, 0.8), grown)} />
            <div className="cacheb" style={growStyle(cacheP, grown)} />
          </div>
          <div className="conf-leg">
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
          <div className="v">
            <Num end={t.active_hours} fmt={(v) => num(v, 1)} />h
          </div>
          <div className="lab">
            real compute
            <small>{num(actMin, 0)} active minutes</small>
          </div>
        </div>
        <div className="cstat idle">
          <div className="v" style={{ position: "relative" }}>
            <Num end={t.idle_hours} fmt={(v) => num(v, 1)} />h
            {/* sleepy moon + floating Zzz */}
            <PixelSprite frames={[MOON]} pal={MOON_PAL} scale={3} className="moon-cv" />
            <span className="zzz" style={{ left: "10px", top: "-2px", fontSize: "0.62rem", animationDelay: "0s" }}>z</span>
            <span className="zzz" style={{ left: "10px", top: "-2px", fontSize: "0.76rem", animationDelay: "0.95s" }}>z</span>
            <span className="zzz" style={{ left: "10px", top: "-2px", fontSize: "0.9rem", animationDelay: "1.9s" }}>z</span>
          </div>
          <div className="lab">
            me being away / asleep
            <small>{num(idleMin, 0)} idle minutes</small>
          </div>
        </div>
        <div className="ratio">
          <div className="a" style={growStyle(aPct, grown)} />
          <div className="i" style={growStyle(iPct, grown)} />
        </div>
        <div className="ratio-note">
          Only <b style={{ color: "var(--lime)" }}>{pct(aPct, 0)}</b> of the clock was real compute — long gaps are
          human-away, not burn.
        </div>

        {/* ⚡ time-saved chip — honest "not yet measured" when 0 */}
        {timeSavedMeasured ? (
          <div className="saved">
            <span className="sic" aria-hidden="true">
              <PixelSprite frames={[BOLT]} pal={BOLT_PAL} scale={2} />
            </span>
            <div>
              <b>
                {timeSavedLowerBound ? "≥ " : ""}
                <Num end={t.time_saved_hours} fmt={(v) => num(v, 1)} />h saved
              </b>{" "}
              — {t.subagent_dispatches} subagents ran in parallel, not one-by-one.
              <small>
                {timeSavedLowerBound
                  ? "lower bound — some subagent transcripts weren't found (see flags)"
                  : "serially, that work would've added hours of wall-clock"}
              </small>
            </div>
          </div>
        ) : (
          <div className="saved unmeasured">
            <span className="sic" aria-hidden="true">
              <PixelSprite frames={[BOLT]} pal={BOLT_PAL} scale={2} />
            </span>
            <div>
              <b style={{ color: "var(--ink-dim)" }}>— time saved not yet measured</b> — {t.subagent_dispatches}{" "}
              subagents ran in parallel, but wall-clock savings aren't captured yet.
              <small>the generator can't measure parallel time-savings for this window</small>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
