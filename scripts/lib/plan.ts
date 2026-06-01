/* Opt-in plan-% config loader (B2). Mirrors projects.ts loadLocalAliases:
 * reads a gitignored scripts/lib/plan.local.json; absent → undefined (the
 * dashboard then omits the plan bar — no fabrication). Plan limits + reset
 * cadence are USER-SUPPLIED and unverified; the emitted block is tagged
 * [estimate] and the UI says so. We never hardcode a vendor's reset cadence. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DashboardData, SessionRow } from "../../src/types";

interface PlanLocal {
  tier: string;
  cycle_anchor: string; // ISO date
  cycle_days: number;
  limit_usd?: number;
}

/** Sum cost_usd of sessions whose date is within [anchor, anchor + cycle_days). */
function spendInCycle(sessions: SessionRow[], anchorIso: string, cycleDays: number): number {
  const anchor = new Date(anchorIso).getTime();
  const end = anchor + cycleDays * 86_400_000;
  const sum = sessions.reduce((t, s) => {
    const ts = new Date(s.date).getTime();
    return ts >= anchor && ts < end ? t + s.cost_usd : t;
  }, 0);
  return Math.round(sum * 100) / 100;
}

export function loadPlanConfig(sessions: SessionRow[]): DashboardData["plan"] | undefined {
  let cfg: PlanLocal;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    cfg = JSON.parse(readFileSync(join(here, "plan.local.json"), "utf8")) as PlanLocal;
  } catch {
    return undefined; // no local config — omit the bar
  }
  return {
    tier: cfg.tier,
    cycle_anchor: cfg.cycle_anchor,
    cycle_days: cfg.cycle_days,
    spend_usd: spendInCycle(sessions, cfg.cycle_anchor, cfg.cycle_days),
    limit_usd: cfg.limit_usd,
    note:
      "[estimate] Plan tier, cycle anchor, and limit are user-supplied and unverified; " +
      "reset cadence is not authoritative. Spend is summed from the dashboard sessions.",
  };
}
