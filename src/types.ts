/* ============================================================================
 * TOKEN TORCH — DATA contract (the integration point)
 * Ported verbatim from the design handoff's data.d.ts. The entire UI renders
 * from these objects; the data generator (scripts/) emits them from real
 * Claude Code session logs. Costs/tokens/minutes are MEASURED; a few
 * within-session splits are estimates (see README "Honesty rules").
 * ========================================================================== */

export type Fidelity = "high" | "main_loop";
export type Model = "opus" | "sonnet" | "haiku" | (string & {});

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
  };
  totals: {
    cost_usd: number;
    cost_by_fidelity: { high: number; main_loop: number }; // sums ~ cost_usd
    active_minutes: number;
    active_hours: number;
    idle_minutes: number;
    idle_hours: number;
    sessions: number;
    subagent_dispatches: number;
    cost_per_active_min: number;
    avg_cache_hit_pct: number; // 0–100
    tokens: { input_fresh: number; cache_read: number; output: number };
    time_saved_min: number; // est. wall-clock saved by parallel subagents
    time_saved_hours: number;
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
  top_tools: Record<string, number>;
  detail_href: string; // e.g. "sessions/<id>.html" or route "/sessions/:id"
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
  meta?: string; // e.g. "merged", "+612 / -94", "$2.06 · 3m"
}
export interface Shipped {
  prs?: ShippedItem[];
  reviews?: ShippedItem[];
  adrs?: ShippedItem[];
  skills?: ShippedItem[];
  commits?: ShippedItem[];
  /** distinct files written/edited in the main loop this session */
  files_touched?: number;
}
