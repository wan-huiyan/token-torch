#!/usr/bin/env tsx
/* ============================================================================
 * TOKEN TORCH data generator (JSONL-primary).
 *   reads  ~/.claude/projects/**\/<session-uuid>.jsonl  (raw transcripts; PRIMARY)
 *          ~/.claude/usage-tracking/*.json               (cctime overlay; reconcile-only)
 *   writes public/data/dashboard.json
 *          public/data/sessions/<id>.json
 *
 * Sessions are derived from raw main-loop transcripts (ingestSessions), priced
 * per-model from deduped top-level usage. The usage-tracking corpus is loaded as
 * a reconciliation OVERLAY (a session's own stored $ surfaced as a note when it
 * diverges) — never blended into the figures.
 *
 * Usage:
 *   npm run generate              # generate from the local transcripts
 *   npm run generate -- --verify  # generate + assert the honesty/contract invariants
 *   CORPUS_DIR=/path npm run generate
 * ========================================================================== */

import { mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCorpus, type SessionGroup } from "./lib/corpus";
import { ingestSessions, type IngestResult } from "./lib/ingest";
import { mapDashboard, type SubagentTimingCheck } from "./lib/mapDashboard";
import { INTERACTIVE_TOOLS } from "./lib/mapSessionDetail";
import type { DashboardData, SessionDetailData } from "../src/types";
import type { SettingsFacts } from "./lib/effort";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const CORPUS_DIR = process.env.CORPUS_DIR ?? join(homedir(), ".claude", "usage-tracking");
const OUT_DIR = join(ROOT, "public", "data");
const CACHE_PATH = join(ROOT, ".cache", "ingest.json");
const VERIFY = process.argv.includes("--verify");

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

/** Read the effort default + settings.json mtime ONCE (filesystem boundary kept here,
 *  so deriveEffort stays pure/testable). Returns nulls when unreadable → effort:"unknown". */
function readSettingsFacts(): SettingsFacts {
  try {
    const effort = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"))?.effortLevel ?? null;
    const settingsEffort = typeof effort === "string" ? effort : null;
    const settingsMtimeMs = statSync(SETTINGS_PATH).mtimeMs;
    return { settingsEffort, settingsMtimeMs };
  } catch {
    return { settingsEffort: null, settingsMtimeMs: null };
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/** Contract + honesty-rule invariants. Throws on violation. */
function verify(
  details: SessionDetailData[],
  dashboard: DashboardData,
  timingChecks: SubagentTimingCheck[],
  ingest: IngestResult,
  overlay: Map<string, SessionGroup>,
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

  // FLOOR ACCOUNTING: every discovered session is either kept or floored — no silent loss.
  // Under JSONL-primary, `dropped` (unmappable corpus records) is always [] since the
  // floor runs upstream in ingestSessions; we account for it via droppedFloor instead.
  if (ingest.kept + ingest.droppedFloor !== ingest.discovered)
    throw new Error(
      `floor accounting: kept ${ingest.kept} + floored ${ingest.droppedFloor} != discovered ${ingest.discovered}`,
    );
  // The emitted detail records must match the kept sessions.
  if (details.length !== ingest.kept)
    throw new Error(
      `floor accounting: ${details.length} session detail records emitted but ingest.kept=${ingest.kept}`,
    );
  checks.push(
    `✓ floor accounting: ${ingest.kept} kept + ${ingest.droppedFloor} floored == ${ingest.discovered} discovered`,
  );

  // cost_by_fidelity sums to the grand total.
  const fid = Math.round((dashboard.totals.cost_by_fidelity.high + dashboard.totals.cost_by_fidelity.main_loop) * 100);
  if (fid !== Math.round(dashboard.totals.cost_usd * 100))
    throw new Error(`cost_by_fidelity sums to $${fid / 100} != totals.cost_usd $${dashboard.totals.cost_usd}`);

  // complete_spend_usd == cost_usd + floored_usd (to the cent). The headline total
  // is COMPLETE; cost_usd stays the displayed-only figure the breakdowns key off.
  {
    const cs = Math.round((dashboard.totals.complete_spend_usd ?? 0) * 100);
    const expect = Math.round(dashboard.totals.cost_usd * 100) + Math.round((dashboard.totals.floored_usd ?? 0) * 100);
    if (cs !== expect)
      throw new Error(
        `complete_spend_usd $${cs / 100} != cost_usd + floored_usd $${expect / 100}`,
      );
    checks.push(
      `✓ complete_spend_usd $${dashboard.totals.complete_spend_usd} == cost_usd $${dashboard.totals.cost_usd} + floored_usd $${dashboard.totals.floored_usd}`,
    );
  }

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
  checks.push(
    `✓ per-model by_category sums to total_usd (check #1) for ${details.filter((d) => d.cost.by_category).length} sessions`,
  );

  // cctime-transition: log how many JSONL-derived totals differ >5% from the overlay
  // (expected: different extraction methods and pricing bases; not blended, just surfaced).
  let moved = 0;
  for (const d of details) {
    const ov = overlay.get(d.id);
    const ccCost =
      ov?.c?.cost_estimate_usd?.grand_total ?? ov?.a?.estimatedCostUsd ?? ov?.b?.grand_total?.cost_usd;
    if (ccCost != null && Math.abs(ccCost - d.cost.total_usd) / Math.max(ccCost, 1) > 0.05) moved++;
  }
  if (moved)
    console.log(
      `ℹ ${moved} session(s) differ >5% from their usage-tracking record (expected: JSONL vs cctime extraction differ; see Plan 2 calibration). Not blended.`,
    );

  // ---- Plan 3 slice-dimension coverage (spec §11) ----
  // (a) every kept session carries an EffortTag; log a source/confidence histogram.
  const effortHist = { observed: 0, inferred_high: 0, inferred_low: 0, unknown: 0 };
  for (const s of dashboard.sessions) {
    if (!s.effort)
      throw new Error(`[${s.id}] missing effort EffortTag (Plan 3 coverage)`);
    if (s.effort.source === "observed") effortHist.observed++;
    else if (s.effort.source === "unknown") effortHist.unknown++;
    else if (s.effort.confidence === "high") effortHist.inferred_high++;
    else effortHist.inferred_low++;
  }
  checks.push(
    `✓ effort coverage: all ${dashboard.sessions.length} sessions tagged ` +
      `(observed ${effortHist.observed}, inferred-high ${effortHist.inferred_high}, ` +
      `inferred-low ${effortHist.inferred_low}, unknown ${effortHist.unknown})`,
  );
  if (effortHist.observed < 1)
    throw new Error("no sessions have observed effort — /effort extraction likely broken (Plan 3)");

  // (b) every kept session carries a model_version.
  const noVersion = dashboard.sessions.filter((s) => !s.model_version);
  if (noVersion.length)
    throw new Error(
      `${noVersion.length} session(s) missing model_version (e.g. ${noVersion[0].id}) (Plan 3 coverage)`,
    );
  checks.push(`✓ model_version coverage: all ${dashboard.sessions.length} sessions have a dominant version id`);

  // (c) every kept session carries a data_tier.
  const noTier = dashboard.sessions.filter((s) => !s.data_tier);
  if (noTier.length)
    throw new Error(
      `${noTier.length} session(s) missing data_tier (e.g. ${noTier[0].id}) (Plan 3 coverage)`,
    );
  const enriched = dashboard.sessions.filter((s) => s.data_tier === "enriched").length;
  checks.push(
    `✓ data_tier coverage: all ${dashboard.sessions.length} sessions tiered (${enriched} enriched, ${dashboard.sessions.length - enriched} jsonl)`,
  );

  return checks;
}

function main(): void {
  const ingest = ingestSessions(undefined, CACHE_PATH);
  if (!ingest.records.length) {
    console.error("No JSONL sessions found under ~/.claude/projects. (Nothing to ingest.)");
    process.exit(1);
  }
  // cctime/usage-tracking corpus → reconciliation overlay (keyed by 8-char id).
  const overlay = new Map(loadCorpus(CORPUS_DIR).map((g) => [g.id, g]));

  const generatedAt = new Date().toISOString();
  const settingsFacts = readSettingsFacts();
  const { dashboard, details, subagentTiming } = mapDashboard(
    ingest.records,
    overlay,
    generatedAt,
    {
      discovered: ingest.discovered,
      kept: ingest.kept,
      droppedFloor: ingest.droppedFloor,
      droppedWithUsage: ingest.droppedWithUsage,
      droppedWithUsageUsd: ingest.droppedWithUsageUsd,
    },
    undefined,
    settingsFacts,
  );

  writeJson(join(OUT_DIR, "dashboard.json"), dashboard);
  for (const d of details) writeJson(join(OUT_DIR, "sessions", `${d.id}.json`), d);

  console.log(
    `Ingested: ${ingest.kept}/${ingest.discovered} sessions (floored ${ingest.droppedFloor}: <10 msgs or no usage; ` +
      `${ingest.droppedWithUsage} of those carried usage worth ~$${ingest.droppedWithUsageUsd})`,
  );
  console.log(`Overlay: ${overlay.size} cctime/usage-tracking record(s) from ${CORPUS_DIR}`);
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
    for (const line of verify(details, dashboard, subagentTiming.checks, ingest, overlay))
      console.log(line);
  }
}

main();
