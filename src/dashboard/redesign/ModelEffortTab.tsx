/* ============================================================================
 * TOKEN TORCH redesign — Model & effort tab (the old #/breakdown folds in here).
 * Three blocks IN ORDER, recreating 00-dashboard.html lines 165-201 +
 * dashboard.js renderBreakdown/renderHeatmap/renderModelMix:
 *   1) Confound banner FIRST (.confound) — breakdown ≠ comparison, verbatim copy.
 *   2) Model × effort heatmap (.heat)     — 5-metric toggle, REAL axes from the
 *      window, OKLCH per-metric-hue quantile shading (technique mined from
 *      CostHeatmap: quantile rank→scale, empty "·", small-n disclosure, floor),
 *      hot-cell flame + hover tooltip, "· estimate" on $-metrics.
 *   3) Cost breakdown grouped (.sec)      — Model version / Effort toggle only,
 *      cost-mix bar + .bkgroup cards (5 relative stat bars), effortBot decor.
 *
 * Honesty spine: confound first; model versions time-disjoint; REAL effort enum
 * (low/medium/high/xhigh/max/ultracode — NEVER the prototype's invented "team"
 * column); stable modelColor per version; quantile (not raw) shading so one big
 * cell can't saturate; empty cells are an explicit "·" (not α=0 = "cheap");
 * small-n muted; <Est>/[estimate] on cost; content visible at rest; no emoji.
 *
 * Aggregation is over useWindow().sessions (the WINDOWED subset) — the `data`
 * prop is only the contract. The heatmap pool mirrors CostHeatmap: real model
 * ids, non-mixed sessions, so neither axis is contaminated. Block 3 gets that
 * for free — breakdownGroups already excludes mixed for the model dim + carries
 * per-group context.
 * ========================================================================== */
import { Fragment, useMemo, useState } from "react";
import type { DashboardData, SessionRow } from "../../types";
import { useWindow } from "../useWindow";
import { breakdownGroups, bucketOf, isMixedVersion, type GroupBy } from "../aggregate";
import { modelColor, effortMeta } from "../../shared/modelColors";
import { prettyModelId, isRealModelId } from "../../shared/models";
import { mountFlame, mountEffortBot } from "../spriteEngine";
import { Sprite } from "../Sprite";
import { usd, num, pct, tokAbbr, fmtDate, useGrowWidth } from "../helpers";
import { mins as fmtMin } from "../../shared/mins";
import { SecHead, Est } from "./ui";

const SMALL_N = 10; // mirrors aggregate.SMALL_N — illustrative, not significant

/* ---------------------------------------------------------------------------
 * Effort → accent color. FOUNDATION GAP: effortMeta gives label+botKind but no
 * color, and the prototype's EFFORT_COLORS is keyed on the *label* "ultra-high"
 * (not the real value "xhigh"), so it'd never match. Local map keyed on REAL
 * enum values. modelColor covers the model dim.
 * ------------------------------------------------------------------------- */
const EFFORT_COLOR: Record<string, string> = {
  low: "var(--ink-dim)",
  medium: "var(--cyan)",
  high: "var(--lime)",
  xhigh: "var(--amber)",
  max: "oklch(0.6 0.19 300)",
  ultracode: "var(--magenta)",
};
const effortColor = (v: string): string => EFFORT_COLOR[v] ?? "var(--lime)";

/** Canonical effort display order; values present-in-window are filtered against it. */
const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max", "ultracode"];

type HeatMetric = "cost" | "cpm" | "active" | "sessions" | "output";

/* ===========================================================================
 * BLOCK 1 — Confound banner (.confound). Static, verbatim copy from the
 * prototype lines 166-173. Non-negotiably the first element. (The standalone
 * dashboard/ConfoundBanner.tsx — same semantics, different markup — was deleted
 * in #42 as a dead orphan; this inline Confound is the live one.)
 * ========================================================================= */
function Confound() {
  return (
    <div className="confound" role="note" aria-label="validity warning">
      <span className="ci">Read this first</span>
      <div>
        <div className="ct">These groups are a breakdown, not a comparison.</div>
        <p>
          These groups differ in <b>date-span and task mix</b> and were <b>not</b> run as a
          controlled experiment. Read this as a description of what each group <i>did</i> —{" "}
          <b>not</b> a performance ranking. For a real model comparison you'd need a controlled A/B,
          not usage logs.
        </p>
        <p className="mono">
          Model-version groups are time-disjoint — each version was the only one running during its
          own window. Differences reflect <b>when</b> the work happened, not how the models perform.
        </p>
      </div>
    </div>
  );
}

/* ===========================================================================
 * BLOCK 2 — Model × effort heatmap (.heat).
 * ========================================================================= */
interface CellAgg {
  cost: number;
  n: number;
  active: number;
  out: number;
  subs: number;
  cacheSum: number;
  projs: Record<string, number>;
}

const HEAT_HUE: Record<HeatMetric, number> = { cost: 350, cpm: 210, active: 135, sessions: 270, output: 320 };
const HEAT_LABEL: Record<HeatMetric, string> = {
  cost: "total cost · estimate",
  cpm: "$ per active-minute · estimate",
  active: "total active compute",
  sessions: "session count",
  output: "output tokens",
};

const metricVal = (m: HeatMetric, c: CellAgg): number =>
  m === "cost" ? c.cost : m === "cpm" ? (c.active ? c.cost / c.active : 0) : m === "active" ? c.active : m === "sessions" ? c.n : c.out;
const metricFmt = (m: HeatMetric, v: number): string =>
  m === "cost" ? usd(v, false) : m === "cpm" ? "$" + v.toFixed(2) : m === "active" ? fmtMin(v) : m === "sessions" ? num(v) : tokAbbr(v);

/** One populated heat cell. Hot cell mounts a flame; every cell gets a hover
 *  tooltip with the FULL metric breakdown + run count (prototype tipHTML). */
function HeatCell({
  model,
  effort,
  cell,
  metric,
  hue,
  quant,
  hot,
  setTip,
}: {
  model: string;
  effort: string;
  cell: CellAgg | undefined;
  metric: HeatMetric;
  hue: number;
  quant: (v: number) => number;
  hot: boolean;
  setTip: (t: { html: string; x: number; y: number } | null) => void;
}) {
  if (!cell) {
    return (
      <div className="hc empty" aria-label={`${prettyModelId(model)} × ${effortMeta(effort).label}: no sessions`}>
        ·
      </div>
    );
  }
  const v = metricVal(metric, cell);
  const q = quant(v);
  const bg = `oklch(${(0.3 + q * 0.34).toFixed(3)} ${(0.05 + q * 0.16).toFixed(3)} ${hue})`;
  const border = `oklch(0.83 0.15 ${hue} / ${(0.28 + q * 0.5).toFixed(2)})`;
  const smallN = cell.n < SMALL_N;

  const tipHtml = () => {
    const cpm = cell.active ? cell.cost / cell.active : 0;
    const ps = Object.entries(cell.projs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, vv]) => `${k} (${vv})`)
      .join(" · ");
    return (
      `<b style="color:${modelColor(model)}">${prettyModelId(model)}</b> × <b>${effortMeta(effort).label}</b>` +
      `<br><span class="hr"></span>${cell.n} runs · <b>${usd(cell.cost, false)}</b> <span class="est">estimate</span>` +
      `<br>$${cpm.toFixed(2)}/active-min · ${fmtMin(cell.active)} active` +
      `<br>${tokAbbr(cell.out)} output · ${Math.round(cell.cacheSum / cell.n)}% cache · ${cell.subs} subagents` +
      (ps ? `<br><span style="color:var(--ink-faint)">top: ${ps}</span>` : "")
    );
  };

  return (
    <div
      className={"hc" + (hot ? " hot" : "")}
      style={{ background: bg, borderColor: border, ["--hot" as string]: `oklch(0.86 0.18 ${hue})`, cursor: "help" }}
      aria-label={`${prettyModelId(model)} × ${effortMeta(effort).label}: ${metricFmt(metric, v)}${metric === "cost" || metric === "cpm" ? " (estimate)" : ""}, ${cell.n} runs${smallN ? " (small sample)" : ""}`}
      onMouseMove={(e) => setTip({ html: tipHtml(), x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setTip(null)}
    >
      {hot && (
        <Sprite className="hotflame" mount={(host) => mountFlame(host, 2, "inferno")} aria-label="highest cell" />
      )}
      <div className="hv">{metricFmt(metric, v)}</div>
      {metric !== "sessions" && (
        <div className="hn">
          {cell.n} runs{smallN ? " · n<10" : ""}
        </div>
      )}
    </div>
  );
}

function Heatmap({ sessions }: { sessions: SessionRow[] }) {
  const [metric, setMetric] = useState<HeatMetric>("cost");
  const [tip, setTip] = useState<{ html: string; x: number; y: number } | null>(null);

  const { models, efforts, cells } = useMemo(() => {
    // Pool mirrors CostHeatmap: real model ids, non-mixed sessions only.
    const pool = sessions.filter((s) => s.model_version != null && isRealModelId(s.model_version) && !isMixedVersion(s));
    const modelKeys: string[] = [];
    const presentEffort = new Set<string>();
    const cells = new Map<string, CellAgg>();
    for (const s of pool) {
      const mv = s.model_version as string;
      const ev = s.effort?.value ?? "unknown";
      if (!modelKeys.includes(mv)) modelKeys.push(mv);
      presentEffort.add(ev);
      const k = `${mv}|${ev}`;
      const c = cells.get(k) ?? { cost: 0, n: 0, active: 0, out: 0, subs: 0, cacheSum: 0, projs: {} };
      c.cost += s.cost_usd;
      c.n += 1;
      c.active += s.active_min;
      c.out += s.out_tokens ?? 0;
      c.subs += s.subagents;
      c.cacheSum += s.cache_pct;
      c.projs[s.project] = (c.projs[s.project] ?? 0) + 1;
      cells.set(k, c);
    }
    // Stable axes: models by total spend desc; efforts by canonical enum order.
    const modelSpend = (m: string) => [...presentEffort].reduce((t, e) => t + (cells.get(`${m}|${e}`)?.cost ?? 0), 0);
    modelKeys.sort((a, b) => modelSpend(b) - modelSpend(a));
    const efforts = EFFORT_ORDER.filter((e) => presentEffort.has(e)).concat(
      [...presentEffort].filter((e) => !EFFORT_ORDER.includes(e)), // unknown / never-seen, kept honest
    );
    return { models: modelKeys, efforts, cells };
  }, [sessions]);

  // QUANTILE coloring (technique mined from CostHeatmap): rank populated cells by
  // the chosen metric → t∈[0,1] by POSITION, so one big cell can't saturate the rest.
  const { quant, maxV } = useMemo(() => {
    const vals = [...cells.values()]
      .map((c) => metricVal(metric, c))
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const denom = Math.max(1, vals.length - 1);
    const maxV = vals.length ? vals[vals.length - 1] : 0;
    const quant = (v: number): number => {
      if (!vals.length) return 0;
      const i = vals.findIndex((x) => x >= v);
      return i < 0 ? 1 : i / denom;
    };
    return { quant, maxV };
  }, [cells, metric]);

  if (!models.length || !efforts.length) {
    return (
      <div className="heat sec" style={{ marginTop: 0 }}>
        <SecHead title="Model × effort" n="no model/effort data in this window" />
        <div className="heatwrap">
          <div className="tl-cap">No sessions in this window carry both a real model version and an effort tag.</div>
        </div>
      </div>
    );
  }

  const hue = HEAT_HUE[metric];
  const isEst = metric === "cost" || metric === "cpm";

  return (
    <div className="heat sec" style={{ marginTop: 0 }}>
      <SecHead title="Model × effort" n={HEAT_LABEL[metric]} />
      <div className="heatwrap">
        <div className="sctrl" style={{ marginBottom: 18 }}>
          <span className="ctrl-lab">metric</span>
          <div className="toggle flexwrap">
            {(
              [
                ["cost", "Total cost"],
                ["cpm", "$ / active-min"],
                ["active", "Active time"],
                ["sessions", "Sessions"],
                ["output", "Output tokens"],
              ] as [HeatMetric, string][]
            ).map(([m, lab]) => (
              <button key={m} className={metric === m ? "on" : undefined} onClick={() => setMetric(m)}>
                {lab}
              </button>
            ))}
          </div>
        </div>
        <div
          className="heatgrid"
          style={{
            gridTemplateColumns: `minmax(92px,1fr) repeat(${efforts.length},1.2fr)`,
            minWidth: 110 + efforts.length * 108,
          }}
        >
          <div className="hcorner">model × effort</div>
          {efforts.map((e) => (
            <div className="hch" key={e}>
              <Sprite className="effbot-host" mount={(host) => mountEffortBot(host, effortMeta(e).botKind, 3)} />
              <span className="effname">{effortMeta(e).label}</span>
            </div>
          ))}
          {models.map((mv) => (
            // #51-followup: Fragment (no wrapper element) so .hcr + .hc are TRUE direct
            // grid children. The previous `<div style={{display:"contents"}}>` collapses
            // the row to nothing on engines that don't promote display:contents grid items
            // (older Safari) → the whole heatmap renders empty there.
            <Fragment key={mv}>
              <div className="hcr" style={{ ["--mc" as string]: modelColor(mv) }}>
                {prettyModelId(mv)}
              </div>
              {efforts.map((e) => {
                const cell = cells.get(`${mv}|${e}`);
                const hot = !!cell && maxV > 0 && metricVal(metric, cell) === maxV;
                return (
                  <HeatCell
                    key={e}
                    model={mv}
                    effort={e}
                    cell={cell}
                    metric={metric}
                    hue={hue}
                    quant={quant}
                    hot={hot}
                    setTip={setTip}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
        <div className="tl-cap" style={{ marginTop: 16 }}>
          {isEst && (
            <>
              <Est>[estimate]</Est>{" "}
            </>
          )}
          Groups are <b style={{ color: "var(--ink-dim)" }}>time-disjoint</b> — each model version ran in its own
          window, so this describes <b style={{ color: "var(--ink-dim)" }}>what differed</b>, not which model is
          better. <b style={{ color: "var(--ink-dim)" }}>ultracode</b> only runs on opus-4.8, so its other rows are
          correctly empty (·). Hover any cell for the full breakdown; shading is relative (quantile), the flame marks
          the highest.
        </div>
      </div>
      {tip && (
        <div
          className="heat-tip"
          style={{
            opacity: 1,
            left: Math.min(tip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 258),
            top: tip.y + 16,
          }}
          dangerouslySetInnerHTML={{ __html: tip.html }}
        />
      )}
    </div>
  );
}

/* ===========================================================================
 * BLOCK 3 — Cost breakdown grouped (.sec). Model version / Effort toggle only.
 * ========================================================================= */

/** One relative stat bar inside a group card. Own component because useGrowWidth
 *  is a hook — calling it inside a parent .map() would violate rules-of-hooks
 *  and crash on window toggle (group/row count changes between renders). */
function StatBar({ label, value, frac, color }: { label: string; value: string; frac: number; color: string }) {
  const style = useGrowWidth(Math.round(Math.max(0, Math.min(1, frac)) * 100), { background: color });
  return (
    <div className="bkstat">
      <div className="bsl">{label}</div>
      <div className="bsv">{value}</div>
      <div className="bsbar">
        <i style={style} />
      </div>
    </div>
  );
}

/** One row of the cost-mix bar (#distModel). Own component for the same hook reason. */
function MixRow({ label, frac, color }: { label: string; frac: number; color: string }) {
  const style = useGrowWidth(Number((frac * 100).toFixed(1)), { background: color });
  return (
    <div className="barrow">
      <span className="bl">{label}</span>
      <span className="bt">
        <i style={style} />
      </span>
      <span className="bv">{pct(frac * 100, 0)}</span>
    </div>
  );
}

/** Cost-mix bar from the group shares (prototype renderModelMix). */
function CostMix({ by, groups }: { by: GroupBy; groups: ReturnType<typeof breakdownGroups>["groups"] }) {
  const total = groups.reduce((t, g) => t + g.cost_usd, 0) || 1;
  const rows = [...groups].sort((a, b) => b.cost_usd - a.cost_usd);
  return (
    <div className="dpanel" style={{ margin: "16px 0 18px" }}>
      <div className="mixcap">Cost mix · by {by === "model" ? "model version" : "effort"}</div>
      <div>
        {rows.map((g) => (
          <MixRow
            key={g.key}
            label={by === "model" ? g.label : effortMeta(g.key).label}
            frac={g.cost_usd / total}
            color={by === "model" ? modelColor(g.key) : effortColor(g.key)}
          />
        ))}
      </div>
    </div>
  );
}

/** One .bkgroup card. Effort groups mount an effortBot decoratively. */
function GroupCard({
  by,
  group,
  effortValueLine,
  maxOut,
  maxTools,
  maxActive,
  maxSaved,
}: {
  by: GroupBy;
  group: ReturnType<typeof breakdownGroups>["groups"][number];
  effortValueLine: string; // for the model dim: "high 600 · ultracode 13" (prototype effLine)
  maxOut: number;
  maxTools: number;
  maxActive: number;
  maxSaved: number;
}) {
  const isModel = by === "model";
  const accent = isModel ? modelColor(group.key) : effortColor(group.key);
  const name = isModel ? group.label : effortMeta(group.key).label;
  const top = group.top_projects.map((p) => `${p.name} (${p.sessions})`).join(" · ");

  return (
    <div className="bkgroup" style={{ ["--gc" as string]: accent }}>
      <div className="bkgh">
        <div className="bkleft">
          {!isModel && (
            <Sprite className="bkbot effbot-host" mount={(host) => mountEffortBot(host, effortMeta(group.key).botKind, 3)} />
          )}
          <div className="bkname">{name}</div>
        </div>
        <div className="bkcost">
          {usd(group.cost_usd, false)} <span className="est">estimate</span>
        </div>
      </div>
      <div className="bksub">
        {group.sessions} sessions · {fmtDate(group.date_from)}–{fmtDate(group.date_to)}
        {isModel ? (effortValueLine ? ` · effort: ${effortValueLine}` : "") : top ? ` · top: ${top}` : ""}
        {group.small_n ? " · n<10 illustrative" : ""}
      </div>
      <div className="bkstats">
        <StatBar label="output / session" value={tokAbbr(group.out_tokens_per_session)} frac={maxOut ? group.out_tokens_per_session / maxOut : 0} color="var(--gc)" />
        <StatBar label="cache hit" value={pct(group.avg_cache_pct, 0)} frac={group.avg_cache_pct / 100} color="var(--gc)" />
        <StatBar label="tool calls / session" value={num(group.tool_calls_per_session, 1)} frac={maxTools ? group.tool_calls_per_session / maxTools : 0} color="var(--gc)" />
        <StatBar label="active / session" value={fmtMin(group.active_min / (group.sessions || 1))} frac={maxActive ? group.active_min / (group.sessions || 1) / maxActive : 0} color="var(--gc)" />
        <StatBar label="time saved" value={fmtMin(group.time_saved_min)} frac={maxSaved ? group.time_saved_min / maxSaved : 0} color="var(--lime)" />
      </div>
    </div>
  );
}

function Breakdown({ sessions }: { sessions: SessionRow[] }) {
  const [by, setBy] = useState<GroupBy>("model");
  const { groups, excludedMixed } = useMemo(() => breakdownGroups(sessions, by), [sessions, by]);

  // For the effort dim, order cards by canonical enum; else cost-desc (already sorted).
  const ordered = useMemo(() => {
    if (by !== "effort") return groups;
    return [...groups].sort((a, b) => {
      const ia = EFFORT_ORDER.indexOf(a.key);
      const ib = EFFORT_ORDER.indexOf(b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }, [groups, by]);

  const maxOut = Math.max(0, ...groups.map((g) => g.out_tokens_per_session));
  const maxTools = Math.max(0, ...groups.map((g) => g.tool_calls_per_session));
  const maxActive = Math.max(0, ...groups.map((g) => g.active_min / (g.sessions || 1)));
  const maxSaved = Math.max(0, ...groups.map((g) => g.time_saved_min));

  // Per-group effort-VALUE mix (prototype effLine) for the model dim's .bksub.
  // breakdownGroups.effort_mix is keyed by effort.source; the prototype showed
  // value counts ("high 600 · ultracode 13"), so recompute from windowed sessions.
  const effortValueLines = useMemo(() => {
    if (by !== "model") return new Map<string, string>();
    const acc = new Map<string, Map<string, number>>();
    for (const s of sessions) {
      if (isMixedVersion(s)) continue; // excluded from the model dim, mirror breakdownGroups
      const { key } = bucketOf(s, by);
      const v = s.effort?.value ?? "unknown";
      const inner = acc.get(key) ?? new Map<string, number>();
      inner.set(v, (inner.get(v) ?? 0) + 1);
      acc.set(key, inner);
    }
    const out = new Map<string, string>();
    for (const [key, inner] of acc) {
      out.set(
        key,
        [...inner.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} ${n}`).join(" · "),
      );
    }
    return out;
  }, [sessions, by]);

  return (
    <div className="sec" style={{ marginTop: 30 }}>
      <SecHead title="Cost breakdown" n="grouped" />
      <div className="sctrl">
        <span className="ctrl-lab">group by</span>
        <div className="toggle">
          <button className={by === "model" ? "on" : undefined} onClick={() => setBy("model")}>
            Model version
          </button>
          <button className={by === "effort" ? "on" : undefined} onClick={() => setBy("effort")}>
            Effort
          </button>
        </div>
        <span className="bkexcl" style={{ marginLeft: "auto", marginBottom: 0 }}>
          {by === "model"
            ? excludedMixed > 0
              ? `${excludedMixed} mixed-version session${excludedMixed === 1 ? "" : "s"} excluded (no single dominant version).`
              : "Mixed-version sessions are excluded so no version's bucket is contaminated."
            : "Effort is partly inferred (see source tags) — a descriptive slice, not a ranking."}
        </span>
      </div>
      {groups.length === 0 ? (
        <div className="tl-cap" style={{ marginTop: 8 }}>
          No groupable sessions in this window.
        </div>
      ) : (
        <>
          <CostMix by={by} groups={ordered} />
          <div className="bkgroups">
            {ordered.map((g) => (
              <GroupCard
                key={g.key}
                by={by}
                group={g}
                effortValueLine={effortValueLines.get(g.key) ?? ""}
                maxOut={maxOut}
                maxTools={maxTools}
                maxActive={maxActive}
                maxSaved={maxSaved}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ===========================================================================
 * TAB
 * ========================================================================= */
export function ModelEffortTab(_props: { data: DashboardData }) {
  const { sessions } = useWindow(); // WINDOWED subset — the source of truth
  return (
    <section className="tabpanel on" data-panel="breakdown">
      <Confound />
      <Heatmap sessions={sessions} />
      <Breakdown sessions={sessions} />
    </section>
  );
}
