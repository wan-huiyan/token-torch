/* ============================================================================
 * TurnPulse — one bar per turn (turns[].response_ms). Slowest is labeled +
 * magenta; above-average bars are amber; a dashed average line spans the plot;
 * hover shows a tooltip (turn # + response seconds). Turn numbers show when the
 * set is small (<=16). Bars grow 0→target height (final value is source of
 * truth). Mirrors the prototype pulse().
 * ========================================================================== */
import { useState } from "react";
import type { SessionDetailData, Turn } from "../types";
import { useGrowHeight } from "./helpers";

function PulseBar({
  height,
  cls,
  turn,
  secs,
  showVal,
}: {
  height: number;
  cls: string;
  turn: number;
  secs: string;
  showVal: boolean;
}) {
  const style = useGrowHeight(height);
  return (
    <div className={`pbar ${cls}`} style={style} data-t={turn} data-s={secs}>
      {showVal && <span className="pval">{secs}s</span>}
    </div>
  );
}

export function TurnPulse({ data }: { data: SessionDetailData }) {
  const tr = data.turns;
  const [tip, setTip] = useState<{ on: boolean; x: number; y: number; t: string; s: string }>({
    on: false,
    x: 0,
    y: 0,
    t: "",
    s: "",
  });
  if (!tr.length) return null;

  const max = Math.max(...tr.map((t) => t.response_ms));
  const avg = tr.reduce((a, t) => a + t.response_ms, 0) / tr.length;
  const slow = tr.reduce((a, t) => (t.response_ms > a.response_ms ? t : a), tr[0]);
  const showN = tr.length <= 16;

  const onMove = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".pbar");
    if (!el) {
      setTip((p) => ({ ...p, on: false }));
      return;
    }
    setTip({
      on: true,
      x: Math.min(e.clientX + 14, window.innerWidth - 160),
      y: e.clientY - 44,
      t: el.dataset.t || "",
      s: el.dataset.s || "",
    });
  };

  return (
    <>
      <div className="sec-head" style={{ marginBottom: 10 }}>
        <h2 style={{ fontSize: ".7rem", letterSpacing: ".16em" }}>Per-turn pulse</h2>
        <div className="ln" />
        <div className="n">{tr.length} turns</div>
      </div>
      <div className="pulse-plot" onMouseMove={onMove} onMouseLeave={() => setTip((p) => ({ ...p, on: false }))}>
        <div className="pavg" style={{ bottom: `${((avg / max) * 100).toFixed(1)}%` }}>
          <span>avg {(avg / 1000).toFixed(1)}s</span>
        </div>
        {tr.map((t: Turn) => {
          const h = Math.max((t.response_ms / max) * 100, 4);
          const isMax = t.response_ms === max;
          const hot = !isMax && t.response_ms > avg;
          return (
            <div className="pcol" key={t.i}>
              <PulseBar
                height={h}
                cls={isMax ? "max" : hot ? "hot" : ""}
                turn={t.i}
                secs={(t.response_ms / 1000).toFixed(1)}
                showVal={isMax}
              />
              {showN && <span className="ptn">{t.i}</span>}
            </div>
          );
        })}
      </div>
      <div className="pulsecap">
        Each bar is one turn's response time.{" "}
        <b>
          Slowest: turn {slow.i} at {(slow.response_ms / 1000).toFixed(1)}s
        </b>{" "}
        · avg {(avg / 1000).toFixed(1)}s · hover any bar for detail.
      </div>
      <div className={`rib-tip${tip.on ? " on" : ""}`} style={{ left: tip.x, top: tip.y }}>
        <b style={{ color: "var(--cyan)" }}>Turn {tip.t}</b> · {tip.s}s response
      </div>
    </>
  );
}
