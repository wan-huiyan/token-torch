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
import { buildInsightsLLM, INSIGHTS_PROMPT_VERSION } from "./lib/insightsLlm";
import { insightsHash, readInsightsCache, writeInsightsCache } from "./lib/insightsCache";
import { validateInsightNumbers } from "./lib/insightsValidate";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const CORPUS_DIR = process.env.CORPUS_DIR ?? join(homedir(), ".claude", "usage-tracking");
const OUT_DIR = join(ROOT, "public", "data");
const CACHE_PATH = join(ROOT, ".cache", "ingest.json");
const INSIGHTS_CACHE_PATH = join(ROOT, ".cache", "insights.json");
const INSIGHTS_MODEL = "claude-opus-4-8";
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

  // (b) model_version coverage is INFORMATIONAL — a session with no real dominant id
  //     (all-synthetic assistant messages) is rare + honest; it lands in the "unknown"
  //     model bucket, never crashes the build (issue #14; portability — Plan 7).
  const noVersion = dashboard.sessions.filter((s) => !s.model_version);
  checks.push(
    `✓ model_version coverage: ${dashboard.sessions.length - noVersion.length}/${dashboard.sessions.length} ` +
      `sessions have a real dominant id` +
      (noVersion.length ? ` (${noVersion.length} all-synthetic → unknown bucket)` : ``),
  );

  // (b2) HARD guard (issue #14): a PRESENT model_version, and every model_versions key,
  //      must be a real claude-* id. This is the symmetric sink for the deriveModelVersion
  //      source filter — it fails LOUD if a synthetic id ever leaks to a session row.
  const synthDominant = dashboard.sessions.filter((s) => s.model_version && !/^claude-/.test(s.model_version));
  if (synthDominant.length)
    throw new Error(
      `${synthDominant.length} session(s) have a synthetic model_version ` +
        `(e.g. ${synthDominant[0].id}="${synthDominant[0].model_version}") — deriveModelVersion filter broke (#14)`,
    );
  const synthInMap = dashboard.sessions.filter((s) =>
    Object.keys(s.model_versions ?? {}).some((k) => !/^claude-/.test(k)),
  );
  if (synthInMap.length)
    throw new Error(
      `${synthInMap.length} session(s) have a synthetic id in model_versions ` +
        `(e.g. ${synthInMap[0].id}) — deriveModelVersion map filter broke (#14)`,
    );
  checks.push(
    `✓ model_version synthetic guard: 0 sessions expose a non-claude-* id (dominant or in map)`,
  );

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

  // ---- Plan 5: breakdown integrity + synthetic-absent ----
  // <synthetic> (and other non-real ids) must NOT appear in the model-mix legend
  // (the source filter renormalizes the kept shares). Every real model id is "claude-*".
  for (const id of Object.keys(dashboard.distributions.model_mix))
    if (!/^claude-/.test(id))
      throw new Error(`model_mix contains a non-real model id "${id}" — Plan 5 source filter broke`);
  // count mixed-version sessions (>1 real version) — excluded from model buckets, not dominant-bucketed.
  const realVers = (mv?: Record<string, number>) =>
    Object.keys(mv ?? {}).filter((k) => /^claude-/.test(k));
  const mixedVersion = dashboard.sessions.filter((s) => realVers(s.model_versions).length > 1).length;
  checks.push(
    `✓ breakdown integrity: model_mix has only claude-* ids; ` +
      `${dashboard.sessions.length - mixedVersion} single-version + ${mixedVersion} mixed (excluded from model buckets)`,
  );

  // ---- burn-tier band coverage (issue #6) ----
  // burnTier() falls back to the absolute {campfire:200, inferno:300} thresholds when no
  // bands are supplied (old-fixture back-compat). Unit tests pass explicit bands, so a
  // broken mapDashboard band-wiring would silently collapse every session to the bottom
  // tier (the issue #3 regression) with all unit tests still green. Assert the generator
  // emitted real distribution-relative bands. Symmetric to the `observed >= 1` tripwire.
  const bands = dashboard.meta.burn_bands;
  if (!bands) throw new Error("meta.burn_bands missing — burn-tier band wiring broken (issue #6)");
  if (!(bands.campfire <= bands.inferno))
    throw new Error(`meta.burn_bands not monotonic: campfire ${bands.campfire} > inferno ${bands.inferno}`);
  // On a non-degenerate corpus (>= 5 sessions, where computeBurnBands derives real
  // quantiles) the absolute {200,300} fallback means the relative computation silently
  // failed. A genuinely tiny corpus is allowed to use the fallback, so guard on count.
  if (dashboard.sessions.length >= 5 && bands.campfire === 200 && bands.inferno === 300)
    throw new Error(
      "meta.burn_bands collapsed to the absolute {200,300} fallback on a non-degenerate corpus " +
        "— distribution-relative band computation broke (issue #6 / regression of #3)",
    );
  // a sampled session-detail must mirror the global meta bands (they share one object).
  if (details.length && details[0].burn_bands) {
    const d0 = details[0].burn_bands;
    if (d0.campfire !== bands.campfire || d0.inferno !== bands.inferno)
      throw new Error(
        `detail[${details[0].id}].burn_bands {${d0.campfire},${d0.inferno}} != meta.burn_bands {${bands.campfire},${bands.inferno}}`,
      );
  }
  checks.push(
    `✓ burn_bands present & distribution-relative (campfire $${bands.campfire}, inferno $${bands.inferno})`,
  );

  // ---- Plan 8 / issue #10: context-overhead bound ----
  // PROVABLE: per session, the base-context floor re-read total cannot exceed the
  // input-side tokens that session actually paid for (fresh + cache_write + cache_read).
  // (scaffolding_tokens is a one-turn subset; floor*turns <= total cache_read <= input side.)
  let overheadSessions = 0;
  for (const d of details) {
    const co = d.context_overhead;
    if (!co) continue;
    overheadSessions++;
    const inputSide = d.tokens.fresh_input + d.tokens.cache_write + d.tokens.cache_read;
    if (co.reread_tokens > inputSide + 1)
      throw new Error(
        `[${d.id}] context-overhead reread_tokens ${co.reread_tokens} exceeds input-side tokens ${inputSide} — floor mis-derived`,
      );
    if (co.scaffolding_tokens > inputSide + 1)
      throw new Error(
        `[${d.id}] context-overhead scaffolding_tokens ${co.scaffolding_tokens} exceeds input-side tokens ${inputSide}`,
      );
  }
  if (overheadSessions) {
    // aggregate sanity: dashboard total reread_tokens == Σ per-session (no silent drop).
    const aggTok = details.reduce((s, d) => s + (d.context_overhead?.reread_tokens ?? 0), 0);
    if ((dashboard.totals.context_overhead?.reread_tokens ?? 0) !== aggTok)
      throw new Error(
        `context-overhead aggregate reread_tokens ${dashboard.totals.context_overhead?.reread_tokens} != Σ per-session ${aggTok}`,
      );
    checks.push(
      `✓ context-overhead bound holds for ${overheadSessions} session(s); ` +
        `aggregate re-read ${aggTok.toLocaleString()} tok ($${dashboard.totals.context_overhead?.reread_usd} est), ` +
        `overhead ${dashboard.totals.context_overhead?.overhead_pct_of_input}% of input`,
    );
  }

  // NO-FABRICATION: if the insights are LLM-written, every $/%/count in the prose
  // must trace to a dashboard-level aggregate (the honesty gate). Template path
  // (or null) is a no-op pass — templates only emit numbers from the same source.
  if (dashboard.insights_source === "llm" && dashboard.insights_md) {
    const { ok, offending } = validateInsightNumbers(dashboard.insights_md, dashboard);
    if (!ok)
      throw new Error(
        `LLM insights cite number(s) absent from the dashboard aggregates: ${offending.join(", ")} — no fabricated number may ship.`,
      );
    checks.push(`✓ LLM insights pass the no-fabrication check (every number traces to an aggregate)`);
  } else {
    checks.push(`✓ insights are template/none — no-fabrication check is a no-op`);
  }

  return checks;
}

async function main(): Promise<void> {
  const ingest = ingestSessions(undefined, CACHE_PATH);
  if (!ingest.records.length) {
    console.error("No JSONL sessions found under ~/.claude/projects. (Nothing to ingest.)");
    process.exit(1);
  }
  // cctime/usage-tracking corpus → reconciliation overlay (keyed by 8-char id).
  const overlay = new Map(loadCorpus(CORPUS_DIR).map((g) => [g.id, g]));

  const generatedAt = new Date().toISOString();
  const settingsFacts = readSettingsFacts();
  const floor = {
    discovered: ingest.discovered,
    kept: ingest.kept,
    droppedFloor: ingest.droppedFloor,
    droppedWithUsage: ingest.droppedWithUsage,
    droppedWithUsageUsd: ingest.droppedWithUsageUsd,
  };

  // First pass: template insights (also the grounding source for the LLM path).
  const base = mapDashboard(ingest.records, overlay, generatedAt, floor, undefined, settingsFacts);

  // LLM path is gated on the API key — offline/CI generate stays on templates.
  let llmInsightsMd: string | null = null;
  if (process.env.ANTHROPIC_API_KEY) {
    const hash = insightsHash(base.dashboard, INSIGHTS_MODEL, INSIGHTS_PROMPT_VERSION);
    const cached = readInsightsCache(INSIGHTS_CACHE_PATH, hash);
    if (cached) {
      llmInsightsMd = cached;
      console.log("Insights: cache hit (unchanged aggregates) — no API call.");
    } else {
      console.log("Insights: generating via Claude (no cache hit)…");
      llmInsightsMd = await buildInsightsLLM(base.dashboard);
      if (llmInsightsMd) {
        writeInsightsCache(INSIGHTS_CACHE_PATH, hash, llmInsightsMd);
        console.log("Insights: LLM-written + validated; cached.");
      }
      // null => buildInsightsLLM already logged the fallback; templates remain.
    }
  } else {
    console.log("Insights: no ANTHROPIC_API_KEY — using template insights.");
  }

  // Rebuild only if we have validated LLM prose; otherwise reuse the template pass.
  const { dashboard, details, subagentTiming } = llmInsightsMd
    ? mapDashboard(ingest.records, overlay, generatedAt, floor, undefined, settingsFacts, llmInsightsMd)
    : base;

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
