import type { DashboardData } from "../types";
import { groupSessions, type GroupBy, type GroupRow } from "./aggregate";
import { usd, pct, num, fmtDate, useGrowWidth } from "./helpers";
import { Section } from "./Section";

const SMALL_N = 10;

/** One neutral bucket row. Extracted as its own component so `useGrowWidth`
 *  (a hook) is called exactly once per row instance — the bucket count varies
 *  across week/model/effort groupings, so calling the hook inside a .map() in
 *  the parent body would violate the Rules of Hooks. Mirrors Distributions' Seg. */
function GroupRollupRow({ g, maxCost }: { g: GroupRow; maxCost: number }) {
  const smallN = g.sessions < SMALL_N;
  return (
    <div className="grow">
      <div className="grow-head">
        <span className="grow-label">{g.label}</span>
        <span className="grow-meta">
          {g.sessions} session{g.sessions > 1 ? "s" : ""} · {fmtDate(g.date_from)}–{fmtDate(g.date_to)}
          {smallN && <span className="grow-illus"> · illustrative, not significant</span>}
        </span>
      </div>
      <div className="grow-bar">
        <i style={useGrowWidth((g.cost_usd / maxCost) * 100, { background: "var(--cyan)" })} />
      </div>
      <div className="grow-nums">
        <span>{usd(g.cost_usd, false)}</span>
        <span>{pct(g.avg_cache_pct, 0)} cache</span>
        <span>{num(g.active_min, 0)} active min</span>
      </div>
    </div>
  );
}

/** Neutral aggregate rollup for week/model/effort groupings. Deliberately
 *  carries NO ranking adjectives or causal/superlative copy (spec §8 / L7):
 *  model-version buckets are time-disjoint, so we show date-span + n, never
 *  "more efficient". Sub-§8 small-n buckets render an "illustrative" tag. */
export function GroupRollup({ data, by }: { data: DashboardData; by: Exclude<GroupBy, "project"> }) {
  const groups = groupSessions(data.sessions, by);
  const maxCost = Math.max(1, ...groups.map((g) => g.cost_usd));
  const heading: Record<typeof by, string> = {
    week: "By week",
    model: "By model version",
    effort: "By effort level",
  };
  const caption =
    by === "model"
      ? "breakdown, not comparison — buckets are time-disjoint (see date span)"
      : by === "effort"
        ? "breakdown — effort is partly inferred (see PR1 source tags)"
        : "calendar rollup · UTC week start";

  return (
    <Section title={heading[by]} n={caption}>
      <div className="grollup">
        {groups.map((g) => (
          <GroupRollupRow key={g.key} g={g} maxCost={maxCost} />
        ))}
      </div>
    </Section>
  );
}
