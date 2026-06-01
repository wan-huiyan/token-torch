/* ============================================================================
 * HonestTimeStory — 3 big cells (Active compute / Idle you-away / Between-turn
 * waits) + the "wall-clock ≠ work" caveat banner. Leads the time story with the
 * honesty framing required by the README (idle costs nothing; gaps >120s are the
 * you-away heuristic, surfaced via time.method_note).
 * ========================================================================== */
import type { SessionDetailData } from "../types";
import { mins, pct } from "./helpers";
import { Section } from "./Section";

export function HonestTimeStory({ data }: { data: SessionDetailData }) {
  const t = data.time;
  const wc = t.wall_clock_min || 1;
  return (
    <Section title="The honest time story" n={`wall-clock ${mins(t.wall_clock_min)}`}>
      <div className="honest">
        <div className="active">
          <div className="k">Active · real compute</div>
          <div className="v">{mins(t.active_min)}</div>
          <div className="s">{pct((t.active_min / wc) * 100, 0)} of wall-clock</div>
        </div>
        <div className="idle">
          <div className="k">Idle · you away</div>
          <div className="v">{mins(t.idle_min)}</div>
          <div className="s">{pct((t.idle_min / wc) * 100, 0)} of wall-clock · no cost</div>
        </div>
        <div className="wait">
          <div className="k">Between-turn waits</div>
          <div className="v">{mins(t.wait_min)}</div>
          <div className="s">short pauses · {pct((t.wait_min / wc) * 100, 0)}</div>
        </div>
      </div>
      <div className="caveat">
        <div className="ci">ⓘ</div>
        <div className="ct">
          <b>Wall-clock ≠ work.</b> This run spanned {mins(t.wall_clock_min)}, but only {mins(t.active_min)} (
          {pct((t.active_min / wc) * 100, 0)}) was compute. {t.method_note}
        </div>
      </div>
    </Section>
  );
}
