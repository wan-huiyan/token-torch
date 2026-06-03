import { useState } from "react";
import "../styles-tokens.css";
import "./dashboard.css";
import type { DashboardData } from "../types";
import { breakdownGroups, type BreakdownGroup, type GroupBy } from "./aggregate";
import { num, usd, pct, tokAbbr, fmtDate, useGrowWidth } from "./helpers";
import { Section } from "./Section";
import { GroupByToggle } from "./GroupByToggle";
import { ConfoundBanner } from "./ConfoundBanner";
import { CostHeatmap } from "./CostHeatmap";

/* ============================================================================
 * TOKEN TORCH — BreakdownPage (Plan 5 T6, at #/breakdown).
 * A DESCRIPTIVE breakdown by project / week / model version / effort. It is
 * NEVER a ranking or comparison (L7): the ConfoundBanner is the first content
 * element, cards carry no rank number / medal / arrow, and small-n groups are
 * tagged "illustrative" and don't emphasize per-session rates. Cost is tagged
 * an estimate. The CostHeatmap sits at the bottom.
 * ========================================================================== */

const EFFORT_SRC_LABEL: Record<string, string> = {
  observed: "observed",
  inferred_default: "inferred",
  unknown: "unknown",
};

/** A neutral metric bar. Its own component so `useGrowWidth` (a hook) is called
 *  exactly once per instance — never inside a parent .map() body (Rules of Hooks). */
function MetricBar({ label, value, frac, tag }: { label: string; value: string; frac: number; tag?: string }) {
  const w = Math.max(0, Math.min(1, frac)) * 100;
  return (
    <div className="bd-metric">
      <div className="bd-metric-head">
        <span className="bd-metric-label">{label}</span>
        <span className="bd-metric-val">
          {value}
          {tag && <span className="bd-est"> {tag}</span>}
        </span>
      </div>
      <div className="bd-metric-bar">
        <i style={useGrowWidth(w, { background: "var(--cyan)" })} />
      </div>
    </div>
  );
}

/** One breakdown card — its own component so each MetricBar's hook is valid and
 *  the per-card layout stays isolated across re-aggregation. Renders NO rank
 *  number / medal / arrow; cost-desc order from breakdownGroups is presentational only. */
function BreakdownCard({ g, max }: { g: BreakdownGroup; max: Record<string, number> }) {
  const effortMix = Object.entries(g.effort_mix).sort((a, b) => b[1] - a[1]);
  return (
    <div className={`bd-card${g.small_n ? " bd-illus" : ""}`}>
      <div className="bd-card-head">
        <span className="bd-card-label">{g.label}</span>
        <span className="bd-card-meta">
          {num(g.sessions)} session{g.sessions === 1 ? "" : "s"} · {fmtDate(g.date_from)}–{fmtDate(g.date_to)}
        </span>
        {g.small_n && <span className="bd-illus-tag">illustrative — n&lt;10, not significant</span>}
      </div>

      <div className="bd-context">
        <span className="bd-ctx">
          <b>top projects</b>{" "}
          {g.top_projects.length
            ? g.top_projects.map((p) => `${p.name} (${p.sessions})`).join(" · ")
            : "—"}
        </span>
        <span className="bd-ctx">
          <b>effort source</b>{" "}
          {effortMix.length
            ? effortMix.map(([src, n]) => `${EFFORT_SRC_LABEL[src] ?? src} ${n}`).join(" · ")
            : "—"}
        </span>
      </div>

      {/* Neutral metric figures. For small-n groups we DON'T emphasize per-session
          rates — we show absolute totals + cache% only (no rate framing). */}
      {g.small_n ? (
        <div className="bd-metrics">
          <MetricBar label="output tokens (total)" value={tokAbbr(g.out_tokens)} frac={g.out_tokens / max.out_total} />
          <MetricBar label="cache" value={pct(g.avg_cache_pct, 0)} frac={g.avg_cache_pct / 100} />
          <MetricBar label="active min (total)" value={num(g.active_min)} frac={g.active_min / max.active_total} />
          <MetricBar label="cost" value={usd(g.cost_usd, false)} frac={g.cost_usd / max.cost} tag="[estimate]" />
        </div>
      ) : (
        <div className="bd-metrics">
          <MetricBar
            label="output tokens / session"
            value={tokAbbr(g.out_tokens_per_session)}
            frac={g.out_tokens_per_session / max.out_per}
          />
          <MetricBar label="cache" value={pct(g.avg_cache_pct, 0)} frac={g.avg_cache_pct / 100} />
          <MetricBar
            label="tool calls / session"
            value={num(g.tool_calls_per_session, 1)}
            frac={g.tool_calls_per_session / max.tools_per}
          />
          <MetricBar
            label="active min / session"
            value={num(Math.round(g.active_min / (g.sessions || 1)))}
            frac={g.active_min / (g.sessions || 1) / max.active_per}
          />
          <MetricBar
            label="time saved"
            value={g.time_saved_min > 0 ? `${num(g.time_saved_min)} min` : "—"}
            frac={g.time_saved_min / max.saved}
          />
          <MetricBar label="cost" value={usd(g.cost_usd, false)} frac={g.cost_usd / max.cost} tag="[estimate]" />
        </div>
      )}
    </div>
  );
}

export function BreakdownPage({ data, onBack }: { data: DashboardData; onBack: () => void }) {
  const [by, setBy] = useState<GroupBy>("model");
  const { groups, excludedMixed } = breakdownGroups(data.sessions, by);

  // Per-metric maxima for bar normalization (avoid div-by-0 with a floor of 1).
  const max = {
    cost: Math.max(1, ...groups.map((g) => g.cost_usd)),
    out_per: Math.max(1, ...groups.map((g) => g.out_tokens_per_session)),
    out_total: Math.max(1, ...groups.map((g) => g.out_tokens)),
    tools_per: Math.max(1, ...groups.map((g) => g.tool_calls_per_session)),
    active_per: Math.max(1, ...groups.map((g) => g.active_min / (g.sessions || 1))),
    active_total: Math.max(1, ...groups.map((g) => g.active_min)),
    saved: Math.max(1, ...groups.map((g) => g.time_saved_min)),
  };

  return (
    <div className="tt-dash">
      <main className="wrap">
        <button className="bd-back nt-kicker" onClick={onBack}>
          ← dashboard
        </button>

        {/* ConfoundBanner is the FIRST content element — validity before any numbers. */}
        <ConfoundBanner by={by} />

        <div className="gb-row">
          <GroupByToggle value={by} onChange={setBy} />
        </div>

        {by === "model" && excludedMixed > 0 && (
          <div className="bd-excluded">
            {num(excludedMixed)} mixed-version session{excludedMixed === 1 ? "" : "s"} excluded from this
            grouping (they span more than one model version).
          </div>
        )}

        <Section title="Breakdown" n="descriptive · not a ranking">
          <div className="bd-cards">
            {groups.map((g) => (
              <BreakdownCard key={g.key} g={g} max={max} />
            ))}
          </div>
        </Section>

        <CostHeatmap data={data} />
      </main>
    </div>
  );
}
