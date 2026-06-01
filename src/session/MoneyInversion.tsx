/* ============================================================================
 * MoneyInversion — "the great inversion". Two stacked HORIZONTAL bars (TOKENS
 * over MONEY) with the same 4 categories/colours, so each colour's width visibly
 * flips between the two. A connector band (SVG quads) between the bars
 * dramatizes the shift; pixel coins fall from tokens into money. A plain-language
 * headline + 4 flip-cards ("cache read · 97% of tokens ↓ 67% of cost · $1.50/M").
 * Mirrors the prototype inversion() + its conncoins decorate() loop.
 * ========================================================================== */
import type { SessionDetailData } from "../types";
import { abbr, pct, usd, usePrefersReducedMotion } from "./helpers";
import { PixelSprite } from "./PixelSprite";
import { COIN, COIN_PAL } from "./sprites";
import { CATCOL, CATLAB, CAT_ORDER } from "./categories";

export function MoneyInversion({ data }: { data: SessionDetailData }) {
  const bc = data.cost.by_category!;
  const reduced = usePrefersReducedMotion();

  const bar = (key: "tok_pct" | "cost_pct") =>
    CAT_ORDER.map((k) => {
      const v = bc[k][key];
      return (
        <div className="ib" key={k} style={{ flex: `${v} 0 0`, background: CATCOL[k] }}>
          <span>{v >= 7 ? pct(v, v < 2 ? 1 : 0) : ""}</span>
        </div>
      );
    });

  // connector quads: token band → money band per category
  let tc = 0;
  let cc = 0;
  const flows = CAT_ORDER.map((k) => {
    const tl = tc;
    const trr = tc + bc[k].tok_pct;
    const cl = cc;
    const cr = cc + bc[k].cost_pct;
    tc += bc[k].tok_pct;
    cc += bc[k].cost_pct;
    return (
      <path
        key={k}
        className="flow"
        d={`M${tl.toFixed(1)} 0 L${trr.toFixed(1)} 0 L${cr.toFixed(1)} 70 L${cl.toFixed(1)} 70 Z`}
        fill={CATCOL[k]}
      />
    );
  });

  // falling-coin lanes: midpoint between token-center and money-center per category
  let tc2 = 0;
  let cc2 = 0;
  const lanes = CAT_ORDER.map((k, i) => {
    const a = tc2 + bc[k].tok_pct / 2;
    const b = cc2 + bc[k].cost_pct / 2;
    tc2 += bc[k].tok_pct;
    cc2 += bc[k].cost_pct;
    return { mx: (a + b) / 2, n: i === 0 ? 4 : 1 };
  });

  return (
    <div className="inv2">
      <div className="inv2-head">
        Almost every <b>token</b> is a nearly-free <span className="cy">cache read</span> — but the <b>bill</b> is
        mostly <span className="li">output</span> &amp; <span className="mg">cache writes</span>.{" "}
        <em>Same run, flipped.</em>
      </div>
      <div className="inv2-row">
        <div className="inv2-lab">
          TOKENS<small>{abbr(data.tokens.total)}</small>
        </div>
        <div className="inv2-bar" role="img" aria-label="token share by category">
          {bar("tok_pct")}
        </div>
      </div>
      <div className="inv2-conn">
        <svg viewBox="0 0 100 70" preserveAspectRatio="none">
          {flows}
        </svg>
        <div className="conncoins">
          {!reduced &&
            lanes.flatMap((lane, i) =>
              Array.from({ length: lane.n }, (_, j) => (
                <span
                  key={`${i}-${j}`}
                  className="coinfall"
                  style={{
                    left: `calc(${lane.mx.toFixed(1)}% - 4px)`,
                    animation: `tt-coinfall ${(2.0 + Math.random() * 0.9).toFixed(1)}s linear ${(
                      i * 0.35 +
                      j * 0.6
                    ).toFixed(1)}s infinite`,
                  }}
                >
                  <PixelSprite frames={[COIN]} pal={COIN_PAL} scale={2} />
                </span>
              ))
            )}
        </div>
      </div>
      <div className="inv2-row">
        <div className="inv2-lab money">
          MONEY<small>{usd(data.cost.total_usd)}</small>
        </div>
        <div className="inv2-bar" role="img" aria-label="cost share by category">
          {bar("cost_pct")}
        </div>
      </div>
      <div className="inv2-cards">
        {CAT_ORDER.map((k) => (
          <div className="fcard" key={k} style={{ "--cc": CATCOL[k] } as React.CSSProperties}>
            <div className="fct">
              <i />
              {CATLAB[k]}
            </div>
            <div className="fcf">
              <b>{pct(bc[k].tok_pct, bc[k].tok_pct < 2 ? 1 : 0)}</b> of tokens <span className="far">↓</span>{" "}
              <b>{pct(bc[k].cost_pct, bc[k].cost_pct < 2 ? 1 : 0)}</b> of cost
            </div>
            <div className="fcr">
              {usd(bc[k].rate_per_mtok)}/M tok · {usd(bc[k].usd)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
