/* ============================================================================
 * Takeaway — one bold pull-quote tying time + money honesty together. The copy
 * is built from the data (wall-clock vs active; cache-read token/cost flip when
 * by_category is present). Mirrors the prototype takeaway().
 * ========================================================================== */
import type { SessionDetailData } from "../types";
import { mins, pct } from "./helpers";

export function Takeaway({ data }: { data: SessionDetailData }) {
  const t = data.time;
  const read = data.cost.by_category?.cache_read;
  return (
    <section className="sec">
      <div className="takeaway">
        <div className="q">
          This run looked like <b>{mins(t.wall_clock_min)}</b>, but the machine worked <b>{mins(t.active_min)}</b>
          {read ? (
            <>
              {" "}
              — and of the bill, <em>{pct(read.tok_pct, read.tok_pct < 2 ? 1 : 0)} of tokens were cache reads</em>{" "}
              costing {pct(read.cost_pct, 0)} of the spend. Cheap tokens, real money.
            </>
          ) : (
            <>. Wall-clock is not work — idle time costs nothing.</>
          )}
        </div>
        <div className="by">Takeaway · session {data.id}</div>
      </div>
    </section>
  );
}
