/* ============================================================================
 * SessionPage — per-session drill-down (redesign). Recreates 01-session-detail.html
 * pixel-perfectly in React, rendered entirely from one SessionDetailData. The rich
 * time/money/shipped panels bind to REAL Phase-0 fields (timeline_segments, turns,
 * tool_time, active_breakdown, by_category, subagents_per_dispatch, shipped) and
 * honest-degrade where a field is absent (≈6% time panels, 67% shipped). Routing
 * (the "◂ all sessions" link) is owned by the host via onBack().
 * ========================================================================== */
import type { SessionDetailData } from "../types";
import { Ambient } from "./Ambient";
import { Sprite } from "../dashboard/Sprite";
import { mountMascot } from "../dashboard/spriteEngine";
import { SessionHero } from "./redesign/SessionHero";
import { TimeStory } from "./redesign/TimeStory";
import { WhereTimeWent } from "./redesign/WhereTimeWent";
import { WhereMoneyWent } from "./redesign/WhereMoneyWent";
import { WhatShipped } from "./redesign/WhatShipped";
import { Takeaway } from "./redesign/Takeaway";
import "./redesign.css";

export function SessionPage({ data, onBack }: { data: SessionDetailData; onBack: () => void }) {
  return (
    <>
      <Ambient />
      <div className="wrap">
        <div className="dtop">
          <button type="button" className="back" onClick={onBack}>
            ◂ all sessions
          </button>
          <div className="dbrand">
            <Sprite className="mk" mount={(h) => mountMascot(h, 3)} title="hi! i'm torch" />
            <div>
              <b>TOKEN TORCH</b>
              <small>session drill-down</small>
            </div>
          </div>
        </div>

        <SessionHero data={data} />
        <TimeStory data={data} />
        <WhereTimeWent data={data} />
        <WhereMoneyWent data={data} />
        <WhatShipped data={data} />
        <Takeaway data={data} />

        <footer>
          <div>
            Session cost, active/idle minutes, cache % and token counts are <b>measured values</b>; per-turn timings and
            phase segments are <b>derived from the transcript</b> by walking the event timeline. Costs are an{" "}
            <b>estimate</b> from public per-model pricing — the Anthropic billing dashboard is authoritative.
          </div>
          <div>
            SESSION <b>#{data.id}</b> · SCHEMA <b>tracker-1.0</b>
          </div>
        </footer>
      </div>
    </>
  );
}
