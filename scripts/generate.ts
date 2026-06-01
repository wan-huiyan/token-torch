#!/usr/bin/env tsx
/* ============================================================================
 * TOKEN TORCH data generator.
 *   reads  ~/.claude/usage-tracking/*.json   (corpus; JSONL fallback stubbed)
 *   writes public/data/dashboard.json
 *          public/data/sessions/<id>.json
 *
 * Usage:
 *   npm run generate              # generate from the default corpus
 *   npm run generate -- --verify  # generate + assert the honesty/contract invariants
 *   CORPUS_DIR=/path npm run generate
 * ========================================================================== */

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCorpus } from "./lib/corpus";
import { mapDashboard, type SubagentTimingCheck } from "./lib/mapDashboard";
import { INTERACTIVE_TOOLS } from "./lib/mapSessionDetail";
import type { DashboardData, SessionDetailData } from "../src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const CORPUS_DIR = process.env.CORPUS_DIR ?? join(homedir(), ".claude", "usage-tracking");
const OUT_DIR = join(ROOT, "public", "data");
const VERIFY = process.argv.includes("--verify");

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/** Contract + honesty-rule invariants. Throws on violation. */
function verify(
  details: SessionDetailData[],
  dashboard: DashboardData,
  dropped: string[],
  corpusSessionCount: number,
  timingChecks: SubagentTimingCheck[],
): string[] {
  const checks: string[] = [];

  // subagent spans must fit inside the session's own wall-clock (small tolerance
  // for a background workflow finishing just after the main loop's last event).
  // A union that exceeds wall-clock means we matched the wrong session dir.
  for (const t of timingChecks) {
    if (t.unionMin > t.wallMin * 1.15 + 1)
      throw new Error(
        `[${t.id}] subagent span union ${t.unionMin}m exceeds wall-clock ${t.wallMin}m — likely wrong session dir / id collision`,
      );
  }
  if (timingChecks.length)
    checks.push(
      `✓ subagent spans within wall-clock for ${timingChecks.length} session(s); ` +
        `time_saved=${dashboard.totals.time_saved_min}m (${dashboard.totals.time_saved_hours}h)`,
    );

  // COVERAGE (the check whose absence let sessions vanish silently): every
  // distinct corpus session is either emitted or explicitly dropped-and-flagged.
  if (dashboard.meta.session_count + dropped.length !== corpusSessionCount)
    throw new Error(
      `coverage: ${dashboard.meta.session_count} emitted + ${dropped.length} dropped != ${corpusSessionCount} corpus sessions`,
    );
  const droppedFlagged = dashboard.flags.some((f) => f.metric === "coverage");
  if (dropped.length && !droppedFlagged)
    throw new Error(`coverage: ${dropped.length} sessions dropped but no coverage flag emitted`);
  checks.push(
    `✓ coverage: ${dashboard.meta.session_count}/${corpusSessionCount} sessions emitted` +
      (dropped.length ? `, ${dropped.length} dropped + flagged (${dropped.join(", ")})` : `, 0 dropped`),
  );

  // cost_by_fidelity sums to the grand total.
  const fid = Math.round((dashboard.totals.cost_by_fidelity.high + dashboard.totals.cost_by_fidelity.main_loop) * 100);
  if (fid !== Math.round(dashboard.totals.cost_usd * 100))
    throw new Error(`cost_by_fidelity sums to $${fid / 100} != totals.cost_usd $${dashboard.totals.cost_usd}`);

  for (const d of details) {
    // 1. by_category[*].usd sums to total_usd to the cent.
    if (d.cost.by_category) {
      const sum = Math.round(
        Object.values(d.cost.by_category).reduce((s, c) => s + c.usd, 0) * 100,
      );
      const tot = Math.round(d.cost.total_usd * 100);
      if (sum !== tot)
        throw new Error(`[${d.id}] by_category sums to $${sum / 100}, total_usd=$${tot / 100}`);
    }
    // 2. main_loop + subagent == total (to the cent).
    const ms = Math.round((d.cost.main_loop_usd + d.cost.subagent_usd) * 100);
    if (ms !== Math.round(d.cost.total_usd * 100))
      throw new Error(`[${d.id}] main+sub=$${ms / 100} != total=$${d.cost.total_usd}`);
    // 3. main_loop fidelity => subagent_usd == 0.
    if (d.fidelity === "main_loop" && d.cost.subagent_usd !== 0)
      throw new Error(`[${d.id}] main_loop fidelity but subagent_usd=$${d.cost.subagent_usd}`);
    // 4. interactive tools are tagged (so the UI can exclude them from machine time).
    for (const t of d.tool_time)
      if (INTERACTIVE_TOOLS.has(t.name) && !t.interactive)
        throw new Error(`[${d.id}] interactive tool ${t.name} not flagged`);
    // 5. active_breakdown sums to active_min (to 0.15 min) — ONLY when the
    //    breakdown was captured (all-zero => schema didn't record it; legitimate).
    const ab = d.time.active_breakdown;
    const abSum = ab.thinking_min + ab.tool_min + ab.subagent_min + ab.planning_min;
    if (abSum > 0 && Math.abs(abSum - d.time.active_min) > 0.15)
      throw new Error(`[${d.id}] active_breakdown ${abSum.toFixed(2)} != active_min ${d.time.active_min}`);
    // 6. subagents_per_dispatch (when present) sums to subagent_usd (to the cent).
    if (d.cost.subagents_per_dispatch.length) {
      const sum = Math.round(d.cost.subagents_per_dispatch.reduce((s, x) => s + x.usd, 0) * 100);
      if (Math.abs(sum - Math.round(d.cost.subagent_usd * 100)) > 1)
        throw new Error(`[${d.id}] per-dispatch sums to $${sum / 100} != subagent_usd $${d.cost.subagent_usd}`);
    }
  }
  checks.push(`✓ ${details.length} session details pass cost/fidelity/interactive/time invariants`);
  return checks;
}

function main(): void {
  const groups = loadCorpus(CORPUS_DIR);
  if (!groups.length) {
    console.error(`No corpus records found in ${CORPUS_DIR}. (Set CORPUS_DIR to override.)`);
    process.exit(1);
  }
  const generatedAt = new Date().toISOString();
  const { dashboard, details, dropped, subagentTiming } = mapDashboard(groups, generatedAt);

  writeJson(join(OUT_DIR, "dashboard.json"), dashboard);
  for (const d of details) writeJson(join(OUT_DIR, "sessions", `${d.id}.json`), d);

  console.log(`Corpus: ${CORPUS_DIR}`);
  if (dropped.length)
    console.warn(`⚠ ${dropped.length} session(s) unparsed & flagged: ${dropped.join(", ")}`);
  console.log(
    `Wrote dashboard.json (${dashboard.meta.session_count} sessions, ${dashboard.meta.file_count} files, ` +
      `${dashboard.meta.project_count} projects, $${dashboard.totals.cost_usd}) + ${details.length} session files → ${OUT_DIR}`,
  );
  console.log(
    `Fidelity: ${dashboard.sessions.filter((s) => s.fidelity === "high").length} high / ` +
      `${dashboard.sessions.filter((s) => s.fidelity === "main_loop").length} main-loop`,
  );
  console.log(
    `Time saved (parallel subagents): ${dashboard.totals.time_saved_hours}h ` +
      `[${subagentTiming.covered.length}/${subagentTiming.sessionsWithSubagents.length} subagent sessions covered]`,
  );

  if (VERIFY) {
    for (const line of verify(details, dashboard, dropped, groups.length, subagentTiming.checks))
      console.log(line);
  }
}

main();
