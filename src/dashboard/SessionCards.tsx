import type { DashboardData, SessionRow } from "../types";
import { num, usd, pct, fmtDate, burnTier, splitMoney, useGrowWidth } from "./helpers";
import { Section } from "./Section";
import { PixelSprite } from "./PixelSprite";
import { FLM, FLM_PAL } from "./sprites";

/** N mini animated flames (burn-tier indicator). */
function MiniFlames({ n }: { n: number }) {
  return (
    <span className="flames">
      {Array.from({ length: n }, (_, i) => (
        <PixelSprite key={i} frames={FLM} pal={FLM_PAL} scale={2} className="miniflame" mode={{ kind: "cycle", intervalMs: 150 }} />
      ))}
    </span>
  );
}

function SessionCard({ s, onOpen }: { s: SessionRow; onOpen: (id: string) => void }) {
  const total = s.cost_main + s.cost_sub;
  const mPct = total ? (s.cost_main / total) * 100 : 100;
  const sPct = total ? (s.cost_sub / total) * 100 : 0;
  const { dollars, cents } = splitMoney(s.cost_usd);
  const t = burnTier(s.cost_usd);

  return (
    <button type="button" className="card" data-sid={s.id} onClick={() => onOpen(s.id)}>
      <div className="top">
        <div>
          <div className={`pj sz-${t.key}`}>
            <MiniFlames n={t.n} />
            {t.name}
          </div>
          <div className="dt">
            {fmtDate(s.date)} · {s.id} · {s.model.toUpperCase()}
          </div>
        </div>
        {s.fidelity === "high" ? (
          <span className="badge hi">High fidelity</span>
        ) : (
          <span className="badge ml">Main-loop only</span>
        )}
      </div>
      <div className="csection">
        <div className="ccost">
          <span className="cur">$</span>
          {num(dollars, 0)}
          <span className="cents" style={{ fontSize: ".5em", color: "var(--ink-dim)" }}>
            .{cents}
          </span>
        </div>
        <div className="splitbar">
          <div className="m" style={useGrowWidth(mPct)} />
          <div className="s" style={useGrowWidth(sPct)} />
        </div>
        <div className="split-leg">
          <span>
            <i className="dot cy" style={{ width: 7, height: 7 }} /> main {usd(s.cost_main)}
          </span>
          <span>
            <i className="dot mg" style={{ width: 7, height: 7 }} /> sub {usd(s.cost_sub)}
          </span>
        </div>
      </div>
      <div className="grid2">
        <div className="mcell">
          <div className="ml-l">Active</div>
          <div className="ml-v act">{num(s.active_min, 0)}m</div>
        </div>
        <div className="mcell">
          <div className="ml-l">Idle</div>
          <div className="ml-v idle">{num(s.idle_min, 0)}m</div>
        </div>
        <div className="mcell">
          <div className="ml-l">Cache hit</div>
          <div className="ml-v">{pct(s.cache_pct, 1)}</div>
        </div>
        <div className="mcell">
          <div className="ml-l">Subagents</div>
          <div className="ml-v">{s.subagents}</div>
        </div>
      </div>
      <div className="foot">
        {s.reconciliation_note ? (
          // ⓘ reconciliation callout — focusable so keyboard users get the tip too.
          <span className="recon" tabIndex={0} role="note" aria-label={`Reconciled: ${s.reconciliation_note}`}>
            ⓘ reconciled<span className="tip">{s.reconciliation_note}</span>
          </span>
        ) : (
          <span />
        )}
        <span className="open">open detail →</span>
      </div>
    </button>
  );
}

export function SessionCards({ data, onOpenSession }: { data: DashboardData; onOpenSession: (id: string) => void }) {
  // group by project; order groups by total spend desc; within group newest-first.
  const groups: Record<string, SessionRow[]> = {};
  data.sessions.forEach((s) => {
    (groups[s.project] = groups[s.project] || []).push(s);
  });
  const total = (arr: SessionRow[]) => arr.reduce((t, s) => t + s.cost_usd, 0);
  const order = Object.keys(groups).sort((a, b) => total(groups[b]) - total(groups[a]));

  return (
    <Section title="Sessions" n="grouped by project · newest first">
      <div className="sgroups">
        {order.map((proj) => {
          const list = groups[proj]
            .slice()
            .sort((a, b) => b.date.localeCompare(a.date) || b.active_min - a.active_min);
          return (
            <div className="pgroup" key={proj}>
              <div className="pgh">
                <span className="pgh-n">{proj}</span>
                <span className="pgh-m">
                  {list.length} session{list.length > 1 ? "s" : ""} · {usd(total(groups[proj]), false)}
                </span>
              </div>
              <div className="cards">
                {list.map((s) => (
                  <SessionCard key={s.id} s={s} onOpen={onOpenSession} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
