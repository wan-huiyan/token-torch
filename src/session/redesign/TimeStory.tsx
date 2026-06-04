/* ============================================================================
 * TimeStory (redesign) — "The honest time story": TWO big cells (Active · real
 * compute / Idle · you-away) + the amber "wall-clock ≠ work" caveat.
 *
 * Two cells, not three: the prototype's "Between-turn waits" cell is DROPPED.
 * wait_min is REAL and 0 for these records (not synthesized), and the data model
 * doesn't separately measure between-turn waits — so we render only what we
 * actually measure (active + idle). The honesty framing (wall-clock ≠ work; idle
 * costs nothing; the 120s you-away heuristic via method_note) is reused from
 * HonestTimeStory. Raw .dsec markup (no Section wrapper) to match the redesign.
 * ========================================================================== */
import type { SessionDetailData } from "../../types";
import { useCountUp, pct } from "../helpers";
import { mins } from "../../shared/mins";

export function TimeStory({ data }: { data: SessionDetailData }) {
  const t = data.time;
  const wc = t.wall_clock_min || 1;
  const activeText = useCountUp(t.active_min, mins);
  return (
    <section className="dsec">
      <div className="dsec-head">
        <h2>The honest time story</h2>
        <span className="ln" />
        <span className="n">wall-clock ≠ work</span>
      </div>
      <div className="timestory" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="tcell act">
          <div className="tk">Active · real compute</div>
          <div className="tv" id="tsActive">{activeText}</div>
          <div className="ts" id="tsActiveSub">{pct((t.active_min / wc) * 100, 0)} of wall-clock</div>
        </div>
        <div className="tcell idle">
          <div className="tk">Idle · you away</div>
          <div className="tv" id="tsIdle">{mins(t.idle_min)}</div>
          <div className="ts" id="tsIdleSub">{pct((t.idle_min / wc) * 100, 0)} of wall-clock · costs nothing</div>
        </div>
      </div>
      <div className="caveat amber" id="tsCaveat">
        <span className="ci">ⓘ</span>
        <div>
          <b>Wall-clock ≠ work.</b> This run spanned {mins(t.wall_clock_min)}, but only {mins(t.active_min)} (
          {pct((t.active_min / wc) * 100, 0)}) was real compute. {t.method_note}
        </div>
      </div>
    </section>
  );
}
