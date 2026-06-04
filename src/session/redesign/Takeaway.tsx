/* ============================================================================
 * Takeaway (redesign) — one bold pull-quote tying time + money honesty
 * together, in the gradient box from 01-session-detail.html line 139 (#takeaway)
 * + detail.js takeaway()/celebratory part. Copy is built ENTIRELY from the
 * session record: wall-clock vs active compute, and the cache-read token↔cost
 * "flip" when by_category is present. Degrades gracefully when a field is
 * absent (never prints "undefined%"). The bobbing mascot + confetti are
 * reduced-motion gated inside the sprite engine (confettiAround early-returns
 * a no-op under prefers-reduced-motion). Visuals only from the prototype;
 * every number here is a measured/estimated value from `data`.
 * ========================================================================== */
import type { SessionDetailData } from "../../types";
import { Sprite } from "../../dashboard/Sprite";
import { mountMascot, confettiAround } from "../../dashboard/spriteEngine";
import { pct } from "../helpers";
import { mins } from "../../shared/mins";

export function Takeaway({ data }: { data: SessionDetailData }) {
  const t = data.time;
  const read = data.cost.by_category?.cache_read;
  // active share of wall-clock — guard divide-by-zero (degrade: omit the %).
  const activeShare = t.wall_clock_min > 0 ? (t.active_min / t.wall_clock_min) * 100 : null;

  return (
    <div className="takeaway" id="takeaway" style={{ position: "relative" }}>
      <div className="tk">Takeaway · session {data.id}</div>
      This run spanned <b className="cy">{mins(t.wall_clock_min)}</b>
      {activeShare != null ? (
        <>
          {" "}
          but only <b className="li">{mins(t.active_min)}</b> ({pct(activeShare, 0)}) was real compute
        </>
      ) : (
        <>
          {" "}
          but only <b className="li">{mins(t.active_min)}</b> was real compute
        </>
      )}
      {read ? (
        <>
          . Cache hits ran at <b className="cy">{pct(data.tokens.cache_hit_pct, 0)}</b>, so cache reads
          were <b className="mg">{pct(read.cost_pct, 0)}</b> of the bill despite being most of the tokens.
          Cheap tokens, real money.
        </>
      ) : (
        <>
          . Cache hits ran at <b className="cy">{pct(data.tokens.cache_hit_pct, 0)}</b> — wall-clock is
          not work, idle time costs nothing.
        </>
      )}
      <Sprite
        className="takebot"
        title="nice run!"
        mount={(h) => {
          const stopMascot = mountMascot(h, 3);
          const stopConfetti = confettiAround(h.parentElement ?? h, {
            kinds: ["star", "coin", "star"],
            every: 1100,
          });
          return () => {
            stopMascot();
            stopConfetti();
          };
        }}
      />
    </div>
  );
}
