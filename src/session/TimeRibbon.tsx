/* ============================================================================
 * TimeRibbon — the wall-clock ribbon. A horizontal time-strip from
 * timeline_segments: segments coloured by phase (thinking=cyan, tool=lime,
 * subagent=magenta, planning=amber; idle/wait = dim diagonal hatch "you away").
 * Consecutive same-phase segments merge; sub-pixel slivers (<0.4%) merge into the
 * previous segment so hundreds of segments still render cleanly. Widths are
 * proportional to dur_min. Hover shows phase + duration (fixed-position tooltip).
 * Cute pixel illustrations float above wide (>=7%) segments: thinking-cloud,
 * lime spark over tool, sleepy moon + "Zzz" over idle, flipping hourglass over
 * wait. Mirrors the prototype ribbon() + the ICON map in decorate().
 * ========================================================================== */
import { useRef, useState } from "react";
import type { Phase, SessionDetailData, TimelineSegment } from "../types";
import { mins } from "./helpers";
import { PixelSprite } from "./PixelSprite";
import {
  HOUR,
  HOUR_PAL,
  RMOON,
  RMOON_PAL,
  SPARK,
  SPARK_PAL,
  THINK,
  THINK_PAL,
  type Frame,
  type Palette,
} from "./sprites";

const PHASE: Record<Phase, { label: string; fill?: string; hatch?: "idle" | "wait" }> = {
  thinking: { label: "Thinking", fill: "var(--cyan)" },
  tool: { label: "Tool calls", fill: "var(--lime)" },
  subagent: { label: "Subagents", fill: "var(--magenta)" },
  planning: { label: "Planning", fill: "var(--amber)" },
  idle: { label: "You away (idle)", hatch: "idle" },
  wait: { label: "Between-turn wait", hatch: "wait" },
};
const PHASE_ORDER: Phase[] = ["thinking", "tool", "subagent", "planning", "idle", "wait"];

/** Phase → [sprite frame, palette, animation class]. */
const ICON: Partial<Record<Phase, [Frame, Palette, string]>> = {
  thinking: [THINK, THINK_PAL, "ph-thinking"],
  tool: [SPARK, SPARK_PAL, "ph-tool"],
  idle: [RMOON, RMOON_PAL, "ph-idle"],
  wait: [HOUR, HOUR_PAL, "ph-wait"],
  subagent: [SPARK, { L: "#ff5ad0" }, "ph-tool"],
  planning: [HOUR, HOUR_PAL, "ph-wait"],
};

type Merged = { phase: Phase; start_min: number; dur_min: number; tools?: Record<string, number> };

/** Sum tool-count maps in place (src → dst). */
function foldTools(dst: Merged, src?: Record<string, number>) {
  if (!src) return;
  dst.tools = dst.tools || {};
  for (const [k, v] of Object.entries(src)) dst.tools[k] = (dst.tools[k] || 0) + v;
}

/** Merge consecutive same-phase segments, then fold sub-pixel slivers forward. */
function mergeSegments(seg: TimelineSegment[]): Merged[] {
  const merged: Merged[] = [];
  seg.forEach((s) => {
    const last = merged[merged.length - 1];
    if (last && last.phase === s.phase) {
      last.dur_min += s.dur_min; // keep earlier start_min
      foldTools(last, s.tools);
    } else {
      merged.push({ phase: s.phase, start_min: s.start_min, dur_min: s.dur_min, tools: s.tools ? { ...s.tools } : undefined });
    }
  });
  const total = merged.reduce((a, s) => a + s.dur_min, 0) || 1;
  // Fold sub-pixel slivers (<0.4% of total) into the previous merged segment.
  const out: Merged[] = [];
  for (const m of merged) {
    if (out.length && (m.dur_min / total) * 100 < 0.4) {
      const prev = out[out.length - 1];
      prev.dur_min += m.dur_min; // keep prev start_min
      foldTools(prev, m.tools);
    } else {
      out.push({ ...m, tools: m.tools ? { ...m.tools } : undefined });
    }
  }
  return out;
}

/** "0:45" clock format (M:SS) from a fractional-minute value — matches ribscale style. */
function clock(minVal: number): string {
  const total = Math.round(minVal * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Top few tools by count desc, e.g. "Bash ×12 · Read ×4". */
function topTools(tools: Record<string, number> | undefined, n = 3): string {
  if (!tools) return "";
  return Object.entries(tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ×${v}`)
    .join(" · ");
}

export function TimeRibbon({ data }: { data: SessionDetailData }) {
  const merged = mergeSegments(data.timeline_segments);
  const total = merged.reduce((a, s) => a + s.dur_min, 0) || 1;
  const tipRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  const [tip, setTip] = useState<{
    on: boolean;
    x: number;
    y: number;
    phase: string;
    dur: string;
    start: string;
    share: string;
    tools: string;
  }>({ on: false, x: 0, y: 0, phase: "", dur: "", start: "", share: "", tools: "" });

  // icon positions (centers) for wide segments
  let cum = 0;
  const icons: { phase: Phase; center: number }[] = [];
  const segs = merged.map((s, i) => {
    const share = (s.dur_min / total) * 100;
    const center = cum + share / 2;
    cum += share;
    if (share >= 7) icons.push({ phase: s.phase, center });
    const meta = PHASE[s.phase];
    return {
      key: i,
      share: s.dur_min,
      phase: s.phase,
      hatch: meta.hatch,
      fill: meta.fill,
      label: meta.label,
      dur: mins(s.dur_min),
      start: clock(s.start_min),
      sharePct: `${((s.dur_min / total) * 100).toFixed(1)}%`,
      tools: s.phase === "tool" ? topTools(s.tools) : "",
    };
  });

  const tipFrom = (el: HTMLElement, clientX: number, clientY: number, on: boolean) => ({
    on,
    x: Math.min(clientX + 14, window.innerWidth - 220),
    y: clientY - 64,
    phase: el.dataset.p || "",
    dur: el.dataset.d || "",
    start: el.dataset.start || "",
    share: el.dataset.share || "",
    tools: el.dataset.tools || "",
  });

  const onMove = (e: React.MouseEvent) => {
    if (pinned) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>(".seg");
    if (!el) {
      setTip((t) => ({ ...t, on: false }));
      return;
    }
    setTip(tipFrom(el, e.clientX, e.clientY, true));
  };

  // Click-to-pin: pin the tooltip on a segment; click again (or off a segment) to release.
  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".seg");
    if (!el) {
      setPinned(false);
      setTip((t) => ({ ...t, on: false }));
      return;
    }
    if (pinned) {
      setPinned(false);
      setTip(tipFrom(el, e.clientX, e.clientY, true));
    } else {
      setPinned(true);
      setTip(tipFrom(el, e.clientX, e.clientY, true));
    }
  };

  return (
    <>
      <div className="ribbon-stage">
        <div className="ribbon-icons">
          {icons.map((ic, i) => {
            const def = ICON[ic.phase];
            if (!def) return null;
            return (
              <div key={i} className="ricon" style={{ left: `${ic.center.toFixed(2)}%` }}>
                <PixelSprite frames={[def[0]]} pal={def[1]} scale={3} className={def[2]} />
                {ic.phase === "idle" && <span className="rzzz">z</span>}
              </div>
            );
          })}
        </div>
        <div
          className="ribbon"
          onMouseMove={onMove}
          onMouseLeave={() => !pinned && setTip((t) => ({ ...t, on: false }))}
          onClick={onClick}
        >
          {segs.map((s) => (
            <div
              key={s.key}
              className={`seg${s.hatch ? " " + s.hatch : ""}`}
              style={{ flex: `${s.share} 0 0`, ...(s.fill ? { background: s.fill } : {}) }}
              data-p={s.label}
              data-d={s.dur}
              data-start={s.start}
              data-share={s.sharePct}
              data-tools={s.tools}
            />
          ))}
        </div>
      </div>
      <div className="ribscale">
        <span>0:00</span>
        <span>{mins(total)} wall-clock →</span>
      </div>
      <div className="riblegend">
        {PHASE_ORDER.map((k) => {
          const meta = PHASE[k];
          return (
            <span key={k}>
              <i className={meta.hatch} style={meta.fill ? { background: meta.fill } : undefined} />
              {meta.label}
            </span>
          );
        })}
      </div>
      <div
        ref={tipRef}
        className={`rib-tip${tip.on ? " on" : ""}${pinned ? " pinned" : ""}`}
        style={{ left: tip.x, top: tip.y }}
      >
        <div className="rt-head">
          <b style={{ color: "var(--cyan)" }}>{tip.phase}</b> · {tip.dur}
          {pinned && <span className="rt-pin">pinned</span>}
        </div>
        <div className="rt-sub">
          starts {tip.start} · {tip.share} of wall-clock
        </div>
        {tip.tools && <div className="rt-tools">{tip.tools}</div>}
      </div>
    </>
  );
}
