/* ============================================================================
 * TOKEN TORCH — DATA contract (the integration point)
 * Ported verbatim from the design handoff's data.d.ts. The entire UI renders
 * from these objects; the data generator (scripts/) emits them from real
 * Claude Code session logs. Costs/tokens/minutes are MEASURED; a few
 * within-session splits are estimates (see README "Honesty rules").
 * ========================================================================== */

export type Fidelity = "high" | "main_loop";
export type Model = "opus" | "sonnet" | "haiku" | (string & {});

/* ------------------------- Slice dimensions (Plan 3) ----------------------- */

/** Versioned model identity. OPEN enum (back-compat with `Model`); pricing.ts keeps
 *  its own CLOSED ModelFamily — these are intentionally separate modules. */
export type ModelFamily = "opus" | "sonnet" | "haiku" | (string & {});
export interface ModelVersion {
  id: string; // raw transcript id, e.g. "claude-opus-4-8"
  family: ModelFamily; // "opus"
  label: string; // display, e.g. "Opus 4.8"
}

/** Effort, with provenance so inference is never passed off as ground truth. */
export type EffortValue = "low" | "medium" | "high" | "xhigh" | "max" | "ultracode" | "unknown" | (string & {});
export type EffortSource = "observed" | "inferred_default" | "unknown";
export interface EffortTag {
  value: EffortValue;
  source: EffortSource; // observed = /effort marker in transcript; inferred = config default at session time
  modifiers?: string[]; // e.g. ["fast"], ["1m"]
  confidence: "high" | "low"; // low when an inferred session predates the settings.json mtime cutoff (§7)
}

/** Distribution-relative burn-tier cutoffs ($), computed at generate-time. */
export interface BurnBands {
  campfire: number;
  inferno: number;
}

/** Fixed base-context cost: the system prompt + tool/skill catalog (+ earliest
 *  cached conversation) re-read into every turn and every subagent dispatch.
 *  Always an ESTIMATE (cache-read floor; understates after TTL re-writes, and is
 *  blind to deferred-tool-loading re-writes). The UI tags it [estimate]. In DOLLARS the
 *  floor is a SMALL fixed slice (cache reads are ~10× cheaper than fresh) — NOT "the main
 *  waste". The redesign panel additionally surfaces the TOKEN-ratio view (reread_tokens /
 *  input_fresh — a large multiple, computed live and drifting as the corpus grows =
 *  "the hidden bulk"); both are honest. See the S12 reframe in
 *  docs/calibration/2026-06-03-context-overhead-calibration.md. */
export interface ContextOverhead {
  scaffolding_tokens: number;          // base context re-read each turn (min nonzero cache_read)
  reread_tokens: number;               // scaffolding_tokens * turns (main loop) — ESTIMATE
  reread_usd: number;                  // reread_tokens priced at the cache_read rate (per-model)
  overhead_pct_of_input: number;       // 0–100: reread_tokens / total input-side tokens (fresh+cw+cr)
  subagent_scaffolding_tokens: number; // Σ per-dispatch base-context floor across subagents (the N× story; 0 if none)
  turns: number;                       // turns that re-read the prefix
  note: string;                        // explicit estimate/scope caveat copy
  /** S11 — optional/additive. What the re-read tokens WOULD have cost at the
   *  fresh-input rate MINUS what they cost at the cache-read rate (per-model where
   *  possible): the honest "$ saved vs paying fresh". ESTIMATE. Absent on older fixtures. */
  reread_saved_usd?: number;
}

/** A curated annotation (a known event date) on the savings chart — not a data point. */
export interface CatalogFlipMarker {
  date: string;  // ISO day
  label: string; // e.g. "404-trap flip"
}

/** context-police "tokens saved over time" — additive/optional (absent on older data → panel hidden).
 *  All-time per-day series (not windowed, mirroring the OverheadPanel precedent). ESTIMATE. */
export interface CatalogSavings {
  daily: { date: string; est_saving_tokens: number; observed_floor: number }[];
  snapshot_count: number;        // distinct snapshot days captured so far (the forward series needs >= 2)
  cumulative_tokens: number;     // Σ est_saving_tokens since the first snapshot
  hidden_count: number;          // latest snapshot
  total_skills: number;          // latest snapshot
  per_injection_tokens: number;  // latest snapshot (bare-name floor of hidden skills)
  est_usd: number;               // cumulative_tokens priced at the cache-read rate (cache reads are the cheapest tier)
  flip_marker?: CatalogFlipMarker;
  note: string;                  // honest caveat copy
}

/* ----------------------------- Dashboard ----------------------------------- */

export interface DashboardData {
  meta: {
    generated_at: string; // ISO 8601
    schema_version: string; // e.g. "tracker-1.0"
    session_count: number;
    file_count: number;
    project_count: number;
    date_range: { from: string; to: string }; // ISO dates
    /** true → do NOT present trend lines as real; show "sample only" state */
    small_n: boolean;
    fidelity_note: string;
    /** distribution-relative burn-tier cutoffs ($) for the session cards.
     *  Optional for back-compat with older fixtures (absent → absolute defaults). */
    burn_bands?: BurnBands;
    /** substance-floor accounting: sessions excluded upstream (count + excluded $).
     *  Surfaced so the headline total's exclusions are never silent. Optional for
     *  back-compat with older fixtures. */
    floor?: {
      discovered: number;
      kept: number;
      dropped: number;
      dropped_with_usage: number;
      dropped_with_usage_usd: number;
    };
  };
  totals: {
    cost_usd: number; // displayed (kept) sessions only — all per-session/project/fidelity breakdowns key off this
    /** floored usage-bearing $ excluded from the per-session list (floor.dropped_with_usage_usd).
     *  Optional for back-compat with older fixtures. */
    floored_usd?: number;
    /** complete spend = cost_usd + floored_usd (headline total). Optional for back-compat. */
    complete_spend_usd?: number;
    cost_by_fidelity: { high: number; main_loop: number }; // sums ~ cost_usd
    active_minutes: number;
    active_hours: number;
    idle_minutes: number;
    idle_hours: number;
    sessions: number;
    subagent_dispatches: number;
    cost_per_active_min: number;
    avg_cache_hit_pct: number; // 0–100
    tokens: {
      input_fresh: number; cache_read: number; output: number;
      /** S11 — optional/additive. Σ corpus tokens (input_fresh+cache_read+output).
       *  Absent on older fixtures. */
      total?: number;
    };
    time_saved_min: number; // est. wall-clock saved by parallel subagents
    time_saved_hours: number;
    /** Plan 8 / issue #10 — optional + additive; absent on older fixtures (panel hidden). */
    context_overhead?: ContextOverhead;
  };
  projects: ProjectRow[]; // pre-sorted by cost desc (powers the podium)
  timeline: TimelinePoint[];
  sessions: SessionRow[];
  distributions: {
    model_mix: Record<string, number>; // model -> percent
    tools_aggregate: Record<string, number>; // tool name -> call count
    time_split: { active_min: number; idle_min: number };
  };
  flags: Flag[];
  insights_md: string | null; // markdown (bold + "- " bullets); null -> placeholder
  /** Provenance of `insights_md`: "agent" => written by the user's own agent session
   *  (validated server-side, #33), "llm" => model-written at generate time via the API,
   *  "template" => the hard-coded threshold fallback. Optional + additive: absent on older
   *  fixtures renders exactly as before (no tag). */
  insights_source?: "agent" | "llm" | "template";
  /** OPT-IN plan-% headroom (B2). Present ONLY when a gitignored
   *  scripts/lib/plan.local.json was found at generate-time. Always an
   *  ESTIMATE (plan limits + reset cadence are user-supplied, not authoritative):
   *  the UI tags it [estimate]. Absent → the bar is not rendered (no fabrication). */
  plan?: {
    tier: string;            // user-supplied label, e.g. "Max 20x" — NOT verified
    cycle_anchor: string;    // ISO date the current cycle started (user-supplied)
    cycle_days: number;      // cycle length in days (user-supplied; e.g. 30)
    spend_usd: number;       // cost in the current cycle window (derived from sessions[])
    limit_usd?: number;      // optional user-supplied $ cap for the cycle
    note: string;            // explicit unverified/estimate caveat copy
  };
  /** context-police savings over time — optional/additive (panel hidden when absent). */
  catalog_savings?: CatalogSavings;
  /** #72 — optional/additive. Corpus-wide "mistakes caught by reviews" coverage for
   *  the Build Streak calendar's 2nd stat. A HIGH-PRECISION FLOOR: confirmed counts
   *  only severity-tagged findings in reviews' final verdicts; most reviews write
   *  findings as prose and are `unknown` (reviews_total − reviews_parsed). */
  review_findings?: ReviewFindingsSummary;
  /** #75 — optional/additive. "What's driving your usage" characteristics (mirrors the
   *  native /usage breakdown). Independent characteristics, NOT a sum-to-100 breakdown;
   *  per-skill/MCP attribution is unknown. Panel hidden when absent. */
  usage_diagnostics?: UsageDiagnostics;
}

export interface ReviewFindingsSummary {
  confirmed_total: number;       // Σ confirmed findings across sessions
  sessions_with_findings: number; // sessions carrying ≥1 confirmed finding
  reviews_parsed: number;        // foreground reviews that yielded a tagged count
  reviews_total: number;         // foreground reviews ATTEMPTED (the honest coverage denominator)
  reviews_panel: number;         // panel per-reviewer transcripts excluded (adjudicated elsewhere)
  note: string;                  // explicit high-precision-floor / partial-coverage caveat
}

export interface UsageDriver {
  key: "subagents" | "heavy_context" | "parallel" | "attribution";
  label: string;
  share_pct: number | null;      // % for this characteristic; null = genuinely UNKNOWN (never faked)
  detail: string;                // plain-English measured detail (carries the real numbers)
  nudge: string;                 // an action you can take (native-/usage nudge style)
}

export interface UsageDiagnostics {
  drivers: UsageDriver[];
  peak_concurrency: number;        // max simultaneous active sessions (gap-capped)
  parallel_threshold: number;      // the "heavily parallel" cutoff (e.g. 4)
  heavy_context_threshold: number; // the "large context" cutoff in tokens (e.g. 150000)
  note: string;                    // local-only undercount + characteristics-not-breakdown caveat
}

export interface ProjectRow {
  name: string;
  cost_usd: number;
  sessions: number;
  active_min: number;
  cost_share: number; // 0–1
  cost_per_session: number;
}

export interface TimelinePoint {
  date: string; // ISO date
  cost_usd: number;
  sessions: number;
  active_min: number;
}

export interface SessionRow {
  id: string;
  date: string; // ISO date
  project: string;
  cost_usd: number;
  cost_main: number; // main-loop portion
  cost_sub: number; // subagent portion (0 if none / uncounted)
  active_min: number;
  idle_min: number;
  cache_pct: number; // 0–100
  subagents: number;
  model: Model;
  fidelity: Fidelity; // "main_loop" => show amber badge
  reconciliation_note?: string; // optional ⓘ note when records disagreed
  /** Plan 3 slice dimensions — all optional → additive; old fixtures stay valid. */
  model_version?: string; // dominant raw version id, e.g. "claude-opus-4-8"
  model_versions?: Record<string, number>; // per-version assistant-message share (mixed sessions)
  effort?: EffortTag;
  data_tier?: "enriched" | "jsonl" | "thin"; // provenance of this row's numbers (drives a badge)
  top_tools: Record<string, number>;
  detail_href: string; // e.g. "sessions/<id>.html" or route "/sessions/:id"
  /** Plan 8 / issue #10 — optional + additive; absent on older fixtures (panel hidden). */
  context_overhead?: ContextOverhead;
  /** Plan 5 — optional + additive; output tokens this session (= detail.tokens.output). */
  out_tokens?: number;
  /** Plan 5 — optional + additive; parallel-subagent time saved this session (min). */
  time_saved_min?: number;
  /** S11 — optional/additive. ISO start timestamp (serialized startedAtMs) — powers
   *  the punchcard + card clock. Absent when the session had no timestamped event. */
  start_ts?: string;
  /** S11 — optional/additive. First real human prompt (trimmed ~120 chars) — card
   *  memory-aid. Absent when no human prompt was found (honest). */
  headline?: string;
  /** S11 — optional/additive. Short "what shipped" summary (e.g. "3 PRs · 2 reviews").
   *  Present ONLY when extractShipped produced a Shipped for this session (honest omit). */
  shipped_short?: string;
  /** #2 — optional/additive. Total count of real shipped outputs (PRs + nested commits +
   *  nested/top-level reviews + direct commits + skills + ADRs) for the what-shipped
   *  contribution calendar. Present ⟺ shipped_short present (both from extractShipped). */
  shipped_count?: number;
  /** #72 — optional/additive. Confirmed "mistakes caught by reviews" this session:
   *  Σ severity-tagged findings in this session's reviews' final verdicts (a HIGH-
   *  PRECISION FLOOR — prose-only reviews + panel reviewers are unknown, never 0).
   *  Present ONLY when ≥1 confirmed finding was counted (honest omit elsewhere). */
  mistakes_caught?: number;
  /** S11 — optional/additive. Real per-session time-phase split (minutes of ACTIVE
   *  wall-clock) for the dashboard phase donut. Absent on older fixtures. */
  active_breakdown?: { thinking_min: number; tool_min: number; subagent_min: number; planning_min: number };
}

export interface Flag {
  level: "warn" | "info";
  title: string;
  detail: string;
  metric: string;
}

/* --------------------------- Session detail -------------------------------- */

export type Phase = "thinking" | "tool" | "subagent" | "planning" | "idle" | "wait";

export interface SessionDetailData {
  id: string;
  date: string;
  project: string;
  cost_usd: number;
  model: Model;
  fidelity: Fidelity;
  cache_pct: number;
  /** GLOBAL distribution-relative burn-tier cutoffs ($) so the single-session
   *  detail page tiers relative to the whole corpus. Optional for back-compat. */
  burn_bands?: BurnBands;

  time: {
    wall_clock_min: number;
    active_min: number;
    idle_min: number; // "you away" — costs nothing
    wait_min: number; // short between-turn waits
    active_breakdown: {
      // shares of ACTIVE minutes, not wall-clock
      thinking_min: number;
      tool_min: number;
      subagent_min: number;
      planning_min: number;
    };
    method_note: string; // e.g. gaps >120s counted as you-away (heuristic)
  };

  /** Ordered; can be hundreds of entries. Empty/absent => hide ribbon/leaderboard/pulse. */
  timeline_segments: TimelineSegment[];

  tool_time: ToolTime[];
  turns: Turn[];

  tokens: {
    fresh_input: number;
    output: number;
    cache_write: number;
    cache_read: number;
    total: number;
    cache_hit_pct: number;
  };

  cost: {
    total_usd: number;
    main_loop_usd: number;
    subagent_usd: number; // 0 => hide main/sub donut, show "no subagents" note
    /** absent => hide inversion + waterfall, show "not captured" note.
     *  by_category[*].usd must sum to total_usd to the cent. */
    by_category?: Record<CostCategory, CostCategoryDetail>;
    cache_savings_usd: number; // what cache reads would've cost at fresh-input rate
    cache_write_premium_usd: number;
    blended_per_mtok_usd: number;
    pricing_basis: string; // footnote; costs are an estimate
    /** what?/span_min are best-available enrichments from the JSONL fallback (optional) */
    subagents_per_dispatch: { id: string; usd: number; what?: string; span_min?: number }[];
  };

  shipped?: Shipped; // optional "what shipped" section
  reconciliation_note?: string; // ⓘ note when the overlay record disagreed with recomputed cost
  /** Plan 3 slice dimensions — optional/additive, mirror SessionRow. */
  model_version?: string;
  effort?: EffortTag;
  data_tier?: "enriched" | "jsonl" | "thin";
  /** Plan 8 / issue #10 — optional + additive; absent on older fixtures (panel hidden). */
  context_overhead?: ContextOverhead;
  /** #52 — optional + additive. AI-written one-sentence Takeaway for this session, baked at
   *  generate-time via the keyless agent handshake and re-validated against THIS session's own
   *  number whitelist. Absent => Takeaway.tsx renders the deterministic template (honest fallback). */
  takeaway_md?: string | null;
  /** #52 — provenance of `takeaway_md`: "agent" (the user's own agent wrote it) / "llm" / "template".
   *  Threaded explicitly (never inferred from "prose is non-null"), mirroring insights_source. */
  takeaway_source?: "agent" | "llm" | "template";
}

export type CostCategory = "fresh_input" | "cache_write" | "cache_read" | "output";

export interface CostCategoryDetail {
  tokens: number;
  usd: number;
  rate_per_mtok: number;
  tok_pct: number; // 0–100 (share of tokens)
  cost_pct: number; // 0–100 (share of cost) — the "flip"
}

export interface TimelineSegment {
  phase: Phase;
  start_min: number;
  dur_min: number;
  /** for merged tool blocks: which tools ran in this span (tool name -> call count) */
  tools?: Record<string, number>;
}

export interface ToolTime {
  name: string;
  count: number;
  avg_s: number;
  p95_s: number;
  total_min: number;
  /** true => "waiting on you, not machine time"; EXCLUDE from machine subtotal */
  interactive: boolean;
}

export interface Turn {
  i: number;
  response_ms: number;
}

export interface ShippedItem {
  title: string;
  ref?: string;
  meta?: string; // PRs: "merged"/"opened" (status, NEVER a cost). Reviews: "$2.06 · 3m".
  /** Plan 6: commits folded under a PR (plain subjects; no per-item cost). */
  commits?: ShippedItem[];
  /** Plan 6: reviews folded under a PR (each carries a real $/time meta). */
  reviews?: ShippedItem[];
}
export interface Shipped {
  /** Each PR may carry nested `commits` + `reviews` (Plan 6). */
  prs?: ShippedItem[];
  /** Reviews with no PR ref (could not be linked) stay top-level. */
  reviews?: ShippedItem[];
  adrs?: ShippedItem[];
  skills?: ShippedItem[];
  /** Direct-to-main commits (no owning PR) stay top-level. */
  commits?: ShippedItem[];
  /** distinct files written/edited in the main loop this session */
  files_touched?: number;
}
