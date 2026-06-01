import { useMemo, useState } from "react";
import type { DashboardData, SessionRow } from "../types";
import { usd, pct, num, fmtDate } from "./helpers";
import { searchSessions, paginate } from "./aggregate";
import { Section } from "./Section";
import { DataTierBadge } from "./DataTierBadge";

const PER_PAGE = 20;

/** The primary session surface: a searchable + paginated table. Each row links
 *  into the session detail and shows its data-tier provenance badge. */
export function SessionTable({
  data,
  onOpenSession,
}: {
  data: DashboardData;
  onOpenSession: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => searchSessions(data.sessions, q), [data.sessions, q]);
  // newest-first; q changes reset to page 1.
  const sorted = useMemo(
    () => filtered.slice().sort((a, b) => b.date.localeCompare(a.date) || b.cost_usd - a.cost_usd),
    [filtered],
  );
  const { slice, pages, page: cur } = paginate<SessionRow>(sorted, page, PER_PAGE);

  return (
    <Section title="Sessions" n={`${data.sessions.length} total · search + paginate`}>
      <div className="stable-controls">
        <input
          className="stable-search"
          type="search"
          placeholder="search id / project / model…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          aria-label="search sessions"
        />
        <span className="stable-count">
          {sorted.length} match{sorted.length === 1 ? "" : "es"}
        </span>
      </div>

      <div className="stable-wrap" role="region" aria-label="sessions table">
        <table className="stable">
          <thead>
            <tr>
              <th>Date</th>
              <th>Project</th>
              <th>Model</th>
              <th className="r">Cost</th>
              <th className="r">Active</th>
              <th className="r">Cache</th>
              <th>Tier</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {slice.map((s) => (
              <SRow key={s.id} s={s} onOpenSession={onOpenSession} />
            ))}
            {slice.length === 0 && (
              <tr><td colSpan={8} className="stable-empty">No sessions match &ldquo;{q}&rdquo;.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="stable-pager">
          <button type="button" disabled={cur <= 1} onClick={() => setPage(cur - 1)}>← prev</button>
          <span>page {cur} / {pages}</span>
          <button type="button" disabled={cur >= pages} onClick={() => setPage(cur + 1)}>next →</button>
        </div>
      )}
    </Section>
  );
}

/** Row sub-component — required so hooks (if any are ever added) aren't called inside .map(). */
function SRow({ s, onOpenSession }: { s: SessionRow; onOpenSession: (id: string) => void }) {
  return (
    <tr
      className="srow"
      onClick={() => onOpenSession(s.id)}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpenSession(s.id); }}
    >
      <td>{fmtDate(s.date)}</td>
      <td className="sp">{s.project}</td>
      <td className="sm">{s.model_version ?? s.model}</td>
      <td className="r">{usd(s.cost_usd)}</td>
      <td className="r">{num(s.active_min, 0)}m</td>
      <td className="r">{pct(s.cache_pct, 0)}</td>
      <td><DataTierBadge tier={s.data_tier} /></td>
      <td className="open">→</td>
    </tr>
  );
}
