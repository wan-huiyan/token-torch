/* ============================================================================
 * TOKEN TORCH — dashboard shell (redesign). Tabbed "Mission Control" console:
 * a kept-top region (topbar · ticker · hero · stat strip · podium · window
 * control) + 5 tabs. All windowed sections re-derive from <WindowProvider>.
 * Sections live in ./redesign/* and are composed here.
 * ========================================================================== */
import { useEffect, useState } from "react";
import type { DashboardData } from "../types";
import { fmtStamp } from "./helpers";
import { Starfield, FairyDust } from "./Ambient";
import { WindowProvider, useWindow } from "./useWindow";
import { Topbar } from "./redesign/Topbar";
import { Ticker } from "./redesign/Ticker";
import { Hero } from "./redesign/Hero";
import { StatStrip } from "./redesign/StatStrip";
import { Podium } from "./redesign/Podium";
import { AwardsPanel } from "./redesign/AwardsPanel";
import { WindowControl } from "./redesign/WindowControl";
import { SessionsTab } from "./redesign/SessionsTab";
import { TimelineTab } from "./redesign/TimelineTab";
import { DistributionsTab } from "./redesign/DistributionsTab";
import { ModelEffortTab } from "./redesign/ModelEffortTab";
import { RecsTab } from "./redesign/RecsTab";
import { TourOverlay } from "./TourOverlay";
import "./redesign.css";

export type DashTab = "sessions" | "timeline" | "distributions" | "breakdown" | "recs";
const TABS: { id: DashTab; label: string }[] = [
  { id: "sessions", label: "Sessions" },
  { id: "timeline", label: "Timeline" },
  { id: "distributions", label: "Distributions" },
  { id: "breakdown", label: "Model & effort" },
  { id: "recs", label: "Recommendations" },
];

export function DashboardPage({
  data,
  onOpenSession,
  initialTab = "sessions",
}: {
  data: DashboardData;
  onOpenSession: (id: string) => void;
  initialTab?: DashTab;
}) {
  return (
    <WindowProvider data={data}>
      <Starfield />
      <FairyDust />
      <Shell data={data} onOpenSession={onOpenSession} initialTab={initialTab} />
    </WindowProvider>
  );
}

function Shell({ data, onOpenSession, initialTab }: { data: DashboardData; onOpenSession: (id: string) => void; initialTab: DashTab }) {
  const [tab, setTab] = useState<DashTab>(initialTab);
  // Sync when the route changes initialTab without a remount (e.g. #/ → #/breakdown
  // via back/forward or in-app hashchange) — useState only honors its arg on mount.
  useEffect(() => setTab(initialTab), [initialTab]);
  const { sessions } = useWindow();

  return (
    <div className="wrap">
      <Topbar data={data} />
      <Ticker data={data} />
      <Hero data={data} />
      <StatStrip data={data} />
      <Podium data={data} />
      <AwardsPanel />
      <WindowControl data={data} />

      <nav className="tabbar" role="tablist" aria-label="dashboard views">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "on" : ""}
            data-tour={t.id === "breakdown" ? "breakdown-link" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "sessions" && <span className="cnt">{sessions.length}</span>}
          </button>
        ))}
      </nav>

      <div className="panel-wrap">
        {tab === "sessions" && <SessionsTab data={data} onOpenSession={onOpenSession} />}
        {tab === "timeline" && <TimelineTab />}
        {tab === "distributions" && <DistributionsTab data={data} />}
        {tab === "breakdown" && <ModelEffortTab data={data} />}
        {tab === "recs" && <RecsTab data={data} />}
      </div>

      <footer>
        <div className="fnote">
          Session cost, active/idle minutes, cache % and token counts are <b>measured</b>; a few within-session splits are
          estimates. Costs are an <b>estimate</b> from public per-model pricing — the Anthropic billing dashboard is
          authoritative. {data.meta.fidelity_note}
        </div>
        <div>
          SCHEMA <b>{data.meta.schema_version}</b> · GENERATED <b>{fmtStamp(data.meta.generated_at)}</b>
        </div>
      </footer>

      <TourOverlay />
    </div>
  );
}
