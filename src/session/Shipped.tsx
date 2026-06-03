/* ============================================================================
 * Shipped — "what shipped" (a session scoreboard + PRs / reviews / ADRs / skills
 * / commits). Hidden entirely when data.shipped is absent or has no non-empty
 * groups (graceful degradation, matches the prototype). The scoreboard band at
 * the top shows REAL session-level totals (cost/time/tokens/files + group
 * counts); per-item cost is shown ONLY for reviews, which carry a real meta
 * cost+time chip. PRs/skills/ADRs/commits never get fabricated cost.
 * ========================================================================== */
import type { SessionDetailData, ShippedItem } from "../types";
import { Section } from "./Section";
import { abbr, mins, num, usd } from "./helpers";

/** Lime "merged" / amber "opened" / dim fallback PR-status badge. */
function metaTone(meta?: string): "merged" | "opened" | "neutral" {
  if (!meta) return "neutral";
  const m = meta.toLowerCase();
  if (m.includes("merge")) return "merged";
  if (m.includes("open")) return "opened";
  return "neutral";
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="sb-tile">
      <div className="sb-tl">{label}</div>
      <div className="sb-tv" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub ? <div className="sb-ts">{sub}</div> : null}
    </div>
  );
}

function Scoreboard({ data }: { data: SessionDetailData }) {
  const sh = data.shipped!;
  const c = data.cost;
  const t = data.time;
  const prs = sh.prs?.length ?? 0;
  // L9 guard: PR-linked reviews now nest under sh.prs[i].reviews — sum nested +
  // unlinked so the tally never silently undercounts (filter-moved-upstream trap).
  const reviews =
    (sh.reviews?.length ?? 0) +
    (sh.prs?.reduce((n, p) => n + (p.reviews?.length ?? 0), 0) ?? 0);
  const skills = sh.skills?.length ?? 0;
  return (
    <div className="scoreboard">
      <Tile
        label="cost · est."
        value={usd(c.total_usd, false)}
        sub={`${usd(c.main_loop_usd, false)} main · ${usd(c.subagent_usd, false)} sub`}
        accent="var(--cyan)"
      />
      <Tile label="active time" value={mins(t.active_min)} sub={`${mins(t.wall_clock_min)} wall-clock`} accent="var(--lime)" />
      <Tile label="tokens" value={abbr(data.tokens.total)} sub={`${num(data.cache_pct, 0)}% cache hit`} />
      {sh.files_touched != null ? <Tile label="files touched" value={num(sh.files_touched)} /> : null}
      <Tile label="PRs · reviews · skills" value={`${prs} · ${reviews} · ${skills}`} accent="var(--magenta)" />
    </div>
  );
}

function ItemRow({ it, showCost }: { it: ShippedItem; showCost?: boolean }) {
  const tone = metaTone(it.meta);
  return (
    <li>
      <span className="tick">▸</span>
      <div className="ib">
        <div className="it">
          <span className="title">{it.title}</span>
          {it.ref ? <span className="ref">{it.ref}</span> : null}
          {/* PR-style status badge (merged/opened) — only when not a cost chip */}
          {it.meta && !showCost ? <span className={`badge ${tone}`}>{it.meta}</span> : null}
        </div>
        {/* reviews carry a REAL per-item cost+time chip */}
        {it.meta && showCost ? <span className="costchip">{it.meta}</span> : null}
      </div>
    </li>
  );
}

/* A PR renders as an expandable row: the summary shows title + ref + a
 * status badge (merged/opened) and NEVER a cost; the expanded body lists its
 * nested commits (plain bullets) and reviews ($/time chips). A PR with no
 * nested children renders as a flat row (old flat-`prs` fixtures still work). */
function PrRow({ pr }: { pr: ShippedItem }) {
  const tone = metaTone(pr.meta);
  const hasChildren = (pr.commits?.length ?? 0) + (pr.reviews?.length ?? 0) > 0;
  const head = (
    <span className="it">
      <span className="title">{pr.title}</span>
      {pr.ref ? <span className="ref">{pr.ref}</span> : null}
      {pr.meta ? <span className={`badge ${tone}`}>{pr.meta}</span> : null}
    </span>
  );
  if (!hasChildren) return <li className="prrow flat">{head}</li>;
  return (
    <li className="prrow">
      <details>
        <summary>{head}</summary>
        <div className="prkids">
          {pr.commits?.length ? (
            <ul className="kid commits">
              {pr.commits.map((c, i) => (
                <li key={i}>
                  <span className="tick">·</span>
                  {c.title}
                </li>
              ))}
            </ul>
          ) : null}
          {pr.reviews?.length ? (
            <ul className="kid reviews">
              {pr.reviews.map((r, i) => (
                <li key={i}>
                  <span className="tick">✓</span>
                  <span className="title">{r.title}</span>
                  {r.meta ? <span className="costchip">{r.meta}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function Card({
  title,
  items,
  variant,
  showCost,
  collapseAfter,
}: {
  title: string;
  items?: ShippedItem[];
  variant?: string;
  showCost?: boolean;
  collapseAfter?: number;
}) {
  if (!items || !items.length) return null;
  const visible = collapseAfter && items.length > collapseAfter ? items.slice(0, collapseAfter) : items;
  const hidden = items.length - visible.length;
  return (
    <div className={`panel shipcard${variant ? " " + variant : ""}`}>
      <h4>
        {title}
        <span className="ct">{items.length}</span>
      </h4>
      <ul>
        {visible.map((it, i) => (
          <ItemRow key={i} it={it} showCost={showCost} />
        ))}
      </ul>
      {hidden > 0 ? <div className="more">+{hidden} more</div> : null}
    </div>
  );
}

export function Shipped({ data }: { data: SessionDetailData }) {
  const sh = data.shipped;
  if (!sh) return null;
  const groups: ShippedItem[][] = [sh.prs, sh.reviews, sh.adrs, sh.skills, sh.commits].filter(
    (g): g is ShippedItem[] => !!g && g.length > 0
  );
  if (!groups.length) return null;

  return (
    <Section title="What shipped" n="outputs of this run">
      <Scoreboard data={data} />
      <div className="shipgrid">
        {/* PRs are the headline — first + spanning; commits + reviews fold INSIDE each PR */}
        {sh.prs && sh.prs.length ? (
          <div className="panel shipcard hero">
            <h4>
              Pull requests
              <span className="ct">{sh.prs.length}</span>
            </h4>
            <ul className="prlist">
              {sh.prs.map((pr, i) => (
                <PrRow key={i} pr={pr} />
              ))}
            </ul>
          </div>
        ) : null}
        <Card title="Reviews" items={sh.reviews} variant="reviews" showCost />
        <Card title="ADRs" items={sh.adrs} />
        <Card title="Skills" items={sh.skills} variant="skills" />
        <Card title="Direct commits" items={sh.commits} variant="commits" collapseAfter={6} />
      </div>
    </Section>
  );
}
