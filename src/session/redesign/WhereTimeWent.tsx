/* ============================================================================
 * WhereTimeWent — "Where the time went" section of the session-detail redesign.
 * Recreates 01-session-detail.html lines 58-86 (ribbon-stage + tgrid[donut +
 * segpanel] + per-turn pulse) and detail.js renderRibbon/renderDonut/
 * renderSegDetail/renderPulse — but bound to REAL Phase-0 fields, never the
 * prototype's seeded-RNG segments/turns/tool-times.
 *
 * HONESTY:
 *  - 3-way donut only (model-gen=thinking / tool / subagent). planning_min is
 *    ALWAYS 0 in the corpus, so the prototype's 4-way is dropped — the center
 *    label and the arcs both normalize by the SAME 3-slice sum (no phantom 4th
 *    arc, no center≠arcs mismatch).
 *  - interactive tools (AskUserQuestion) are "you answering", NOT machine time:
 *    flagged via .interflag and EXCLUDED from the machine tool-time subtotal,
 *    which is shown as an explicit rendered number.
 *  - Per-panel degrade: empty timeline_segments hides ribbon + pulse; empty
 *    turns hides the pulse; empty tool_time hides the leaderboard; the donut
 *    survives on active_breakdown alone (hasActiveBreakdown).
 *
 * The class names match the ported prototype CSS (src/session/redesign.css):
 * .ribbon/.ribbon-leg/.donut-core/.dctr/.dlegend/.toolrow/.pulse — so the
 * ribbon/pulse/leaderboard are recreated INLINE here (the existing
 * TimeRibbon/TurnPulse/ToolLeaderboard use different class names).
 * ========================================================================== */
import { useState, type CSSProperties } from "react";
import { hasActiveBreakdown } from "../ActiveSplitDonut";
import type { SessionDetailData, TimelineSegment, ToolTime, Turn } from "../../types";
import { mins, num, pct, useGrowHeight, useGrowWidth } from "../helpers";

/** Tool-row minute format: tools are usually sub-minute, so 1-decimal (not the
 *  whole-minute mins()) — matches the in-repo ToolLeaderboard treatment. */
const toolMin = (m: number): string => (m >= 0.1 ? num(m, 1) + "m" : "<0.1m");

/** Mono-uppercase panel caption (the prototype inlines this style on each caption div). */
const CAP: CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: ".66rem",
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
  marginBottom: 12,
};

/* ----------------------------- slice model -------------------------------- */

type SliceKey = "model" | "tool" | "subagent";

const SLICES: { key: SliceKey; label: string; color: string; phaseField: keyof SessionDetailData["time"]["active_breakdown"] }[] = [
  { key: "model", label: "model active · incl. thinking", color: "var(--cyan)", phaseField: "thinking_min" },
  { key: "tool", label: "tool", color: "var(--lime)", phaseField: "tool_min" },
  { key: "subagent", label: "subagent", color: "var(--magenta)", phaseField: "subagent_min" },
];

/* ------------------------------- ribbon ----------------------------------- */

const RIBBON_PHASES: { phase: TimelineSegment["phase"]; label: string }[] = [
  { phase: "thinking", label: "thinking" },
  { phase: "tool", label: "tool" },
  { phase: "subagent", label: "subagent" },
  { phase: "planning", label: "planning" },
  { phase: "idle", label: "idle / you-away" },
];

type MergedSeg = { phase: TimelineSegment["phase"]; start_min: number; dur_min: number };

/** Merge consecutive same-phase segments (matches detail.js renderRibbon). */
function mergeSegments(seg: TimelineSegment[]): MergedSeg[] {
  const merged: MergedSeg[] = [];
  for (const s of seg) {
    const last = merged[merged.length - 1];
    if (last && last.phase === s.phase) last.dur_min += s.dur_min;
    else merged.push({ phase: s.phase, start_min: s.start_min, dur_min: s.dur_min });
  }
  return merged;
}

function Ribbon({ segments, wallClockMin }: { segments: TimelineSegment[]; wallClockMin: number }) {
  const wall = wallClockMin || 1;
  const merged = mergeSegments(segments);
  const [tip, setTip] = useState<{ on: boolean; x: number; y: number; phase: string; dur: string; share: string }>({
    on: false,
    x: 0,
    y: 0,
    phase: "",
    dur: "",
    share: "",
  });

  const onMove = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".seg");
    if (!el) {
      setTip((t) => ({ ...t, on: false }));
      return;
    }
    setTip({
      on: true,
      x: Math.min(e.clientX + 14, window.innerWidth - 240),
      y: e.clientY - 60,
      phase: el.dataset.p || "",
      dur: el.dataset.d || "",
      share: el.dataset.share || "",
    });
  };

  return (
    <div className="panel">
      <div style={CAP}>Wall-clock ribbon · phase by time</div>
      <div className="ribbon-stage">
        <div className="ribbon" onMouseMove={onMove} onMouseLeave={() => setTip((t) => ({ ...t, on: false }))}>
          {merged.map((s, i) => {
            const w = (s.dur_min / wall) * 100;
            if (w < 0.2) return null;
            return (
              <div
                key={i}
                className={`seg ${s.phase}`}
                style={{ width: `${w.toFixed(2)}%`, cursor: "help" }}
                data-p={s.phase}
                data-d={mins(s.dur_min)}
                data-share={`${Math.round(w)}%`}
              />
            );
          })}
        </div>
      </div>
      <div className="ribbon-leg">
        {RIBBON_PHASES.map((p) => (
          <span key={p.phase}>
            <i className={p.phase} />
            {p.label}
          </span>
        ))}
      </div>
      <div id="detTip" style={{ left: tip.x, top: tip.y, opacity: tip.on ? 1 : 0 }}>
        <b>
          {tip.phase} · {tip.dur}
        </b>{" "}
        <span className="dim">({tip.share} of wall-clock)</span>
      </div>
    </div>
  );
}

/* -------------------------------- donut ----------------------------------- */

/** Concentric-ring SVG donut from the 3 real slices, normalized by their SUM
 *  (so the center label and the arcs agree — no phantom 4th arc). */
function Donut({
  slices,
  total,
  selected,
  onSelect,
}: {
  slices: { key: SliceKey; label: string; color: string; value: number }[];
  total: number;
  selected: SliceKey;
  onSelect: (k: SliceKey) => void;
}) {
  const size = 230;
  const thick = 32;
  const r = (size - thick) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  let off = 0;

  return (
    <div className="donut" id="donut">
      <div className="donut-stage">
        <div className="donut-core">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {slices.map((s) => {
              const len = (s.value / total) * circ;
              const dash = `${len} ${circ - len}`;
              const rot = (off / total) * 360 - 90;
              off += s.value;
              return (
                <circle
                  key={s.key}
                  className="donut-arc"
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={thick}
                  strokeDasharray={dash}
                  transform={`rotate(${rot} ${cx} ${cy})`}
                  style={{ cursor: "pointer", opacity: s.key === selected ? 1 : 0.28 }}
                  onClick={() => onSelect(s.key)}
                />
              );
            })}
          </svg>
          <div className="dctr">
            <div className="dv">{mins(total)}</div>
            <div className="dl">active compute</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ segpanel ---------------------------------- */

const PHASE_EXPL: Record<SliceKey, string> = {
  model: "Model active — the model reasoning and generating (extended thinking + producing the response).",
  tool: "Tool — running a tool: file edits, shell commands, searches. This is the bulk of real compute.",
  subagent: "Subagent — dispatched sub-tasks running their own model loop, often in parallel.",
};

/** The bar fill in a tool/segment row, growing 0→target (final value is source of truth). */
function SegBar({ width, color }: { width: number; color: string }) {
  const style = useGrowWidth(width, { ["--bar" as string]: color });
  return (
    <span className="tb">
      <i style={style} aria-hidden="true" />
    </span>
  );
}

function SegDetail({ slice, data }: { slice: { key: SliceKey; label: string; color: string; value: number }; data: SessionDetailData }) {
  const total = SLICES.reduce((a, s) => a + data.time.active_breakdown[s.phaseField], 0) || 1;
  const pctv = Math.round((slice.value / total) * 100);
  // Capitalized short title for the header (the long label is the legend's job).
  const title = slice.key === "model" ? "Model active" : slice.key === "tool" ? "Tooling" : "Subagents";

  let body: React.ReactNode;
  let interflag: React.ReactNode = null;

  if (slice.key === "tool") {
    const tt = [...data.tool_time].sort((a, b) => b.total_min - a.total_min);
    const max = Math.max(...tt.map((t) => t.total_min), 0.0001);
    const machine = tt.filter((t) => !t.interactive).reduce((a, t) => a + t.total_min, 0);
    const firstInteractive = tt.find((t) => t.interactive);

    body = (
      <>
        <div className="sd-sub">tool-time leaderboard</div>
        <div className="sd-rows">
          {tt.map((t: ToolTime) => (
            <div key={t.name} className={`toolrow${t.interactive ? " inter" : ""}`}>
              <span className="tn">{t.name}</span>
              <SegBar width={(t.total_min / max) * 100} color={t.interactive ? "var(--amber)" : slice.color} />
              <span className="tx">
                {toolMin(t.total_min)} · {num(t.count)}× · p95 {t.p95_s}s
              </span>
            </div>
          ))}
        </div>
        <div
          style={{ fontFamily: "var(--mono)", fontSize: ".72rem", color: "var(--ink-dim)", marginTop: 12, lineHeight: 1.5 }}
        >
          <b style={{ color: "var(--ink)" }}>{toolMin(machine)}</b> of real machine tool time
          {firstInteractive ? " (interactive prompts excluded)." : "."}
        </div>
      </>
    );
    if (firstInteractive) {
      interflag = (
        <div className="interflag" id="toolFlag">
          <b>{firstInteractive.name}</b> is mostly <b>you answering</b>, not machine time — its{" "}
          {toolMin(firstInteractive.total_min)} is excluded from the machine tool-time subtotal.
        </div>
      );
    }
  } else {
    const oneLiner =
      slice.key === "model"
        ? "The model thinking + generating its replies — measured from the active timeline. No finer breakdown for this phase."
        : data.cost.subagent_usd > 0
          ? "Time farmed out to subagents running their own loops, often in parallel."
          : "No subagent time was recorded this run.";
    body = (
      <>
        <div className="sd-sub">{title.toLowerCase()} total</div>
        <div className="sd-empty">{oneLiner}</div>
      </>
    );
  }

  return (
    <>
      <div className="sd-head">
        <span className="sd-dot" style={{ background: slice.color, boxShadow: `0 0 12px ${slice.color}` }} />
        <b style={{ color: slice.color }}>{title}</b>
        <span className="sd-tot">
          {mins(slice.value)} · {pctv}%
        </span>
      </div>
      <div className="sd-expl">{PHASE_EXPL[slice.key]}</div>
      {body}
      {interflag}
    </>
  );
}

/* -------------------------------- pulse ----------------------------------- */

function PulseBar({ height, cls, turn, secs }: { height: number; cls: string; turn: number; secs: string }) {
  const style = useGrowHeight(height);
  return <i className={cls} style={style} title={`turn ${turn} · ${secs}s`} />;
}

function Pulse({ turns }: { turns: Turn[] }) {
  const max = Math.max(...turns.map((t) => t.response_ms), 1);
  const avg = turns.reduce((a, t) => a + t.response_ms, 0) / turns.length;
  const slowest = turns.reduce((a, t) => (t.response_ms > a.response_ms ? t : a), turns[0]);

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div style={{ ...CAP, marginBottom: 14 }}>Per-turn pulse · response time</div>
      <div className="pulse">
        {turns.map((t) => {
          const cls = t === slowest ? "slow" : t.response_ms > avg * 1.4 ? "above" : "";
          return (
            <PulseBar key={t.i} height={(t.response_ms / max) * 100} cls={cls} turn={t.i} secs={(t.response_ms / 1000).toFixed(1)} />
          );
        })}
      </div>
      <div className="pulse-cap">
        {turns.length} turns · avg <b style={{ color: "var(--ink-dim)" }}>{(avg / 1000).toFixed(1)}s</b> · slowest{" "}
        <b style={{ color: "var(--magenta)" }}>
          turn {slowest.i} ({(slowest.response_ms / 1000).toFixed(1)}s)
        </b>{" "}
        · amber bars are above-average
      </div>
    </div>
  );
}

/* ------------------------------- section ---------------------------------- */

export function WhereTimeWent({ data }: { data: SessionDetailData }) {
  const [selected, setSelected] = useState<SliceKey>("tool");

  const ab = data.time.active_breakdown;
  const slices = SLICES.map((s) => ({ key: s.key, label: s.label, color: s.color, value: ab[s.phaseField] }));
  const total = slices.reduce((a, s) => a + s.value, 0);
  const showDonut = hasActiveBreakdown(data) && total > 0;
  const hasSegments = data.timeline_segments.length > 0;
  const hasTurns = data.turns.length > 0;
  // Default-select the tool slice when present; otherwise the first nonzero slice.
  const activeSlice =
    slices.find((s) => s.key === selected && s.value > 0) ?? slices.find((s) => s.value > 0) ?? slices[0];

  return (
    <section className="dsec">
      <div className="dsec-head">
        <h2>Where the time went</h2>
        <span className="ln" />
        <span className="n">active vs idle</span>
      </div>

      {!hasSegments && !showDonut ? (
        <div className="panel">
          <div className="degrade">
            <h3>Detailed timeline not captured for this session.</h3>
            <p>
              Only the coarse active / idle split above is available for this record (data tier: <b>{data.data_tier ?? "thin"}</b>). The
              active-time breakdown and per-turn pulse need an enriched transcript.
            </p>
          </div>
        </div>
      ) : (
        <div id="timeDetail">
          {hasSegments && <Ribbon segments={data.timeline_segments} wallClockMin={data.time.wall_clock_min} />}

          {showDonut && (
            <div className="tgrid">
              <div className="panel donutwrap">
                <div style={{ ...CAP, alignSelf: "flex-start", marginBottom: 0 }}>Active-time split</div>
                <Donut slices={slices} total={total} selected={activeSlice.key} onSelect={setSelected} />
                <div className="dlegend" id="donutLeg">
                  {slices.map((s) => {
                    const disabled = s.value <= 0;
                    const sel = s.key === activeSlice.key;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        className="phase-row"
                        onClick={() => !disabled && setSelected(s.key)}
                        disabled={disabled}
                        style={{
                          background: "none",
                          border: "none",
                          textAlign: "left",
                          cursor: disabled ? "default" : "pointer",
                          opacity: disabled ? 0.4 : sel ? 1 : 0.72,
                          width: "100%",
                          font: "inherit",
                        }}
                      >
                        <span
                          style={{
                            width: 11,
                            height: 11,
                            borderRadius: "50%",
                            flex: "none",
                            background: s.color,
                            boxShadow: sel ? `0 0 8px ${s.color}` : "none",
                          }}
                        />
                        <span className="phase-meta">
                          <span className="pml" style={{ textTransform: "none" }}>
                            {s.label}
                          </span>
                        </span>
                        <span className="phase-val">
                          <b>{mins(s.value)}</b>
                          <span style={{ color: s.color }}>{pct((s.value / total) * 100, 0)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="seg-hint" id="segHint">
                  tap a slice to break it down →
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: ".6rem", color: "var(--ink-faint)", lineHeight: 1.5, width: "100%" }}>
                  Slices sum the three measured phases ({mins(total)}); the headline{" "}
                  <b style={{ color: "var(--ink-dim)" }}>{mins(data.time.active_min)} active</b> above also counts active
                  time the phase walk could not attribute.
                </div>
              </div>
              <div className="panel segpanel">
                <div id="segDetail">
                  <SegDetail slice={activeSlice} data={data} />
                </div>
              </div>
            </div>
          )}

          {hasSegments && hasTurns && <Pulse turns={data.turns} />}
        </div>
      )}
    </section>
  );
}
