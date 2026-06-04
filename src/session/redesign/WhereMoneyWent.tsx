/* ============================================================================
 * WhereMoneyWent — the "tokens ≠ bill" money story (redesign).
 * Recreates 01-session-detail.html lines 89–131 + detail.js renderMoney/coinFall,
 * pixel-faithful to the PROTOTYPE class vocabulary (.invbar/.track, .invconnect,
 * .flipcards/.flip, .wfbar/.wfrow, .savings, .chips, .subpanel/.subbody/.subtot/
 * .subrow/.fam-nest, .pricing) but bound to REAL SessionDetailData fields — the
 * prototype's seeded byCat / savings / premium / blended / dispatch labels are
 * FAKE and are NOT used.
 *
 * Honesty spine:
 *  - every $ carries an ≈estimate framing; the inversion IS the honesty story.
 *  - savings/premium come from REAL cost.cache_savings_usd / cache_write_premium_usd
 *    (never recomputed with guessed rates); "would've cost" = saved + cache_read.usd.
 *  - per-dispatch cost is REAL (subagents_per_dispatch[].usd); label = what ?? id.
 *  - content is visible at rest; coin-fall + family sprites are reduced-motion gated.
 *
 * Degradation:
 *  - cost.by_category absent → hide inversion + waterfall + savings + chips; show
 *    total_usd + "per-category breakdown not captured" + the subagent donut + pricing.
 *  - cost.subagent_usd === 0 → "no subagents this run" note, donut hidden (an empty
 *    donut is invalid).
 * ========================================================================== */
import { useEffect, useRef } from "react";
import type { SessionDetailData, CostCategory, CostCategoryDetail } from "../../types";
import { abbr, num, pct, usd, useCountUp, usePrefersReducedMotion } from "../helpers";
import { Sprite } from "../../dashboard/Sprite";
import { mountMascot, spriteCanvas, sprites, PAL, type SpriteCanvas } from "../../dashboard/spriteEngine";

/* ---- category palette + labels + segment classes (prototype renderMoney) ---- */
const CAT_ORDER: CostCategory[] = ["cache_read", "cache_write", "output", "fresh_input"];
const SEG_CLASS: Record<CostCategory, string> = {
  cache_read: "seg-cread",
  cache_write: "seg-cwrite",
  output: "seg-out",
  fresh_input: "seg-fresh",
};
const CAT_VAR: Record<CostCategory, string> = {
  cache_read: "--cyan",
  cache_write: "--magenta",
  output: "--lime",
  fresh_input: "--amber",
};
const CAT_NAME: Record<CostCategory, string> = {
  cache_read: "cache read",
  cache_write: "cache write",
  output: "output",
  fresh_input: "fresh input",
};

/* ---- SVG donut (prototype donut(): rings + .dctr center) ---- */
function Donut({
  segments,
  size,
  thick,
  centerValue,
  centerLabel,
}: {
  segments: { value: number; color: string }[];
  size: number;
  thick: number;
  centerValue: string;
  centerLabel: string;
}) {
  const r = (size - thick) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((t, s) => t + s.value, 0) || 1;
  let off = 0;
  const rings = segments.map((s, i) => {
    const len = (s.value / total) * circ;
    const dash = `${len} ${circ - len}`;
    const rot = (off / total) * 360 - 90;
    off += s.value;
    return (
      <circle
        key={i}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={s.color}
        strokeWidth={thick}
        strokeDasharray={dash}
        transform={`rotate(${rot} ${cx} ${cy})`}
      />
    );
  });
  return (
    <div className="donut" role="img" aria-label={`${centerLabel}: ${centerValue}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {rings}
      </svg>
      <div className="dctr">
        <div className="dv">{centerValue}</div>
        <div className="dl">{centerLabel}</div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * CoinFall — coins FALL from the token bar into the money bar (#invConnect).
 * FOUNDATION GAP: spriteEngine.mountCoinBurst rises (money burning) and there is
 * no falling variant; we implement the fall locally (no foundation edit) using
 * the public spriteCanvas + sprites.COIN + PAL.coin, mirroring detail.js coinFall.
 * Reduced-motion gated; bounded spawner; full cleanup on unmount.
 * -------------------------------------------------------------------------- */
function mountCoinFall(host: HTMLElement): () => void {
  let live = true;
  const iv = window.setInterval(() => {
    if (!live || document.hidden || host.childElementCount > 6) return;
    const c = spriteCanvas([sprites.COIN], PAL.coin, 2) as SpriteCanvas;
    c.className = "coinfall";
    c.style.left = 8 + Math.random() * 84 + "%";
    c.style.top = "-4px";
    c.style.opacity = "0";
    host.appendChild(c);
    const drift = (Math.random() * 40 - 20).toFixed(0);
    const done = () => c.remove();
    c.animate(
      [
        { transform: "translateY(-6px) rotate(0)", opacity: 0 },
        { opacity: 1, offset: 0.25 },
        { transform: `translateY(58px) rotate(${drift}deg)`, opacity: 0 },
      ],
      { duration: 1300 + Math.random() * 500, easing: "ease-in" },
    ).onfinish = done;
    window.setTimeout(done, 2000);
  }, 640);
  return () => {
    live = false;
    window.clearInterval(iv);
  };
}

/* ---- inversion connector ribbons (token-share → flipped money-share) ---- */
function InvConnect({ bc }: { bc: Record<CostCategory, CostCategoryDetail> }) {
  const reduced = usePrefersReducedMotion();
  const coinRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = coinRef.current;
    if (!host || reduced) return;
    return mountCoinFall(host);
  }, [reduced]);

  const H = 60;
  let tAcc = 0;
  let mAcc = 0;
  const bands = CAT_ORDER.flatMap((k) => {
    const tw = bc[k].tok_pct;
    const mw = bc[k].cost_pct;
    const t0 = tAcc;
    const t1 = tAcc + tw;
    tAcc = t1;
    const m0 = mAcc;
    const m1 = mAcc + mw;
    mAcc = m1;
    const my = H / 2;
    const d =
      `M${t0.toFixed(2)},0 C${t0.toFixed(2)},${my} ${m0.toFixed(2)},${my} ${m0.toFixed(2)},${H} ` +
      `L${m1.toFixed(2)},${H} C${m1.toFixed(2)},${my} ${t1.toFixed(2)},${my} ${t1.toFixed(2)},0 Z`;
    return [
      <path key={`${k}-f`} d={d} fill={`var(${CAT_VAR[k]})`} opacity={0.32} />,
      <path key={`${k}-s`} d={d} fill="none" stroke={`var(${CAT_VAR[k]})`} strokeWidth={0.4} opacity={0.6} />,
    ];
  });

  return (
    <div className="invconnect">
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block", overflow: "visible" }}>
        {bands}
      </svg>
      <div ref={coinRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true" />
    </div>
  );
}

/* ---- two stacked share-bars (tokens by tok_pct / money by cost_pct) ---- */
function InvBar({
  bc,
  share,
  money,
}: {
  bc: Record<CostCategory, CostCategoryDetail>;
  share: "tok_pct" | "cost_pct";
  money?: boolean;
}) {
  return (
    <div className={"invbar" + (money ? " moneybar" : "")}>
      <div className="il">
        <span>{money ? "Money" : "Tokens"}</span>
        <span>{money ? "by share of cost" : "by share of count"}</span>
      </div>
      <div className="track" role="img" aria-label={money ? "cost share by category" : "token share by category"}>
        {CAT_ORDER.map((k) => {
          const w = bc[k][share];
          if (w < 0.3) return null;
          return (
            <i key={k} className={SEG_CLASS[k]} style={{ width: `${w.toFixed(2)}%` }}>
              {w > 8 ? `${Math.round(w)}%` : ""}
            </i>
          );
        })}
      </div>
    </div>
  );
}

export function WhereMoneyWent({ data }: { data: SessionDetailData }) {
  const c = data.cost;
  const bc = c.by_category;
  const dispatches = [...c.subagents_per_dispatch].sort((a, b) => b.usd - a.usd);
  const helpers = dispatches.length;
  const babies = Math.min(helpers, 10);

  // count-up heroes (hooks: top-level, unconditional)
  const wfTotal = useCountUp(c.total_usd, (v) => usd(v, false));
  const saveBig = useCountUp(c.cache_savings_usd, (v) => "~" + usd(v, false));

  return (
    <section className="dsec">
      <div className="dsec-head">
        <h2>Where the money went</h2>
        <span className="ln" />
        <span className="n">tokens ≠ bill</span>
      </div>

      {bc ? (
        <>
          {/* ---- the great inversion ---- */}
          <div className="panel">
            <p className="invhead">
              Almost every <b className="cy">token</b> is a nearly-free <b className="cy">cache read</b> — but the{" "}
              <b>bill</b> is mostly <b className="li">output</b> &amp; <b className="mg">cache writes</b>. Same run,
              flipped.
            </p>
            <InvBar bc={bc} share="tok_pct" />
            <InvConnect bc={bc} />
            <InvBar bc={bc} share="cost_pct" money />
            <div className="flipcards">
              {CAT_ORDER.map((k) => (
                <div className="flip" key={k}>
                  <div className="fh">
                    <i className={SEG_CLASS[k]} />
                    {CAT_NAME[k]}
                    <span className="flip-q">?</span>
                  </div>
                  <div className="fb">
                    <span className="up">{pct(bc[k].tok_pct, 1)}</span> of tokens ·{" "}
                    <span className="dn">{pct(bc[k].cost_pct, 0)}</span> of cost
                    <br />
                    <b>{usd(bc[k].rate_per_mtok)}/M</b> · {abbr(bc[k].tokens)} tok
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ---- cost waterfall (nested .dsec so its CSS applies) ---- */}
          <div className="dsec">
            <div className="dsec-head">
              <h2 style={{ fontSize: ".7rem" }}>Cost waterfall</h2>
              <span className="ln" />
              <span className="n">
                = <b style={{ color: "var(--cyan)" }}>{wfTotal}</b>
              </span>
            </div>
            <div className="panel">
              <div className="wfbar" role="img" aria-label="cost breakdown by category">
                {[...CAT_ORDER]
                  .sort((a, b) => bc[b].usd - bc[a].usd)
                  .map((k) => (
                    <i key={k} className={SEG_CLASS[k]} style={{ width: `${bc[k].cost_pct.toFixed(2)}%` }} />
                  ))}
              </div>
              <div>
                {[...CAT_ORDER]
                  .sort((a, b) => bc[b].usd - bc[a].usd)
                  .map((k) => (
                    <div className="wfrow" key={k}>
                      <span className="wd" style={{ background: `var(${CAT_VAR[k]})` }} />
                      <span className="wl">{CAT_NAME[k]}</span>
                      <span className="wt">
                        {abbr(bc[k].tokens)} tok · {usd(bc[k].rate_per_mtok)}/M
                      </span>
                      <span className="wv">{usd(bc[k].usd)}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* ---- savings + chips ---- */}
          <div className="moneygrid">
            <div className="savings">
              <div className="sk">Prompt caching saved</div>
              <div className="sv">{saveBig}</div>
              <p>
                Those {abbr(data.tokens.cache_read)} cache-read tokens would've cost{" "}
                <b>{usd(c.cache_savings_usd + bc.cache_read.usd, false)}</b> at the fresh-input rate. You paid{" "}
                <b>{usd(bc.cache_read.usd)}</b>.
              </p>
              <small>Small print: a ~{usd(c.cache_write_premium_usd)} cache-write premium is the price of those savings.</small>
            </div>
            <div className="chips">
              <div className="chip">
                <div className="ck">Blended rate · all-in</div>
                <div className="cv" style={{ color: "var(--cyan)" }}>
                  {usd(c.blended_per_mtok_usd)}
                  <span style={{ fontSize: ".5em", color: "var(--ink-faint)" }}> /M</span>
                </div>
                <div className="cs">
                  {abbr(data.tokens.total)} tokens · {usd(c.total_usd)}
                </div>
              </div>
              <div className="chip">
                <div className="ck">Cache hit</div>
                <div className="cv" style={{ color: "var(--lime)" }}>
                  {pct(data.tokens.cache_hit_pct, 1)}
                </div>
                <div className="cs">share of input served from cache</div>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* ---- degrade: no per-category breakdown ---- */
        <div className="panel">
          <div className="degrade">
            <h3>{usd(c.total_usd)}</h3>
            <p>
              Per-category breakdown not captured for this session — the token↔money inversion, cost waterfall and
              caching-savings need the per-category token/cost split, which isn't in this record. The total above and
              the main-loop / subagent split below are <b>measured</b>.
            </p>
          </div>
        </div>
      )}

      {/* ---- main loop vs subagents (subpanel is display:none in CSS → force block) ---- */}
      <div className="subpanel" style={{ display: "block" }}>
        <div className="subhead">Main loop vs subagents</div>
        {c.subagent_usd > 0 ? (
          <div className="subbody">
            <div className="subdonut-cell">
              <Sprite className="fam-mom-perch" mount={(h) => mountMascot(h, 3)} />
              <Donut
                segments={[
                  { value: c.main_loop_usd, color: "var(--cyan)" },
                  { value: c.subagent_usd, color: "var(--magenta)" },
                ]}
                size={150}
                thick={22}
                centerValue={pct((c.subagent_usd / (c.total_usd || 1)) * 100, 1)}
                centerLabel="to subagents"
              />
              <div className="fam-nest" aria-hidden="true">
                {Array.from({ length: babies }, (_, i) => (
                  <Sprite key={i} className="fam-baby" mount={(h) => mountMascot(h, 2)} />
                ))}
              </div>
              <div className="fam-cap">
                {babies === 1 ? (
                  <>
                    <b>1</b> helper dispatched
                  </>
                ) : (
                  <>
                    <b>{babies}</b> helpers dispatched
                    {helpers > 10 ? <span style={{ opacity: 0.6 }}> (of {helpers})</span> : null}
                  </>
                )}
              </div>
            </div>
            <div className="sublist">
              <div className="subtot">
                <div className="str">
                  <span className="sk">
                    <i style={{ background: "var(--cyan)", boxShadow: "0 0 8px var(--cyan)" }} />
                    main loop
                  </span>
                  <b>{usd(c.main_loop_usd)}</b>
                </div>
                <div className="str">
                  <span className="sk">
                    <i style={{ background: "var(--magenta)", boxShadow: "0 0 8px var(--magenta)" }} />
                    subagents · {helpers} dispatch{helpers === 1 ? "" : "es"}
                  </span>
                  <b>{usd(c.subagent_usd)}</b>
                </div>
              </div>
              <div className="subdh">top dispatches · {num((c.subagent_usd / (c.total_usd || 1)) * 100, 0)}% of bill</div>
              {dispatches.slice(0, 6).map((d) => {
                const maxSub = dispatches[0]?.usd || 1;
                return (
                  <div className="subrow" key={d.id}>
                    <span className="sl" title={d.what || d.id}>
                      {d.what?.trim() || d.id}
                    </span>
                    <span className="sbar">
                      <i style={{ width: `${((d.usd / maxSub) * 100).toFixed(0)}%` }} />
                    </span>
                    <span className="sv">{usd(d.usd)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ fontFamily: "var(--mono)", fontSize: ".84rem", color: "var(--ink-faint)", padding: "4px 0" }}>
            No subagent fan-out on this run — the whole bill was the main loop.
          </div>
        )}
      </div>

      {/* ---- pricing footnote (REAL cost.pricing_basis) ---- */}
      <div className="pricing">{c.pricing_basis}</div>
    </section>
  );
}
