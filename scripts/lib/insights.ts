/* Heuristic flags + insights_md from the aggregated dashboard data.
 * These are generated commentary, clearly dated and hedged for small-N. */

import type { DashboardData, Flag, ProjectRow, SessionRow } from "../../src/types";

const usd = (v: number) => "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function buildFlags(
  totals: DashboardData["totals"],
  projects: ProjectRow[],
  sessions: SessionRow[],
): Flag[] {
  const flags: Flag[] = [];

  const mainLoop = sessions.filter((s) => s.fidelity === "main_loop");
  if (mainLoop.length) {
    // DISTINCT projects, capped — never dump every session's name (507 main-loop
    // sessions previously produced a 14k-char detail blob of repeated project names).
    const projs = [...new Set(mainLoop.map((s) => s.project))];
    const shown = projs.slice(0, 6).join(", ");
    const more = projs.length - 6;
    const projList = more > 0 ? `${shown}, +${more} more` : shown;
    flags.push({
      level: "warn",
      title: `${mainLoop.length} session${mainLoop.length > 1 ? "s" : ""} undercount${mainLoop.length > 1 ? "" : "s"} subagents`,
      detail: `Main-loop fidelity in ${projList} — subagent spend isn't counted, so real cost is higher than shown.`,
      metric: "fidelity",
    });
  }

  const top = projects[0];
  if (top && totals.cost_usd > 0) {
    const share = Math.round((top.cost_usd / totals.cost_usd) * 100);
    if (share >= 40) {
      flags.push({
        level: "info",
        title: `${top.name} is your biggest spend`,
        detail: `${share}% of total cost (${usd(top.cost_usd)}) across ${top.sessions} session${top.sessions > 1 ? "s" : ""}.`,
        metric: "concentration",
      });
    }
  }

  if (totals.avg_cache_hit_pct >= 95) {
    flags.push({
      level: "info",
      title: "Cache hygiene is excellent",
      detail: `Avg ${totals.avg_cache_hit_pct.toFixed(1)}% cache hit — you're not thrashing context.`,
      metric: "cache",
    });
  }

  return flags;
}

export function buildInsightsMd(
  generatedDate: string,
  totals: DashboardData["totals"],
  projects: ProjectRow[],
  smallN: boolean,
): string | null {
  const lines: string[] = [`**This week (auto-generated, ${generatedDate}):**`];
  const top = projects[0];
  if (top && totals.cost_usd > 0) {
    const share = Math.round((top.cost_usd / totals.cost_usd) * 100);
    lines.push(
      `- ${top.name} is ${share}% of your spend (${usd(top.cost_usd)} over ${top.sessions} session${top.sessions > 1 ? "s" : ""}, ~${usd(top.cost_per_session)} each)${share >= 50 ? " — your priciest project. Worth checking whether subagent fan-out is over-provisioned." : "."}`,
    );
  }
  if (totals.avg_cache_hit_pct >= 95) {
    lines.push(`- Cache hit is consistently high (avg ${totals.avg_cache_hit_pct.toFixed(0)}%); no action needed.`);
  }
  if (smallN) {
    lines.push(`- Only ${totals.sessions} sessions on record — not enough for trend claims yet. Check back after ~10.`);
  }
  return lines.length > 1 ? lines.join("\n") : null;
}
