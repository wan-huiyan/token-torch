import type { DashboardData, SessionRow } from "../types";
import { usd } from "./helpers";
import { prettyModel, effortLabel, isMixedVersion, SMALL_N } from "./aggregate";
import { isRealModelId } from "../shared/models";
import { Section } from "./Section";

/* ============================================================================
 * TOKEN TORCH — CostHeatmap (Plan 5 T5, B5).
 * model_version × effort cost grid built from data.sessions[]. DESCRIBES spend;
 * it is NEVER a model-efficiency ranking — the groups are time-disjoint.
 * Honesty / accessibility:
 *   - every cell shows its $ value as TEXT and a colorblind-safe SINGLE-HUE
 *     amber-opacity fill (never rainbow / red-green);
 *   - color is mapped by QUANTILE (rank over populated cells), not raw linear,
 *     so one big-spend cell doesn't saturate everything;
 *   - a (model,effort) pair with 0 sessions is an explicit empty "·" (NOT α=0,
 *     which would read as "cheap"); a pair with n < SMALL_N is muted + "n=k";
 *   - cost is an ESTIMATE (per-model list rates) — tagged [estimate].
 * If fewer than 2 model rows OR 2 effort cols are populated, a sorted bar list
 * is rendered instead with a "deferred" note (no fabricated what-shipped axis).
 * ========================================================================== */

const AMBER_RGB = "255, 180, 61"; // matches --amber; rgba ramp keeps a single hue
const A_FLOOR = 0.15; // lowest populated cell still visibly shaded (not empty-looking)
const A_CEIL = 0.85;

interface Cell {
  cost: number;
  n: number;
  alpha: number; // 0 ⇒ empty (no sessions)
}

/** One heatmap cell — its own component (no hooks here, but mirrors the
 *  cell-as-component idiom and keeps the grid map clean). */
function HeatCell({ cell, model, effort }: { cell: Cell; model: string; effort: string }) {
  if (cell.n === 0) {
    return (
      <td className="hm-cell hm-empty" aria-label={`${model} × ${effort}: no sessions`}>
        <span className="hm-dot">·</span>
      </td>
    );
  }
  const smallN = cell.n < SMALL_N;
  return (
    <td
      className={`hm-cell${smallN ? " hm-small" : ""}`}
      style={{ background: `rgba(${AMBER_RGB}, ${cell.alpha.toFixed(3)})` }}
      aria-label={`${model} × ${effort}: ${usd(cell.cost)} (estimate)${smallN ? `, n=${cell.n}` : ""}`}
    >
      <span className="hm-val">{usd(cell.cost, false)}</span>
      {smallN && <span className="hm-n">n={cell.n}</span>}
    </td>
  );
}

/** Fallback when the grid can't form a 2×2 — a sorted bar list of whatever
 *  (model,effort) pairs exist, plus an honest "deferred" note. */
function HeatFallback({ pairs, max }: { pairs: { label: string; cost: number }[]; max: number }) {
  return (
    <div className="hm-fallback">
      {pairs.map((p) => (
        <div key={p.label} className="hm-fb-row">
          <span className="hm-fb-label">{p.label}</span>
          <div className="hm-fb-bar">
            <i style={{ width: `${(p.cost / max) * 100}%`, background: `rgba(${AMBER_RGB}, .6)` }} />
          </div>
          <span className="hm-fb-val">{usd(p.cost, false)}</span>
        </div>
      ))}
      <div className="hm-cap">
        a cost × what-shipped heatmap needs generate-time shipped data — deferred
      </div>
    </div>
  );
}

export function CostHeatmap({ data }: { data: DashboardData }) {
  // Exclude mixed-version + synthetic-model sessions so neither axis is contaminated.
  const rows: SessionRow[] = data.sessions.filter(
    (s) => s.model_version != null && isRealModelId(s.model_version) && !isMixedVersion(s),
  );

  // Axes: real model versions × effort values present in the pool.
  const modelKeys: string[] = [];
  const effortKeys: string[] = [];
  const agg = new Map<string, { cost: number; n: number }>(); // "model||effort" → totals
  for (const s of rows) {
    const m = s.model_version as string;
    const e = s.effort?.value ?? "unknown";
    if (!modelKeys.includes(m)) modelKeys.push(m);
    if (!effortKeys.includes(e)) effortKeys.push(e);
    const k = `${m}||${e}`;
    const cur = agg.get(k) ?? { cost: 0, n: 0 };
    cur.cost += s.cost_usd;
    cur.n += 1;
    agg.set(k, cur);
  }

  // Stable axis order: models by total spend desc, efforts by total spend desc.
  const modelSpend = (m: string) => effortKeys.reduce((t, e) => t + (agg.get(`${m}||${e}`)?.cost ?? 0), 0);
  const effortSpend = (e: string) => modelKeys.reduce((t, m) => t + (agg.get(`${m}||${e}`)?.cost ?? 0), 0);
  modelKeys.sort((a, b) => modelSpend(b) - modelSpend(a));
  effortKeys.sort((a, b) => effortSpend(b) - effortSpend(a));

  // EMPTY-STATE: a real grid needs ≥2 populated model rows AND ≥2 effort cols.
  if (modelKeys.length < 2 || effortKeys.length < 2) {
    const pairs = [...agg.entries()]
      .map(([k, v]) => {
        const [m, e] = k.split("||");
        return { label: `${prettyModel(m)} · ${effortLabel(e)}`, cost: v.cost };
      })
      .sort((a, b) => b.cost - a.cost);
    const max = Math.max(1, ...pairs.map((p) => p.cost));
    return (
      <Section title="Cost by model × effort" n="estimate · descriptive">
        <HeatFallback pairs={pairs} max={max} />
      </Section>
    );
  }

  // QUANTILE coloring: rank the POPULATED cells by cost, map rank → α (floor→ceil)
  // so a single big-spend cell can't saturate the rest (raw-linear would).
  const populated = [...agg.values()].filter((v) => v.n > 0).map((v) => v.cost);
  const sortedCosts = [...populated].sort((a, b) => a - b);
  const denom = Math.max(1, sortedCosts.length - 1);
  const alphaFor = (cost: number): number => {
    // rank = #cells with strictly-lower cost (ties share a rank → same shade)
    const rank = sortedCosts.findIndex((c) => c >= cost);
    const t = rank / denom; // 0..1 by position, not by raw magnitude
    return A_FLOOR + t * (A_CEIL - A_FLOOR);
  };

  return (
    <Section title="Cost by model × effort" n="estimate · descriptive">
      <div className="hm-wrap">
        <table className="hm" role="grid" aria-label="cost by model version and effort (estimate)">
          <thead>
            <tr>
              <th scope="col" className="hm-corner" />
              {effortKeys.map((e) => (
                <th key={e} scope="col" className="hm-col">
                  {effortLabel(e)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modelKeys.map((m) => (
              <tr key={m}>
                <th scope="row" className="hm-row">
                  {prettyModel(m)}
                </th>
                {effortKeys.map((e) => {
                  const v = agg.get(`${m}||${e}`);
                  const cell: Cell = v
                    ? { cost: v.cost, n: v.n, alpha: alphaFor(v.cost) }
                    : { cost: 0, n: 0, alpha: 0 };
                  return (
                    <HeatCell key={e} cell={cell} model={prettyModel(m)} effort={effortLabel(e)} />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hm-cap">
          <span className="hm-est">[estimate]</span> Cost is an estimate (per-model list rates).
          Groups are time-disjoint — shading describes spend, not model efficiency. Shaded by
          relative cost (quantile); empty cells (·) had no sessions.
        </div>
      </div>
    </Section>
  );
}
