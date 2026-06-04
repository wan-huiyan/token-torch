/* ============================================================================
 * REAL per-session time-phase analytics (S11 redesign foundation).
 *
 * We walk ONE sorted wall-clock timeline of lightweight transcript events,
 * maintaining the set of currently-open tool_use ids (opened on `tool_use`,
 * closed on the matching `tool_result` by id). Each consecutive interval is
 * attributed to exactly ONE phase by what is open AT THE START of the interval:
 *   - an Agent/Workflow tool open       → subagent (FULL gap, even if long — a
 *                                           running subagent is real compute)
 *   - else a machine (non-interactive) tool open → tool (FULL gap)
 *   - else ONLY an interactive tool open → idle (AskUserQuestion = you answering,
 *                                           NOT machine compute)
 *   - else nothing open, gap ≤ 120s     → model_gen (model generating, incl. thinking)
 *   - else nothing open, gap > 120s     → idle (you-away; NOT an active phase)
 *
 * Because it is a SINGLE timeline, overlapping/parallel subagents are UNIONED
 * automatically — we never sum per-agent spans (cite lesson
 * `concurrent-span-duration-union-not-sum` / `merged-stream-active-time-exceeds-
 * per-entity-sum`: gap-active over a merged stream must be measured against the
 * partition span, never summed per entity).
 *
 * phase_total (thinking+tool+subagent) is genuine MACHINE compute. It can EXCEED
 * active_min (it counts long >120s tool/subagent runs as compute, which the
 * wall-clock heuristic treats as you-away) AND it can fall BELOW active_min (it
 * excludes short you-answering interactive gaps that active_min still counts).
 * The only hard bound is 0 ≤ each phase and phase_total ≤ wall_clock — what
 * generate.ts verify() asserts.
 * ========================================================================== */

const MS_PER_MIN = 60_000;
const GAP_IDLE_MS = 120_000; // > 120s with nothing open = you-away (idle), not compute
const SLIVER_PCT = 0.002;    // drop ribbon segments under 0.2% of the wall-clock

/** Tools that are mostly "you answering" — listed but excluded from a machine
 *  tool-time subtotal by consumers. Defined HERE (the leaf module) to avoid an
 *  import cycle (ingest→timePhases, mapSessionDetail→ingest). */
export const INTERACTIVE_TOOLS = new Set(["AskUserQuestion"]);

/** Subagent dispatches are `Agent`/`Workflow` tool calls (NOT "Task"). */
const SUBAGENT_TOOLS = new Set(["Agent", "Workflow"]);

export interface TimeEvent {
  ts: number;                                          // epoch ms
  kind: "human" | "assistant" | "tool_use" | "tool_result" | "other";
  msgId?: string;       // assistant message.id (blocks of one msg share it)
  toolId?: string;      // tool_use.id (for open)
  toolName?: string;    // tool_use.name
  toolUseId?: string;   // tool_result.tool_use_id (matches a tool_use.id)
}

/** Ribbon phase label. "thinking" == model_gen (model active, incl. thinking). */
export type PhaseLabel = "thinking" | "tool" | "subagent" | "idle";

export interface PhaseSegment {
  phase: PhaseLabel;
  start_min: number; // relative to the first event
  dur_min: number;
}

export interface ToolTimeEntry {
  name: string;
  count: number;
  total_min: number;
  avg_s: number;
  p95_s: number;
  interactive: boolean;
}

export interface TurnEntry {
  i: number;
  response_ms: number;
}

export interface TimePhases {
  /** Shares of ACTIVE wall-clock minutes. thinking_min == model_gen (incl.
   *  thinking+planning — not separately measurable). planning_min is left 0
   *  (not honestly separable). All round2, in minutes. */
  active_breakdown: {
    thinking_min: number;
    tool_min: number;
    subagent_min: number;
    planning_min: number;
  };
  segments: PhaseSegment[];
  tool_time: ToolTimeEntry[];
  turns: TurnEntry[];
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

const EMPTY: TimePhases = {
  active_breakdown: { thinking_min: 0, tool_min: 0, subagent_min: 0, planning_min: 0 },
  segments: [],
  tool_time: [],
  turns: [],
};

/** Classify the interval STARTING at this state into a phase.
 *  HONESTY: when the ONLY thing open is an interactive tool (AskUserQuestion =
 *  you answering, not machine time), the interval is you-away (idle), NOT tool
 *  compute — mirrors the "interactive tools aren't machine time" affordance. So
 *  the phase total is genuine MACHINE compute; it can be LESS than active_min
 *  (which still counts short you-answering gaps as active). */
function phaseFor(openTools: Map<string, string>, gapMs: number): PhaseLabel {
  let subagentOpen = false;
  let machineToolOpen = false; // a non-subagent, non-interactive tool = real compute
  let anyOpen = false;
  for (const name of openTools.values()) {
    anyOpen = true;
    if (SUBAGENT_TOOLS.has(name)) { subagentOpen = true; break; }
    if (!INTERACTIVE_TOOLS.has(name)) machineToolOpen = true;
  }
  if (subagentOpen) return "subagent";    // a running subagent is real compute, full gap
  if (machineToolOpen) return "tool";     // a machine tool running, full gap
  if (anyOpen) return "idle";             // ONLY an interactive tool open = you answering = you-away
  return gapMs <= GAP_IDLE_MS ? "thinking" : "idle"; // model_gen vs you-away
}

function p95(sortedAscMs: number[]): number {
  if (!sortedAscMs.length) return 0;
  // nearest-rank p95 (ceil), 0-indexed.
  const rank = Math.ceil(0.95 * sortedAscMs.length);
  const idx = Math.min(sortedAscMs.length - 1, Math.max(0, rank - 1));
  return sortedAscMs[idx];
}

export function deriveTimePhases(eventsIn: TimeEvent[]): TimePhases {
  if (!eventsIn || eventsIn.length < 2) return clone(EMPTY);

  // worktree fanout = file order ≠ time order, so sort (stable on equal ts).
  const events = [...eventsIn].sort((a, b) => a.ts - b.ts);
  const t0 = events[0].ts;
  const wallMs = events[events.length - 1].ts - t0;

  // tool_use ids that DO get a matching tool_result (anywhere in the stream).
  // A tool_use whose id is NOT here is an ORPHAN (session truncated mid-call) →
  // it is force-closed after exactly one interval so it never runs to session end.
  const matched = new Set<string>();
  for (const e of events) if (e.kind === "tool_result" && e.toolUseId) matched.add(e.toolUseId);

  // raw ms per phase — accumulated directly (NOT from the sliver-filtered/merged
  // segments, which would drop the <0.2% slivers from the active totals).
  const phaseMs: Record<PhaseLabel, number> = { thinking: 0, tool: 0, subagent: 0, idle: 0 };

  // open tool_use ids → tool name (paired by exact id match).
  const openTools = new Map<string, string>();
  // per-tool open timestamps (for tool_time durations) keyed by tool id.
  const openAt = new Map<string, { name: string; ts: number }>();
  // orphan tool ids → the event index they were opened at (force-closed at i+1).
  const orphanOpenedIdx = new Map<string, number>();
  // per-tool accumulated call durations (closed pairs only).
  const toolCalls = new Map<string, number[]>(); // name → [durMs,...]

  // contiguous-phase ribbon runs.
  const rawSegments: { phase: PhaseLabel; startMs: number; durMs: number }[] = [];
  const pushInterval = (phase: PhaseLabel, fromMs: number, gapMs: number) => {
    phaseMs[phase] += gapMs;
    const last = rawSegments[rawSegments.length - 1];
    if (last && last.phase === phase) last.durMs += gapMs;
    else rawSegments.push({ phase, startMs: fromMs - t0, durMs: gapMs });
  };

  // turn tracking: per assistant msgId, first + last block ts (independent of the
  // token-dedup). response_ms = lastBlockTs − triggerTs (the immediately preceding
  // non-assistant event). First turn (no trigger) excluded.
  const msgFirst = new Map<string, number>();
  const msgLast = new Map<string, number>();
  const msgOrder: string[] = [];          // first-seen order of msgIds
  const msgTrigger = new Map<string, number | null>(); // preceding non-assistant ts, null = none

  let lastNonAssistantTs: number | null = null;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];

    // ---- interval ENDING at this event (attributed by state BEFORE applying e) ----
    if (i > 0) {
      const prev = events[i - 1];
      const gap = e.ts - prev.ts;
      if (gap > 0) pushInterval(phaseFor(openTools, gap), prev.ts, gap);
    }

    // ---- apply this event's open/close/turn semantics ----
    switch (e.kind) {
      case "tool_use":
        if (e.toolId) {
          openTools.set(e.toolId, e.toolName ?? "");
          openAt.set(e.toolId, { name: e.toolName ?? "", ts: e.ts });
          if (!matched.has(e.toolId)) orphanOpenedIdx.set(e.toolId, i); // truncated-session orphan
        }
        break;
      case "tool_result":
        if (e.toolUseId && openTools.has(e.toolUseId)) {
          openTools.delete(e.toolUseId);
          const o = openAt.get(e.toolUseId);
          if (o) {
            const arr = toolCalls.get(o.name) ?? [];
            arr.push(Math.max(0, e.ts - o.ts));
            toolCalls.set(o.name, arr);
            openAt.delete(e.toolUseId);
          }
        }
        break;
      case "assistant":
        if (e.msgId) {
          if (!msgFirst.has(e.msgId)) {
            msgFirst.set(e.msgId, e.ts);
            msgOrder.push(e.msgId);
            msgTrigger.set(e.msgId, lastNonAssistantTs); // null if no prior trigger
          }
          msgLast.set(e.msgId, e.ts);
        }
        break;
      // "human" and "other" are non-assistant time-advancers (a human prompt is
      // also a turn trigger). They open/close nothing.
      default:
        break;
    }
    if (e.kind !== "assistant") lastNonAssistantTs = e.ts;

    // HONESTY: an orphan tool_use (truncated mid-call, no matching tool_result)
    // is force-closed at the NEXT event so it never runs to session end. The
    // interval that ENDED at this event (counted above) already credited its one
    // open interval [openedIdx, openedIdx+1]; here we evict it so later intervals
    // re-classify without it. Orphans carry NO tool_time duration (no real close).
    for (const [id, openedIdx] of orphanOpenedIdx) {
      if (openedIdx < i) { openTools.delete(id); openAt.delete(id); orphanOpenedIdx.delete(id); }
    }
  }

  // any tools STILL open at the last event are unmatched (truncated) — they were
  // counted only up to the last interval; nothing to add (no trailing interval).

  // ---- active_breakdown (round2 once, from raw ms) ----
  const active_breakdown = {
    thinking_min: round2(phaseMs.thinking / MS_PER_MIN),
    tool_min: round2(phaseMs.tool / MS_PER_MIN),
    subagent_min: round2(phaseMs.subagent / MS_PER_MIN),
    planning_min: 0, // not honestly separable from model_gen
  };

  // ---- segments (merged contiguous runs already; drop <0.2% slivers) ----
  const minSliverMs = wallMs * SLIVER_PCT;
  const segments: PhaseSegment[] = rawSegments
    .filter((s) => s.durMs >= minSliverMs)
    .map((s) => ({ phase: s.phase, start_min: round2(s.startMs / MS_PER_MIN), dur_min: round2(s.durMs / MS_PER_MIN) }));

  // ---- tool_time (per non-Agent/Workflow tool; sorted by total_min desc) ----
  const tool_time: ToolTimeEntry[] = [];
  for (const [name, durs] of toolCalls) {
    if (SUBAGENT_TOOLS.has(name)) continue; // subagent time has its own phase
    const totalMs = durs.reduce((s, d) => s + d, 0);
    const sorted = [...durs].sort((a, b) => a - b);
    tool_time.push({
      name,
      count: durs.length,
      total_min: round2(totalMs / MS_PER_MIN),
      avg_s: round2(totalMs / durs.length / 1000),
      p95_s: round2(p95(sorted) / 1000),
      interactive: INTERACTIVE_TOOLS.has(name),
    });
  }
  tool_time.sort((a, b) => b.total_min - a.total_min);

  // ---- turns (one per assistant msgId) ----
  // EXCLUDE the FIRST turn (positionally — the chronologically-first assistant
  // message): the task spec says "no trigger", and in practice the opening
  // assistant response IS preceded by queue-op/hook rows so it WOULD get a
  // trigger, but its latency vs those scaffold rows is not a real per-turn
  // response time. Also skip any turn whose trigger is genuinely null/unbound.
  const turns: TurnEntry[] = [];
  let i = 0;
  for (let k = 0; k < msgOrder.length; k++) {
    if (k === 0) continue; // positional first-turn exclusion
    const mid = msgOrder[k];
    const trigger = msgTrigger.get(mid) ?? null;
    const last = msgLast.get(mid);
    if (trigger == null || last == null) continue; // unbound → excluded
    i++;
    turns.push({ i, response_ms: Math.max(0, last - trigger) });
  }

  return { active_breakdown, segments, tool_time, turns };
}

function clone(t: TimePhases): TimePhases {
  return {
    active_breakdown: { ...t.active_breakdown },
    segments: [...t.segments],
    tool_time: [...t.tool_time],
    turns: [...t.turns],
  };
}
