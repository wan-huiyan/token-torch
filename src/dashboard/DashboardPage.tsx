/* ============================================================================
 * TOKEN TORCH — all-sessions dashboard (aggregate-first).
 * Rendered entirely from one DashboardData object. Honesty behaviors (fidelity
 * split, small-N guard, reconciliation notes, time-saved zero-guard, estimate
 * framing) are first-class. The group-by toggle re-aggregates a NEUTRAL rollup
 * (never the superlative Podium copy) for week/model/effort; project keeps the
 * existing Podium. Cost panels are demoted below the session surface.
 * ========================================================================== */
import "../styles-tokens.css";
import "./dashboard.css";
import { useState } from "react";
import type { DashboardData } from "../types";
import type { GroupBy } from "./aggregate";
import { Starfield, FairyDust } from "./Ambient";
import { Topbar } from "./Topbar";
import { ArcadeTicker } from "./ArcadeTicker";
import { HeroConsole } from "./HeroConsole";
import { StatStrip } from "./StatStrip";
import { GroupByToggle } from "./GroupByToggle";
import { GroupRollup } from "./GroupRollup";
import { Podium } from "./Podium";
import { PlanBar } from "./PlanBar";
import { TimelineChart } from "./TimelineChart";
import { SessionTable } from "./SessionTable";
import { Distributions } from "./Distributions";
import { ContextOverhead } from "./ContextOverhead";
import { BillingWindows } from "./BillingWindows";
import { Recommendations } from "./Recommendations";
import { Footer } from "./Footer";

export function DashboardPage({
  data,
  onOpenSession,
}: {
  data: DashboardData;
  onOpenSession: (id: string) => void;
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>("project");

  return (
    <div className="tt-dash">
      <Starfield />
      <FairyDust />
      <main className="wrap">
        <Topbar meta={data.meta} />
        <ArcadeTicker data={data} />
        {/* HeroConsole's right column IS the dashboard-level honest time-story (D1) — lead with it. */}
        <section className="sec" style={{ marginTop: 8 }}>
          <HeroConsole data={data} />
          <StatStrip data={data} />
        </section>

        <PlanBar data={data} />

        {/* group-by toggle controls the aggregate surface below */}
        <div className="gb-row">
          <GroupByToggle value={groupBy} onChange={setGroupBy} />
        </div>
        {groupBy === "project" ? <Podium data={data} /> : <GroupRollup data={data} by={groupBy} />}

        <SessionTable data={data} onOpenSession={onOpenSession} />
        <TimelineChart data={data} />

        {/* cost/distribution panels demoted to supporting cast (decision #2) */}
        <Distributions data={data} />
        <ContextOverhead data={data} />
        <BillingWindows data={data} />
        <Recommendations data={data} />
        <Footer meta={data.meta} />
      </main>
    </div>
  );
}
