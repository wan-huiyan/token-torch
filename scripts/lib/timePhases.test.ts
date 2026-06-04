import assert from "node:assert/strict";
import { deriveTimePhases, type TimeEvent } from "./timePhases";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

const S = 1000;

/** Build an event from a relative-seconds offset (readable fixtures). */
const ev = (s: number, kind: TimeEvent["kind"], extra: Partial<TimeEvent> = {}): TimeEvent =>
  ({ ts: s * S, kind, ...extra });

// --------------------------------------------------------------------------
// 1. Simple model_gen → tool → model_gen timeline.
//    human@0, assistant@10s (10s model_gen), tool_use Bash@10s, tool_result@40s
//    (30s tool), assistant@40s, assistant-last-block@70s (30s model_gen).
// --------------------------------------------------------------------------
check("simple model_gen → tool → model_gen attributes each interval to one phase", () => {
  const events: TimeEvent[] = [
    ev(0, "human"),
    ev(10, "assistant", { msgId: "m1" }),
    ev(10, "tool_use", { toolId: "t1", toolName: "Bash" }),
    ev(40, "tool_result", { toolUseId: "t1" }),
    ev(40, "assistant", { msgId: "m2" }),
    ev(70, "assistant", { msgId: "m2" }),
  ];
  const r = deriveTimePhases(events);
  // interval 0→10 nothing open ≤120s → model_gen (10s)
  // interval 10→40 Bash open → tool (30s)
  // interval 40→70 nothing open ≤120s → model_gen (30s)
  assert.equal(r.active_breakdown.thinking_min, round2((10 + 30) / 60)); // model_gen 40s
  assert.equal(r.active_breakdown.tool_min, round2(30 / 60));
  assert.equal(r.active_breakdown.subagent_min, 0);
  assert.equal(r.active_breakdown.planning_min, 0);
});

// --------------------------------------------------------------------------
// 2. A long (>120s) nothing-open gap → idle, NOT a phase. (human-away)
// --------------------------------------------------------------------------
check("a >120s gap with nothing open is idle, not counted in any active phase", () => {
  const events: TimeEvent[] = [
    ev(0, "human"),
    ev(10, "assistant", { msgId: "m1" }), // 10s model_gen
    // 200s gap with nothing open → idle (NOT model_gen, NOT a phase)
    ev(210, "human"),
    ev(215, "assistant", { msgId: "m2" }), // 5s model_gen
  ];
  const r = deriveTimePhases(events);
  // only the two short gaps (10s + 5s) count as model_gen; the 200s is idle.
  assert.equal(r.active_breakdown.thinking_min, round2(15 / 60));
  assert.equal(r.active_breakdown.tool_min, 0);
  assert.equal(r.active_breakdown.subagent_min, 0);
  // and the idle gap is NOT a model_gen sliver: no segment of phase "thinking" spans 200s.
  const longThinking = r.segments.find((s) => s.phase === "thinking" && s.dur_min > 2);
  assert.equal(longThinking, undefined);
  // but there IS an idle segment for the ribbon.
  assert.ok(r.segments.some((s) => s.phase === "idle"));
});

// --------------------------------------------------------------------------
// 3. A long subagent (Agent open 300s) is counted in subagent_min, NOT idle —
//    a running subagent is real compute even across a >120s gap.
// --------------------------------------------------------------------------
check("a long Agent span (>120s) counts as subagent_min, never idle", () => {
  const events: TimeEvent[] = [
    ev(0, "human"),
    ev(5, "assistant", { msgId: "m1" }),
    ev(5, "tool_use", { toolId: "a1", toolName: "Agent" }),
    ev(305, "tool_result", { toolUseId: "a1" }), // 300s Agent run
  ];
  const r = deriveTimePhases(events);
  assert.equal(r.active_breakdown.subagent_min, round2(300 / 60)); // 5 min
  assert.equal(r.active_breakdown.thinking_min, round2(5 / 60));   // the 0→5 gap
  // NOT idle: no idle segment of 300s.
  assert.equal(r.segments.some((s) => s.phase === "idle"), false);
});

// --------------------------------------------------------------------------
// 4. Two OVERLAPPING Agents → unioned (single timeline), NOT summed.
//    a1 open [5,305], a2 open [105,205] (fully inside a1). Wall subagent = 300s,
//    not 300+100 = 400s.
// --------------------------------------------------------------------------
check("two overlapping Agents are unioned over the timeline, not summed", () => {
  const events: TimeEvent[] = [
    ev(0, "human"),
    ev(5, "assistant", { msgId: "m1" }),
    ev(5, "tool_use", { toolId: "a1", toolName: "Agent" }),
    ev(105, "tool_use", { toolId: "a2", toolName: "Agent" }),  // opens while a1 open
    ev(205, "tool_result", { toolUseId: "a2" }),               // a2 closes, a1 still open
    ev(305, "tool_result", { toolUseId: "a1" }),               // a1 closes
  ];
  const r = deriveTimePhases(events);
  // wall-clock subagent span is 5→305 = 300s = 5min (UNION), not 400s.
  assert.equal(r.active_breakdown.subagent_min, round2(300 / 60));
});

// --------------------------------------------------------------------------
// 5. An unmatched tool_use (session truncated) is closed safely at the next
//    event — never extended to session end.
// --------------------------------------------------------------------------
check("an unmatched tool_use is closed at the next event, never run to session end", () => {
  const events: TimeEvent[] = [
    ev(0, "human"),
    ev(10, "assistant", { msgId: "m1" }),
    ev(10, "tool_use", { toolId: "t1", toolName: "Read" }), // NO matching tool_result
    ev(40, "assistant", { msgId: "m2" }), // next event 30s later
    ev(50, "assistant", { msgId: "m2" }), // a further 10s
  ];
  const r = deriveTimePhases(events);
  // 10→40 the Read is open → tool (30s). At the next event (assistant@40) it
  // closes (orphan), so 40→50 is model_gen (10s) not tool.
  assert.equal(r.active_breakdown.tool_min, round2(30 / 60));
  assert.equal(r.active_breakdown.thinking_min, round2((10 + 10) / 60)); // 0→10 + 40→50
});

// --------------------------------------------------------------------------
// 6. The first turn (no trigger) is EXCLUDED from turns[]; subsequent turns
//    get response_ms = lastBlockTs(msgId) − triggerTs(preceding non-assistant).
// --------------------------------------------------------------------------
check("turns: first turn excluded; response_ms = lastBlockTs − preceding non-assistant trigger", () => {
  const events: TimeEvent[] = [
    // turn for m0 has NO preceding non-assistant event → excluded.
    ev(0, "assistant", { msgId: "m0" }),
    ev(5, "assistant", { msgId: "m0" }),
    // human trigger @20, then assistant m1 blocks @25..40 → response_ms = 40−20 = 20s
    ev(20, "human"),
    ev(25, "assistant", { msgId: "m1" }),
    ev(40, "assistant", { msgId: "m1" }),
  ];
  const r = deriveTimePhases(events);
  assert.equal(r.turns.length, 1);
  assert.equal(r.turns[0].i, 1);
  assert.equal(r.turns[0].response_ms, 20 * S);
});

// 6b. POSITIONAL first-turn exclusion: even when the first assistant message HAS
//     a preceding trigger (a queue-op/hook/human row — the real-corpus case), the
//     chronologically-first turn is still dropped. A regression that excludes only
//     trigger==null turns would here keep BOTH turns → this reddens it.
check("turns: the first assistant turn is excluded even when it HAS a trigger", () => {
  const events: TimeEvent[] = [
    ev(0, "other"),                       // scaffold trigger before the FIRST assistant msg
    ev(2, "assistant", { msgId: "m1" }),  // first turn — has a trigger, but positionally excluded
    ev(4, "assistant", { msgId: "m1" }),
    ev(10, "human"),                      // trigger for the second turn
    ev(12, "assistant", { msgId: "m2" }),
    ev(18, "assistant", { msgId: "m2" }), // response_ms = 18−10 = 8s
  ];
  const r = deriveTimePhases(events);
  assert.equal(r.turns.length, 1);              // m1 (first) dropped, only m2 kept
  assert.equal(r.turns[0].response_ms, 8 * S);
});

// --------------------------------------------------------------------------
// 7. AskUserQuestion is flagged interactive (listed in tool_time) but its
//    open span is "you answering", NOT machine compute → it must be EXCLUDED
//    from tool_min (counted as idle). A wrong impl that lumps the interactive
//    gap into tool_min reddens here.
// --------------------------------------------------------------------------
check("interactive tool open = you-away (idle), excluded from tool_min", () => {
  const events: TimeEvent[] = [
    ev(0, "human"),
    ev(5, "assistant", { msgId: "m1" }),
    ev(5, "tool_use", { toolId: "q1", toolName: "AskUserQuestion" }),
    ev(15, "tool_result", { toolUseId: "q1" }), // [5,15]=10s AskUserQuestion ONLY open → idle
    ev(15, "tool_use", { toolId: "b1", toolName: "Bash" }),
    ev(35, "tool_result", { toolUseId: "b1" }), // [15,35]=20s Bash open → tool
  ];
  const r = deriveTimePhases(events);
  const ask = r.tool_time.find((t) => t.name === "AskUserQuestion");
  const bash = r.tool_time.find((t) => t.name === "Bash");
  assert.ok(ask, "AskUserQuestion present in tool_time");
  assert.equal(ask!.interactive, true);
  assert.equal(ask!.count, 1);
  assert.ok(bash, "Bash present");
  assert.equal(bash!.interactive, false);
  // sorted by total_min desc: Bash (20s) before AskUserQuestion (10s).
  assert.equal(r.tool_time[0].name, "Bash");
  // DISCRIMINATING: tool_min = ONLY the 20s Bash gap (0.333m), NOT the 10s
  // AskUserQuestion gap. The interactive gap is idle.
  assert.equal(r.active_breakdown.tool_min, round2(20 / 60));
  assert.ok(r.segments.some((s) => s.phase === "idle"), "AskUserQuestion span is an idle segment");
});

// --------------------------------------------------------------------------
// 8. tool_time: per-tool count + total_min + avg/p95 from the per-call gaps.
// --------------------------------------------------------------------------
check("tool_time aggregates per-tool count/total/avg/p95 from open→close gaps", () => {
  const events: TimeEvent[] = [
    ev(0, "human"),
    ev(1, "assistant", { msgId: "m1" }),
    ev(1, "tool_use", { toolId: "b1", toolName: "Bash" }),
    ev(11, "tool_result", { toolUseId: "b1" }), // 10s
    ev(11, "tool_use", { toolId: "b2", toolName: "Bash" }),
    ev(41, "tool_result", { toolUseId: "b2" }), // 30s
  ];
  const r = deriveTimePhases(events);
  const bash = r.tool_time.find((t) => t.name === "Bash")!;
  assert.equal(bash.count, 2);
  assert.equal(bash.total_min, round2(40 / 60)); // 10+30 s
  assert.equal(bash.avg_s, 20);                   // (10+30)/2
  assert.equal(bash.p95_s, 30);                   // p95 of {10,30}
});

// --------------------------------------------------------------------------
// 9. Honest degrade: empty / single-event input → zeroed/empty.
// --------------------------------------------------------------------------
check("empty or <2-event input returns a zeroed/empty honest degrade", () => {
  const empty = deriveTimePhases([]);
  assert.equal(empty.active_breakdown.thinking_min, 0);
  assert.equal(empty.active_breakdown.tool_min, 0);
  assert.equal(empty.active_breakdown.subagent_min, 0);
  assert.deepEqual(empty.segments, []);
  assert.deepEqual(empty.tool_time, []);
  assert.deepEqual(empty.turns, []);
  const one = deriveTimePhases([ev(0, "human")]);
  assert.deepEqual(one.segments, []);
});

// --------------------------------------------------------------------------
// 10. Neutral "other" rows (queue-op / hook / sidechain) advance time but carry
//     no open/close/turn semantics — they keep the timeline aligned with
//     deriveTime so the phase-sum ≥ active bound holds by construction.
// --------------------------------------------------------------------------
check("neutral 'other' events advance the wall-clock but open nothing", () => {
  const events: TimeEvent[] = [
    ev(0, "other"),
    ev(10, "assistant", { msgId: "m1" }), // 0→10 nothing open → model_gen
    ev(10, "tool_use", { toolId: "t1", toolName: "Bash" }),
    ev(20, "other"),  // mid-tool neutral row — Bash still open at interval start
    ev(40, "tool_result", { toolUseId: "t1" }),
  ];
  const r = deriveTimePhases(events);
  assert.equal(r.active_breakdown.thinking_min, round2(10 / 60));
  assert.equal(r.active_breakdown.tool_min, round2(30 / 60)); // 10→20 + 20→40, Bash open throughout
});

// --------------------------------------------------------------------------
// 11. Unsorted input is sorted before the walk (worktree fanout = file order
//     ≠ time order).
// --------------------------------------------------------------------------
check("unsorted events are sorted by ts before the walk", () => {
  const events: TimeEvent[] = [
    ev(40, "assistant", { msgId: "m2" }),
    ev(0, "human"),
    ev(10, "assistant", { msgId: "m1" }),
  ];
  const r = deriveTimePhases(events);
  // 0→10 + 10→40 nothing open ≤120s → all model_gen (40s)
  assert.equal(r.active_breakdown.thinking_min, round2(40 / 60));
});

function round2(v: number): number { return Math.round(v * 100) / 100; }

console.log(`\n${passed} timePhases checks passed`);
