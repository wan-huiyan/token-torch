/* ============================================================================
 * TOKEN TORCH — all-sessions dashboard
 * A React + TypeScript recreation of "Burn Rate Dashboard.html", rendered
 * entirely from one DashboardData object. Honesty behaviors (fidelity split,
 * small-N guard, reconciliation notes, active-vs-idle lead, time-saved
 * zero-guard, estimate framing) are first-class features, not footnotes.
 * ========================================================================== */
import "../styles-tokens.css";
import "./dashboard.css";
import type { DashboardData } from "../types";
import { Starfield, FairyDust } from "./Ambient";
import { Topbar } from "./Topbar";
import { ArcadeTicker } from "./ArcadeTicker";
import { HeroConsole } from "./HeroConsole";
import { StatStrip } from "./StatStrip";
import { Podium } from "./Podium";
import { TimelineChart } from "./TimelineChart";
import { SessionCards } from "./SessionCards";
import { Distributions } from "./Distributions";
import { Recommendations } from "./Recommendations";
import { Footer } from "./Footer";

export function DashboardPage({
  data,
  onOpenSession,
}: {
  data: DashboardData;
  onOpenSession: (id: string) => void;
}) {
  return (
    <div className="tt-dash">
      <Starfield />
      <FairyDust />
      <main className="wrap">
        <Topbar meta={data.meta} />
        <ArcadeTicker data={data} />
        <section className="sec" style={{ marginTop: 8 }}>
          <HeroConsole data={data} />
          <StatStrip data={data} />
        </section>
        <Podium data={data} />
        <TimelineChart data={data} />
        <SessionCards data={data} onOpenSession={onOpenSession} />
        <Distributions data={data} />
        <Recommendations data={data} />
        <Footer meta={data.meta} />
      </main>
    </div>
  );
}
