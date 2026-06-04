/* ============================================================================
 * TOKEN TORCH redesign — stat strip (00-dashboard.html lines 73-79).
 * 5 tiles + a radial cache-gauge tile. Bound to the windowed aggregate
 * (useWindow().agg) so the figures track the active time window. Markup matches
 * the prototype's `.strip` / `.tile` / `.tile-ico` / `.tv funnum` taxonomy;
 * sprites mount via <Sprite>, the cache arc reuses the existing <RadialGauge>.
 * ========================================================================== */
import type { DashboardData } from "../../types";
import { num, pct, useCountUp } from "../helpers";
import { RadialGauge } from "../RadialGauge";
import { Sprite } from "../Sprite";
import { mountFamily, mountIcon, mountTerminal } from "../spriteEngine";
import { useWindow } from "../useWindow";
import { Cents, Est } from "./ui";

const int = (v: number): string => num(Math.round(v), 0);

export function StatStrip(_props: { data: DashboardData }) {
  const { agg } = useWindow();
  const sessions = useCountUp(agg.sessions, int);
  const subs = useCountUp(agg.subs, int);
  const cpm = agg.active > 0 ? agg.cost / agg.active : 0;

  return (
    <div className="strip">
      <div className="tile">
        <span className="tile-ico">
          <Sprite mount={(h) => mountTerminal(h, 2)} />
        </span>
        <div className="tl">Sessions</div>
        <div className="tv funnum fn-amber">{sessions}</div>
        <div className="ts">autonomous runs logged</div>
      </div>

      <div className="tile">
        <span className="tile-ico">
          <Sprite mount={(h) => mountIcon(h, "folder", 2)} />
        </span>
        <div className="tl">Projects</div>
        <div className="tv funnum fn-lime">{int(agg.projectCount)}</div>
        <div className="ts">distinct codebases</div>
      </div>

      <div className="tile">
        <span className="tile-ico">
          <Sprite mount={(h) => mountIcon(h, "money", 2)} />
        </span>
        <div className="tl">$ / active min</div>
        <div className="tv" style={{ color: "var(--cyan)" }}>
          <Cents v={cpm} />
        </div>
        <div className="ts">
          burn rate when working <Est />
        </div>
      </div>

      <div className="tile">
        <span className="tile-ico">
          <Sprite mount={(h) => mountFamily(h, 2)} />
        </span>
        <div className="tl">Subagent dispatches</div>
        <div className="tv" style={{ color: "var(--magenta)" }}>
          {subs}
        </div>
        <div className="ts">parallel fan-out calls</div>
      </div>

      <div className="tile gauge">
        <div id="gaugeMount">
          <RadialGauge pct={agg.cacheAvg} />
        </div>
        <div className="gtxt">
          <div className="tl">Avg cache hit</div>
          <div className="tv">{pct(agg.cacheAvg)}</div>
          <div className="ts">context reuse</div>
        </div>
      </div>
    </div>
  );
}
