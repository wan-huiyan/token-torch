/* ============================================================================
 * SessionPage — per-session detail drill-down. Recreates the canonical prototype
 * "sessions/67948bdb.html" in React. Renders entirely from a SessionDetailData
 * object; the "← all sessions" topbar link calls onBack() (routing is owned by
 * the host, not this screen). Two graceful-degradation states are baked in and
 * tested with both fixtures:
 *   - timeline_segments empty → hide ribbon / tool-leaderboard / pulse; keep the
 *     active/idle headline (+ active split only if a breakdown phase is nonzero).
 *   - cost.by_category absent → hide inversion + waterfall + savings; show total
 *     + a "per-category breakdown not captured" note.
 * Motion: count-ups + bars/donuts write their final value first (background-tab /
 * reduced-motion safe); ambient loops + falling coins + flame respect
 * prefers-reduced-motion.
 * ========================================================================== */
import type { SessionDetailData } from "../types";
import "../styles-tokens.css";
import "./session.css";

import { Ambient } from "./Ambient";
import { Header } from "./Header";
import { HonestTimeStory } from "./HonestTimeStory";
import { Section } from "./Section";
import { TimeRibbon } from "./TimeRibbon";
import { ActiveSplitDonut, hasActiveBreakdown } from "./ActiveSplitDonut";
import { ToolLeaderboard } from "./ToolLeaderboard";
import { TurnPulse } from "./TurnPulse";
import { MoneyInversion } from "./MoneyInversion";
import { CostWaterfall } from "./CostWaterfall";
import { CacheSavings } from "./CacheSavings";
import { EffectiveRateChips } from "./EffectiveRateChips";
import { SubagentDonut } from "./SubagentDonut";
import { Shipped } from "./Shipped";
import { Takeaway } from "./Takeaway";
import { PixelSprite } from "./PixelSprite";
import { BOT_BLINK, BOT_OPEN, BOT_PAL } from "./sprites";
import { fmtStamp, usd } from "./helpers";

function Topbar({ onBack }: { onBack: () => void }) {
  return (
    <header className="topbar">
      <button type="button" className="back" onClick={onBack}>
        ← all sessions
      </button>
      <div className="brand">
        <PixelSprite
          frames={[BOT_OPEN, BOT_BLINK]}
          pal={BOT_PAL}
          scale={3}
          className="mascot"
          title="hi! i'm torch"
          mode={{ kind: "clickBlinkLoop", minMs: 2000, jitterMs: 2600 }}
        />
        <div>
          <div className="bn">TOKEN&nbsp;TORCH</div>
          <div className="bs">session drill-down</div>
        </div>
      </div>
    </header>
  );
}

function TimeSection({ data }: { data: SessionDetailData }) {
  const seg = data.timeline_segments;
  // Degradation: no timeline → hide ribbon/leaderboard/pulse; keep active split
  // ONLY if a breakdown phase is nonzero (empty conic-gradient is invalid CSS).
  if (!seg || !seg.length) {
    const showSplit = hasActiveBreakdown(data);
    return (
      <Section title="Where the time went" n="active vs idle">
        <div className="panel" style={{ padding: 30, textAlign: "center" }}>
          <div style={{ fontFamily: "var(--mono)", color: "var(--ink-dim)" }}>
            Detailed timeline not captured for this session.
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: ".74rem", color: "var(--ink-faint)", marginTop: 8 }}>
            Only the coarse active/idle split above is available for this record.
          </div>
        </div>
        {showSplit && (
          <div className="sec" style={{ marginTop: 16 }}>
            <div className="panel">
              <ActiveSplitDonut data={data} />
            </div>
          </div>
        )}
      </Section>
    );
  }

  return (
    <Section title="Where the time went" n="wall-clock anatomy">
      <div className="panel ribbon-wrap">
        <TimeRibbon data={data} />
      </div>
      <div className="tgrid" style={{ marginTop: 16 }}>
        <div className="panel">
          <ActiveSplitDonut data={data} />
        </div>
        <div className="panel">
          <ToolLeaderboard data={data} />
        </div>
      </div>
      <div className="panel pulse" style={{ marginTop: 16 }}>
        <TurnPulse data={data} />
      </div>
    </Section>
  );
}

function MoneySection({ data }: { data: SessionDetailData }) {
  const c = data.cost;
  // Degradation: no by_category → hide inversion + waterfall + savings.
  if (!c.by_category) {
    return (
      <Section title="Where the money went" n="estimate">
        <div className="panel" style={{ padding: 26 }}>
          <div className="bignum" style={{ fontSize: "2.4rem" }}>
            {usd(c.total_usd)}
          </div>
          <div className="note" style={{ marginTop: 14 }}>
            Per-category breakdown not captured for this session — only the grand total was stored.
          </div>
          <SubagentDonut data={data} />
          <div className="foot-note">{c.pricing_basis}</div>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Where the money went" n="tokens ≠ bill">
      <div className="panel">
        <MoneyInversion data={data} />
      </div>
      <div className="panel wf" style={{ marginTop: 16 }}>
        <CostWaterfall data={data} />
      </div>
      <div className="mgrid" style={{ marginTop: 16 }}>
        <CacheSavings data={data} />
        <EffectiveRateChips data={data} />
      </div>
      <SubagentDonut data={data} />
      <div className="foot-note">{c.pricing_basis}</div>
    </Section>
  );
}

function Footer() {
  return (
    <footer>
      Session cost, active/idle minutes, cache % and token counts are <b>real measured values</b>; the per-turn and
      segment arrays here are a representative sample of the full record. Costs are an estimate — the Anthropic billing
      dashboard is authoritative.
      <br />
      GENERATED <b>{fmtStamp(new Date().toISOString())}</b> · SCHEMA <b>tracker-1.0</b>
    </footer>
  );
}

export function SessionPage({ data, onBack }: { data: SessionDetailData; onBack: () => void }) {
  return (
    <div className="tt-session">
      <Ambient />
      <div className="wrap">
        <Topbar onBack={onBack} />
        <Header data={data} />
        <HonestTimeStory data={data} />
        <TimeSection data={data} />
        <MoneySection data={data} />
        <Shipped data={data} />
        <Takeaway data={data} />
        <Footer />
      </div>
    </div>
  );
}
