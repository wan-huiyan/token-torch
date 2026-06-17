/* ============================================================================
 * TOKEN TORCH redesign — SESSIONS tab.
 * Recreates 00-dashboard.html `.tabpanel[data-panel=sessions]` (lines 129-139)
 * + dashboard.js renderSessions / cardA / tableRows / mountFlames. Binds the
 * REAL windowed SessionRow pool (useWindow) over the prototype's seeded-RNG fake.
 *
 * Honesty placement (chat-locked, reconciled against the prototype):
 *   CARDS  — tier pill (always) + a subtle "⚠ partial" flag ONLY when
 *            fidelity==="main_loop" (the undercount signal). NO session id,
 *            NO data-tier badge on cards. <Est/> on $, recon ⓘ, content visible
 *            at rest (useGrowWidth renders final width first).
 *   TABLE  — the data-tier badge relocates HERE (Fidelity column), STACKED with
 *            the Full/Partial fidelity badge so table-view users keep the same
 *            undercount signal the cards carry (no honesty regression).
 * ========================================================================== */
import { useMemo, useState } from "react";
import type { DashboardData, SessionRow } from "../../types";
import { useWindow } from "../useWindow";
import { tierOf, fmtMin } from "../windowAgg";
import { miniFlames } from "../spriteEngine";
import { Sprite } from "../Sprite";
import { searchSessions, prettyModel } from "../aggregate";
import { usd, num, pct, fmtDate, useGrowWidth } from "../helpers";
import { Cents, Est, FidelityBadge, ReconNote } from "./ui";
import { DataTierBadge } from "../DataTierBadge";

const FLAT_PAGE = 24; // "show more" increment, matches prototype
const GROUP_CAP = 6; // cards shown per project before "show all", matches prototype

type Group = "flat" | "project";
type View = "cards" | "table";

/* --- card clock: fmtClock + the start–end +Nd range (prototype lines 216-221).
 *     Omitted entirely when start_ts is absent (honest — never fabricate). --- */
function fmtClock(d: Date): string {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ap = h < 12 ? "am" : "pm";
  const hh = h % 12 || 12;
  return `${hh}:${m < 10 ? "0" : ""}${m}${ap}`;
}
function timeRange(s: SessionRow): string | null {
  if (!s.start_ts) return null;
  const start = new Date(s.start_ts);
  const end = new Date(start.getTime() + (s.active_min + s.idle_min) * 60000);
  const dd = Math.floor(
    (Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) -
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) /
      864e5,
  );
  return `${fmtClock(start)}–${fmtClock(end)}${dd > 0 ? ` +${dd}d` : ""}`;
}

/* --- the meta `.dt` line: date · time · model, with the recon ⓘ appended.
 *     Each segment drops out gracefully when its field is absent. --- */
function metaBits(s: SessionRow): string {
  const bits = [fmtDate(s.date)];
  const tr = timeRange(s);
  if (tr) bits.push(tr);
  bits.push(prettyModel(s.model_version ?? s.model));
  return bits.join(" · ");
}

/* ------------------------------------------------------------------ CARD --- */
function Card({ s, onOpen }: { s: SessionRow; onOpen: (id: string) => void }) {
  const ti = tierOf(s.cost_usd);
  const total = s.cost_main + s.cost_sub;
  const mPct = total ? (s.cost_main / total) * 100 : 100;
  const sPct = total ? (s.cost_sub / total) * 100 : 0;
  const mStyle = useGrowWidth(mPct);
  const sStyle = useGrowWidth(sPct);

  return (
    <button type="button" className={`cardA t-${ti.tier}`} onClick={() => onOpen(s.id)}>
      <div className="top">
        <div>
          <div className="pj">
            <Sprite className="flames-inline" mount={(host) => miniFlames(host, ti.flames, ti.tier)} />
            <span className="pjname">{s.project}</span>
          </div>
          <div className="dt">
            {metaBits(s)} <ReconNote note={s.reconciliation_note} />
          </div>
          {s.headline && (
            <div className="headline">
              {/* `headline` is the session's FIRST human prompt (a memory-aid), NOT a summary of
                  what it did — label it so the opening ask is never misread as the outcome.
                  `shipped_short` (below) carries what actually shipped. */}
              <span className="hlabel">first prompt</span> {s.headline}
              {s.shipped_short && (
                <>
                  {" · "}
                  <span className="hship">{s.shipped_short}</span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="badges">
          <span className="tier-pill">{ti.name}</span>
          {/* Partial-cost undercount flag — only when subagent spend wasn't counted. */}
          {s.fidelity === "main_loop" && (
            <span className="fidwrap" tabIndex={0}>
              <span className="badge ml">⚠ partial</span>
              <span className="fidtip amber">
                <span className="th">Partial cost · main-loop only</span>
                Subagent spend wasn't captured for this run, so the real cost is higher than shown.
              </span>
            </span>
          )}
        </div>
      </div>
      <div className="csec">
        <div className="ccost">
          <Cents v={s.cost_usd} />
        </div>
        <div className="splitbar">
          <i className="m" style={mStyle} />
          <i className="s" style={sStyle} />
        </div>
        <div className="split-leg">
          <span>
            main <b>{usd(s.cost_main)}</b>
          </span>
          <span>
            sub <b>{s.cost_sub ? usd(s.cost_sub) : "—"}</b>
          </span>
        </div>
      </div>
      <div className="grid2">
        <div className="mcell">
          <div className="ml-l">Active</div>
          <div className="ml-v act">{fmtMin(s.active_min)}</div>
        </div>
        <div className="mcell">
          <div className="ml-l">Idle</div>
          <div className="ml-v idle">{fmtMin(s.idle_min)}</div>
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
        <Est />
        <span className="open">drill in ▸</span>
      </div>
    </button>
  );
}

/* ----------------------------------------------------------------- TABLE --- */
function TableRow({ s, onOpen }: { s: SessionRow; onOpen: (id: string) => void }) {
  const ti = tierOf(s.cost_usd);
  const total = s.cost_main + s.cost_sub;
  const mPct = total ? (s.cost_main / total) * 100 : 100;
  const tr = timeRange(s);
  return (
    <tr
      className={`t-${ti.tier}`}
      onClick={() => onOpen(s.id)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(s.id);
      }}
    >
      <td className="tproj">
        <span className="tdot" />
        <Sprite className="tflame" mount={(host) => miniFlames(host, ti.flames, ti.tier)} />
        <span className="tpname">
          {s.project}
          <small>{ti.name}</small>
        </span>
      </td>
      <td className="trun">
        {s.headline ?? "—"}
        {s.shipped_short && <small>{s.shipped_short}</small>}
      </td>
      <td>
        {fmtDate(s.date)}
        {tr && <small>{tr}</small>}
      </td>
      <td>{prettyModel(s.model_version ?? s.model)}</td>
      <td className="num tcost">
        {usd(s.cost_usd)}
        <span className="tsplit">
          <i className="m" style={{ width: `${mPct}%` }} />
          <i className="s" style={{ width: `${100 - mPct}%` }} />
        </span>
        <small>
          m {usd(s.cost_main, false)} · s {s.cost_sub ? usd(s.cost_sub, false) : "—"}
        </small>
      </td>
      <td className="num act">{fmtMin(s.active_min)}</td>
      <td className="num idle">{fmtMin(s.idle_min)}</td>
      <td className="num">{pct(s.cache_pct, 1)}</td>
      <td className="num">{s.subagents}</td>
      {/* Fidelity column: data-tier badge (relocated from cards) + the Full/Partial
          undercount signal stacked, so table view keeps the cards' honesty. */}
      <td>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
          <FidelityBadge fidelity={s.fidelity} />
          <DataTierBadge tier={s.data_tier} />
        </span>
      </td>
    </tr>
  );
}

function SessionsTable({ rows, onOpen }: { rows: SessionRow[]; onOpen: (id: string) => void }) {
  return (
    <div className="tablewrap">
      <table className="ttable">
        <thead>
          <tr>
            <th>Project</th>
            <th>Run</th>
            <th>When</th>
            <th>Model</th>
            <th className="num">Cost</th>
            <th className="num">Active</th>
            <th className="num">Idle</th>
            <th className="num">Cache</th>
            <th className="num">Subs</th>
            <th>Fidelity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <TableRow key={s.id} s={s} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------- CARDS rendering --- */
function CardsFlat({
  rows,
  shown,
  onMore,
  onOpen,
}: {
  rows: SessionRow[];
  shown: number;
  onMore: () => void;
  onOpen: (id: string) => void;
}) {
  const slice = rows.slice(0, shown);
  return (
    <>
      <div className="cards">
        {slice.map((s) => (
          <Card key={s.id} s={s} onOpen={onOpen} />
        ))}
      </div>
      {rows.length > shown && (
        <div className="loadmore">
          <button type="button" onClick={onMore}>
            Show more runs — {num(rows.length - shown)} left
          </button>
        </div>
      )}
    </>
  );
}

interface ProjGroup {
  name: string;
  items: SessionRow[];
  cost: number;
}

function CardsGrouped({
  rows,
  windowCost,
  expanded,
  onExpand,
  onOpen,
}: {
  rows: SessionRow[];
  windowCost: number;
  expanded: Record<string, boolean>;
  onExpand: (name: string) => void;
  onOpen: (id: string) => void;
}) {
  // group by project; groups sorted by cost desc, sessions within newest-first.
  const groups = useMemo<ProjGroup[]>(() => {
    const m = new Map<string, SessionRow[]>();
    for (const s of rows) {
      const g = m.get(s.project);
      if (g) g.push(s);
      else m.set(s.project, [s]);
    }
    const arr = [...m.entries()].map(([name, items]) => ({
      name,
      items: items.slice().sort((a, b) => b.date.localeCompare(a.date) || b.cost_usd - a.cost_usd),
      cost: items.reduce((t, s) => t + s.cost_usd, 0),
    }));
    arr.sort((a, b) => b.cost - a.cost);
    return arr;
  }, [rows]);

  return (
    <>
      {groups.map((g) => {
        const cap = expanded[g.name] ? g.items.length : GROUP_CAP;
        return (
          <div className="sgroup" key={g.name}>
            <div className="pgh">
              <span className="pgh-n">{g.name}</span>
              <span className="pgh-m">
                {g.items.length} runs · {usd(g.cost, false)} ·{" "}
                {pct(windowCost ? (g.cost / windowCost) * 100 : 0, 0)} of window
              </span>
            </div>
            <div className="cards">
              {g.items.slice(0, cap).map((s) => (
                <Card key={s.id} s={s} onOpen={onOpen} />
              ))}
            </div>
            {g.items.length > cap && (
              <button type="button" className="grpmore" onClick={() => onExpand(g.name)}>
                show all {g.items.length} runs in {g.name} ▸
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ===================================================================== TAB == */
export function SessionsTab(_props: { data: DashboardData; onOpenSession: (id: string) => void }) {
  const { onOpenSession } = _props;
  const pool = useWindow().sessions;

  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<Group>("project"); // default: by project
  const [view, setView] = useState<View>("cards"); // default: cards
  const [shown, setShown] = useState(FLAT_PAGE);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Search filters the pool; flat view is newest-first (don't trust pool order).
  const filtered = useMemo(() => searchSessions(pool, search), [pool, search]);
  const flatSorted = useMemo(
    () => filtered.slice().sort((a, b) => b.date.localeCompare(a.date) || b.cost_usd - a.cost_usd),
    [filtered],
  );
  const windowCost = useMemo(() => filtered.reduce((t, s) => t + s.cost_usd, 0), [filtered]);

  const resetPaging = () => {
    setShown(FLAT_PAGE);
    setExpanded({});
  };

  return (
    <section className="tabpanel on" data-panel="sessions">
      <div className="sctrl">
        <div className="search">
          <span className="si">⌕</span>
          <input
            id="searchInput"
            type="text"
            placeholder="search project / id / model…"
            value={search}
            aria-label="search sessions"
            onChange={(e) => {
              setSearch(e.target.value);
              resetPaging();
            }}
          />
          {search && (
            <button
              type="button"
              className="sreset"
              aria-label="clear search"
              onClick={() => {
                setSearch("");
                resetPaging();
              }}
              style={{
                background: "none",
                border: 0,
                color: "var(--ink-faint)",
                cursor: "pointer",
                fontFamily: "var(--mono)",
              }}
            >
              ✕
            </button>
          )}
        </div>

        <span className="ctrl-lab">group</span>
        <div className="toggle" id="groupToggle">
          <button
            type="button"
            className={group === "flat" ? "on" : ""}
            onClick={() => {
              setGroup("flat");
              resetPaging();
            }}
          >
            Newest
          </button>
          <button
            type="button"
            className={group === "project" ? "on" : ""}
            onClick={() => {
              setGroup("project");
              resetPaging();
            }}
          >
            By project
          </button>
        </div>

        <span className="ctrl-lab">view</span>
        <div className="toggle" id="viewToggle">
          <button
            type="button"
            className={view === "cards" ? "on" : ""}
            onClick={() => {
              setView("cards");
              resetPaging();
            }}
          >
            ▦ Cards
          </button>
          <button
            type="button"
            className={view === "table" ? "on" : ""}
            onClick={() => {
              setView("table");
              resetPaging();
            }}
          >
            ≣ Table
          </button>
        </div>

        <span className="ctrl-lab" style={{ marginLeft: "auto" }}>
          <b style={{ color: "var(--ink-dim)" }}>{num(filtered.length)}</b> runs
        </span>
      </div>

      <div id="sessBody" data-tour="session-card">
        {filtered.length === 0 ? (
          <div
            style={{
              fontFamily: "var(--mono)",
              color: "var(--ink-faint)",
              padding: 40,
              textAlign: "center",
            }}
          >
            No sessions match — try a wider window or clearing the search.
          </div>
        ) : view === "table" ? (
          <SessionsTable rows={flatSorted} onOpen={onOpenSession} />
        ) : group === "project" ? (
          <CardsGrouped
            rows={filtered}
            windowCost={windowCost}
            expanded={expanded}
            onExpand={(name) => setExpanded((m) => ({ ...m, [name]: true }))}
            onOpen={onOpenSession}
          />
        ) : (
          <CardsFlat rows={flatSorted} shown={shown} onMore={() => setShown((n) => n + FLAT_PAGE)} onOpen={onOpenSession} />
        )}
      </div>
    </section>
  );
}
