import type { DashboardData } from "../types";
import { num, useCountUp } from "./helpers";
import { RadialGauge } from "./RadialGauge";

function CountTile({
  label,
  end,
  fmt,
  sub,
  color,
  prefix,
  suffix,
}: {
  label: string;
  end: number;
  fmt: (v: number) => string;
  sub: string;
  color?: string;
  prefix?: string;
  suffix?: string;
}) {
  const text = useCountUp(end, fmt);
  return (
    <div className="tile">
      <div className="tl">{label}</div>
      <div className="tv" style={color ? { color } : undefined}>
        {prefix}
        {text}
        {suffix}
      </div>
      <div className="ts">{sub}</div>
    </div>
  );
}

export function StatStrip({ data }: { data: DashboardData }) {
  const t = data.totals;
  const cacheText = useCountUp(t.avg_cache_hit_pct, (v) => num(v, 1));
  return (
    <div className="strip">
      <CountTile label="Sessions" end={t.sessions} fmt={(v) => num(Math.round(v), 0)} sub="autonomous runs logged" />
      <CountTile label="Projects" end={data.meta.project_count} fmt={(v) => num(Math.round(v), 0)} sub="distinct codebases" />
      <CountTile label="$ / active min" end={t.cost_per_active_min} fmt={(v) => num(v, 2)} sub="burn rate when working" color="var(--cyan)" prefix="$" />
      <CountTile label="Subagent dispatches" end={t.subagent_dispatches} fmt={(v) => num(Math.round(v), 0)} sub="parallel fan-out calls" color="var(--magenta)" />
      <div className="tile gauge">
        <RadialGauge pct={t.avg_cache_hit_pct} />
        <div className="gtxt">
          <div className="tl">Avg cache hit</div>
          <div className="tv glowtv" style={{ color: "var(--lime)" }}>
            {cacheText}%
          </div>
          <div className="ts">context reuse</div>
        </div>
      </div>
    </div>
  );
}
