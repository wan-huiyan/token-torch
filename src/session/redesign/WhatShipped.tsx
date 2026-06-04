/* ============================================================================
 * WhatShipped (redesign) — recreates 01-session-detail.html's "What shipped"
 * (.dsec + .shipgrid #shipped) and detail.js renderShipped, but PRs-as-hero:
 *   left  .shipcol.prpanel    — expandable PR cards (.prcard, click toggles .open)
 *   right .shipcol.otherpanel — ADRs / skills / unlinked reviews
 *
 * DATA + HONESTY are mined from src/session/Shipped.tsx (NOT the prototype's
 * seeded/fake PR/review/blurb arrays):
 *   - PRs/commits/skills/ADRs carry NO cost — only the title + a STATUS string
 *     (pr.meta = "merged"/"opened"); reviews carry a real "$X · Ym" meta.
 *   - Reviews already linked to a PR are nested in pr.reviews[]; top-level
 *     sh.reviews[] are the UNLINKED ones → they go to Other updates. Never pair
 *     reviews to PRs by index (the prototype does — that's fake).
 *   - Tallies count nested + top-level so they never undercount (the L9 fix).
 *   - Empty → an honest note (~2/3 of sessions have no extractable shipped).
 * Only classes that exist in redesign.css are used.
 * ========================================================================== */
import { useState } from "react";
import type { SessionDetailData, ShippedItem } from "../../types";

/** "merged" → lime badge, else plain "open". Mirrors Shipped.tsx metaTone. */
function isMerged(meta?: string): boolean {
  return !!meta && meta.toLowerCase().includes("merge");
}

/** Try to read a real "N caught"/"N issue(s)" count out of a review meta; the
 * live corpus never carries one, so this stays absent (errors-caught only when
 * real — the prototype's `errors` field is fabricated). */
function errorsCaught(meta?: string): number | null {
  if (!meta) return null;
  const m = meta.match(/(\d+)\s*(?:caught|issues?|errors?)/i);
  return m ? parseInt(m[1], 10) : null;
}

function countLabel(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

/* ---- one expandable PR card (visual = prototype .prcard, data = real) ---- */
function PrCard({ pr }: { pr: ShippedItem }) {
  const [open, setOpen] = useState(false);
  const merged = isMerged(pr.meta);
  const commits = pr.commits ?? [];
  const reviews = pr.reviews ?? [];
  // a single review chip on the meta line: real error count if present, else "reviewed"
  const firstErr = reviews.map((r) => errorsCaught(r.meta)).find((e) => e != null);
  const toggle = () => setOpen((o) => !o);
  return (
    <div
      className={`prcard${open ? " open" : ""}`}
      tabIndex={0}
      role="button"
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <div className="prtop">
        <div className="prtitle">{pr.title}</div>
        <span className="prchev">{"▾"}</span>
      </div>
      <div className="prmeta">
        {pr.ref ? <span className="ref">{pr.ref}</span> : null}
        {/* pr.meta is a STATUS string, NEVER a cost */}
        {merged ? <span className="merged">merged</span> : <span>open</span>}
        {commits.length ? <span className="commits">{countLabel(commits.length, "commit")}</span> : null}
        {reviews.length ? (
          firstErr != null ? (
            <span className="mrev ic">{firstErr} caught</span>
          ) : (
            <span className="mrev cl">reviewed</span>
          )
        ) : null}
      </div>
      <div className="prdetail">
        {commits.length ? (
          <div className="prdrow">
            <span className="prdk">Commits</span>
            <span>
              {/* plain subjects — no per-commit cost */}
              {commits.map((c, i) => (
                <span key={i}>
                  {i > 0 ? <br /> : null}
                  {c.title}
                </span>
              ))}
            </span>
          </div>
        ) : null}
        {reviews.map((r, i) => {
          const errs = errorsCaught(r.meta);
          return (
            <div className="prdrow" key={i}>
              <span className="prdk">Review</span>
              <span>
                {r.title}
                {errs != null ? (
                  <>
                    {" — "}
                    <b className="ic">{countLabel(errs, "issue")} caught</b>
                  </>
                ) : (
                  <>
                    {" — "}
                    <b className="cl">clean</b>
                  </>
                )}
                {/* the ONLY real per-item cost in the whole section */}
                {r.meta ? ` · ${r.meta}` : null}
              </span>
            </div>
          );
        })}
        <div className="prdrow">
          <span className="prdk">Status</span>
          <span>{merged ? "Merged to main" : "Open — awaiting merge"}</span>
        </div>
      </div>
    </div>
  );
}

export function WhatShipped({ data }: { data: SessionDetailData }) {
  const sh = data.shipped;
  const prs = sh?.prs ?? [];
  const topReviews = sh?.reviews ?? [];
  const adrs = sh?.adrs ?? [];
  const skills = sh?.skills ?? [];
  const topCommits = sh?.commits ?? [];

  // honest-empty: nothing the extractor could surface for this run
  const hasAnything =
    !!sh && (prs.length || topReviews.length || adrs.length || skills.length || topCommits.length);

  // L9 tallies: nested + top-level so the counts never silently undercount
  const nestedCommits = prs.reduce((n, p) => n + (p.commits?.length ?? 0), 0);
  const nestedReviews = prs.reduce((n, p) => n + (p.reviews?.length ?? 0), 0);
  const totalCommits = nestedCommits + topCommits.length;
  const totalReviews = nestedReviews + topReviews.length;
  const mergedN = prs.filter((p) => isMerged(p.meta)).length;
  // issues caught: summed only from review metas where a count is actually parseable
  const allReviews = [...topReviews, ...prs.flatMap((p) => p.reviews ?? [])];
  const issuesCaught = allReviews.reduce((n, r) => n + (errorsCaught(r.meta) ?? 0), 0);

  // stats line — omit segments with nothing to say (never print fabricated "0 issues")
  const stats: string[] = [];
  if (prs.length) {
    stats.push(
      `${countLabel(prs.length, "PR")}${mergedN === prs.length ? " merged" : ` (${mergedN} merged)`}`
    );
  }
  if (totalCommits) stats.push(countLabel(totalCommits, "commit"));
  if (totalReviews) stats.push(countLabel(totalReviews, "review"));
  if (issuesCaught > 0) stats.push(countLabel(issuesCaught, "issue") + " caught");

  // Other updates: ADRs, skills, and UNLINKED top-level reviews
  const other: Array<{ tag: string; cls: string; text: string }> = [
    ...adrs.map((a) => ({ tag: "ADR", cls: "adr", text: a.title })),
    ...skills.map((s) => ({ tag: "Skill", cls: "skill", text: s.title })),
    ...topReviews.map((r) => {
      const errs = errorsCaught(r.meta);
      return { tag: "Review", cls: "rev", text: r.title + (errs != null ? ` · ${errs} caught` : "") };
    }),
  ];

  return (
    <section className="dsec" id="shippedSec">
      <div className="dsec-head">
        <h2>What shipped</h2>
        <span className="ln" />
        <span className="n">outputs of this run</span>
      </div>

      {!hasAnything ? (
        <div className="shipgrid">
          <div className="shipcol otherpanel">
            <div className="oempty">
              Nothing recorded as shipped for this run — the what-shipped extractor only fires when
              subagent/PR logs are present (~1/3 of sessions).
            </div>
          </div>
        </div>
      ) : (
        <div className="shipgrid" id="shipped">
          <div className="shipcol prpanel">
            <h4>
              Pull requests <span className="c">{prs.length}</span>
            </h4>
            {prs.length ? (
              <>
                <div className="prstats">
                  {stats.map((s, i) => (
                    <span key={i}>
                      {i > 0 ? " · " : null}
                      <b>{s.split(" ")[0]}</b>
                      {" " + s.split(" ").slice(1).join(" ")}
                    </span>
                  ))}
                </div>
                <div className="prgrid">
                  {prs.map((pr, i) => (
                    <PrCard key={i} pr={pr} />
                  ))}
                </div>
              </>
            ) : (
              <div className="oempty">
                No pull requests on this run
                {totalCommits ? ` — ${countLabel(totalCommits, "direct commit")} to main.` : "."}
              </div>
            )}
          </div>

          <div className="shipcol otherpanel">
            <h4>
              Other updates <span className="c">{other.length}</span>
            </h4>
            {other.length ? (
              other.map((o, i) => (
                <div className="oitem" key={i}>
                  <span className={`otag ${o.cls}`}>{o.tag}</span>
                  <span>{o.text}</span>
                </div>
              ))
            ) : (
              <div className="oempty">No ADRs, skills, or standalone reviews this run.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
