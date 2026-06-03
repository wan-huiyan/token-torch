import type { DashboardData } from "../types";
import { mins } from "../shared/mins";
import { fmtStamp } from "./helpers";
import { Section } from "./Section";

/**
 * B4 — 5-hour rolling windows (ESTIMATE). Leads with the current/most-recent window: reset countdown +
 * pace vs the user's own busiest window. NOT a quota gauge — shows activity, never % of a limit; LOCAL
 * lower bound; as of the last generate. Hidden when absent. Complements the hero's "on a plan, so $ is FYI".
 * Degrades to "none active" when the latest window isn't current (the usual case on historical data).
 */
const clock = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const day = (ms: number): string => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
const barPct = (active: number, busiest: number): number => (busiest > 0 ? Math.max(4, Math.round((active / busiest) * 100)) : 4);

export function BillingWindows({ data }: { data: DashboardData }) {
  const bw = data.billing_windows;
  if (!bw) return null;

  const c = bw.current;
  const remainingMin = Math.max(0, (c.end_ms - bw.generated_at_ms) / 60_000);
  const pace = Math.min(100, Math.max(0, bw.pace_vs_busiest_pct));
  const asOf = fmtStamp(data.meta.generated_at);

  return (
    <Section title="5-hour windows" n="estimate">
      <div className="bw-grid">
        <div className="bw-stat">
          {c.is_active ? (
            <>
              <div className="bw-big">{mins(remainingMin)} left</div>
              <div className="bw-cap">current window — started {clock(c.start_ms)}, resets {clock(c.end_ms)} (as of {asOf})</div>
            </>
          ) : (
            <>
              <div className="bw-big">none active</div>
              <div className="bw-cap">last window {clock(c.start_ms)}–{clock(c.end_ms)}, {mins(c.active_min)} active — none active as of {asOf}</div>
            </>
          )}
        </div>
        <div className="bw-stat">
          <div className="bw-big">{pace}%</div>
          <div className="bw-cap">of your busiest window ({mins(bw.busiest.active_min)} active, {day(bw.busiest.start_ms)})</div>
        </div>
        <div className="bw-stat">
          <div className="bw-big">{bw.window_count}</div>
          <div className="bw-cap">5-hour windows used · {mins(bw.total_active_min)} active total</div>
        </div>
      </div>
      <div className="bw-bar" aria-hidden>
        <i style={{ width: `${pace}%`, background: "var(--amber)" }} />
      </div>
      <div className="bw-recent" aria-hidden>
        {bw.recent.map((w) => (
          <div className="bw-win" key={w.start_ms} title={`${day(w.start_ms)} ${clock(w.start_ms)}–${clock(w.end_ms)} · ${mins(w.active_min)} active · ${w.session_count} sessions · ${w.event_count} events`}>
            <div className="bw-win-bar"><i style={{ height: `${barPct(w.active_min, bw.busiest.active_min)}%` }} /></div>
            <div className="bw-win-lab">{mins(w.active_min)}</div>
          </div>
        ))}
      </div>
      <p className="bw-note">Shows activity, not % of any limit — your plan's window is shared across claude.ai, Desktop &amp; every device, so this is a lower bound. {bw.note}</p>
    </Section>
  );
}
