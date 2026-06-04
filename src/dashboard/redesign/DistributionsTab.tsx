/* ============================================================================
 * TOKEN TORCH redesign — Distributions tab (00-dashboard.html lines 152-162;
 * prototype renderDistributions / renderWhenHeatmap).
 *
 * HONESTY-CRITICAL TAB. The prototype FABRICATED its phase split (seeded RNG:
 * think=.3, plan=.1, sub from subagent count, tool=remainder) AND read fake
 * context fields (context_tokens_fed / fresh_context_tokens) AND hardcoded a
 * "51×" / saved-cost. NONE of that is ported. All three panels bind to REAL or
 * client-derived data:
 *   1) donut  — REAL 3-way sum of active_breakdown.{thinking,tool,subagent}_min
 *               across useWindow().sessions (planning_min is ALWAYS 0 → omitted).
 *   2) punch  — CLIENT-DERIVED 7×24 grid bucketed here from session.start_ts (UTC).
 *   3) ovpanel— REAL data.totals.context_overhead; the "N×" re-read ratio is
 *               COMPUTED from reread_tokens / input_fresh (never the prototype's 51).
 * ========================================================================== */
import { useMemo, useState } from "react";
import type { DashboardData, SessionRow } from "../../types";
import { num, pct, tokAbbr, usd } from "../helpers";
import { fmtMin } from "../windowAgg";
import { useWindow } from "../useWindow";
import { Sprite } from "../Sprite";
import { mountMascot, mountIcon, mountOwl, mountBird } from "../spriteEngine";
import { Est } from "./ui";

/* ----------------------------- shared bits -------------------------------- */

type PhaseAct = "think" | "work" | "team";

interface Phase {
  act: PhaseAct;
  label: string; // display label (the marker / detail head)
  color: string;
  val: number; // REAL summed minutes
  expl: string; // honest one-line explanation
}

const TOOL_EXPL: Record<string, string> = {
  Bash: "Bash — runs shell commands: tests, builds, git, file ops.",
  Read: "Read — reads a file into context.",
  Edit: "Edit — a targeted find-and-replace edit to one file.",
  Write: "Write — writes a whole new file.",
  Grep: "Grep — searches file contents by regex.",
  Glob: "Glob — finds files by name pattern.",
  Agent: "Agent — dispatches a subagent to run a sub-task.",
  TodoWrite: "TodoWrite — updates the run's task checklist.",
  Task: "Task — launches a scoped sub-task.",
  MultiEdit: "MultiEdit — several edits to one file in one call.",
  WebFetch: "WebFetch — fetches a web page or document.",
  WebSearch: "WebSearch — searches the web for current information.",
  NotebookEdit: "NotebookEdit — edits a Jupyter notebook cell.",
  Skill: "Skill — invokes a packaged skill / workflow.",
  AskUserQuestion: "AskUserQuestion — pauses to ask you a question — mostly you answering, not machine time.",
};

const BALLOON_COLS = ["var(--cyan)", "var(--lime)", "var(--magenta)"];
const TOP_TOOLS = 18; // prototype caps the balloon cluster at top-18 (labelled)

/* ============================================================================
 * PANEL 1 — Active compute · by phase (REAL 3-way donut)
 * ========================================================================== */

function ComputePanel({ sessions }: { sessions: SessionRow[] }) {
  // REAL 3-way sum across the windowed sessions. planning_min is always 0 in the
  // corpus → omitted from the ring (3 arcs fill it). model-gen = thinking_min.
  const ph = useMemo(() => {
    const acc = { thinking: 0, tool: 0, subagent: 0 };
    for (const s of sessions) {
      const b = s.active_breakdown;
      if (!b) continue;
      acc.thinking += b.thinking_min || 0;
      acc.tool += b.tool_min || 0;
      acc.subagent += b.subagent_min || 0;
    }
    return acc;
  }, [sessions]);

  // REAL aggregated tool CALL COUNTS (top_tools summed across windowed sessions).
  const tools = useMemo(() => {
    const t: Record<string, number> = {};
    for (const s of sessions) for (const k in s.top_tools) t[k] = (t[k] || 0) + s.top_tools[k];
    return Object.entries(t)
      .map(([k, v]) => ({ k, v }))
      .sort((a, b) => b.v - a.v)
      .slice(0, TOP_TOOLS);
  }, [sessions]);
  const tMax = tools.length ? tools[0].v : 1;
  const tMin = tools.length ? tools[tools.length - 1].v : 0;

  const total = ph.thinking + ph.tool + ph.subagent;
  const phTot = total || 1; // 3-way denominator (planning omitted)

  const PH: Phase[] = [
    {
      act: "think",
      label: "model active · incl. thinking",
      color: "var(--cyan)",
      val: ph.thinking,
      expl: "Model active time — reasoning, weighing options, and generating its responses (includes thinking).",
    },
    {
      act: "work",
      label: "tool",
      color: "var(--lime)",
      val: ph.tool,
      expl: "Running tools — file edits, shell commands, searches. Where the real work touches your repo.",
    },
    {
      act: "team",
      label: "subagent",
      color: "var(--magenta)",
      val: ph.subagent,
      expl: "Dispatched sub-tasks running their own model loop — often in parallel, so wall-clock can be shorter than it looks.",
    },
  ];

  // pinned (click) phase; default = the "work" (tool) detail. hover overrides.
  const [pinned, setPinned] = useState<PhaseAct>("work");
  const [hover, setHover] = useState<PhaseAct | null>(null);
  const selAct = hover ?? pinned;
  const selPhase = PH.find((p) => p.act === selAct) ?? PH[1];

  // donut geometry (matches the prototype's concentric-ring SVG)
  const size = 230;
  const thick = 32;
  const r = (size - thick) / 2;
  const c = 2 * Math.PI * r;

  const arcs: { p: Phase; dash: string; rot: number }[] = [];
  {
    let off = 0;
    for (const p of PH) {
      const len = (p.val / phTot) * c;
      arcs.push({ p, dash: `${len} ${c - len}`, rot: (off / phTot) * 360 - 90 });
      off += p.val;
    }
  }

  // phase markers + ring labels around the donut (decorative mascots; REAL %/min)
  const cx = 200;
  const cy = 200;
  const Rm = 168;
  const markers: { p: Phase; x: number; y: number; lx: number; ly: number; pctv: number }[] = [];
  {
    let acc = 0;
    for (const p of PH) {
      const frac = p.val / phTot;
      const mid = acc + frac / 2;
      acc += frac;
      const ang = ((-90 + mid * 360) * Math.PI) / 180;
      markers.push({
        p,
        x: cx + Rm * Math.cos(ang),
        y: cy + Rm * Math.sin(ang),
        lx: cx + 99 * Math.cos(ang),
        ly: cy + 99 * Math.sin(ang),
        pctv: Math.round(frac * 100),
      });
    }
  }

  // honest summary quip from the REAL leading phase
  const top = [...PH].sort((a, b) => b.val - a.val)[0];
  const topPct = Math.round((top.val / phTot) * 100);
  let lead: { txt: string; n: string; col: string };
  if (top.act === "work") lead = { txt: "Mostly heads-down in the tools — ", n: `${topPct}%`, col: "var(--lime)" };
  else if (top.act === "think") lead = { txt: "Model-active heavy — ", n: `${topPct}%`, col: "var(--cyan)" };
  else lead = { txt: "Delegation station — ", n: `${topPct}%`, col: "var(--magenta)" };
  const leadTail =
    top.act === "work"
      ? " of active compute went to actually doing the work in tools."
      : top.act === "think"
        ? " of active compute was the model reasoning and generating."
        : " of active compute ran inside subagents.";

  return (
    <div className="dpanel computepanel">
      <h4>Active compute · by phase</h4>
      <div className="compute-grid">
        <div className="acleft">
          <div className="donut">
            <div className="donut-stage" data-sel={selAct}>
              <div className="donut-core">
                <svg width={size} height={size} viewBox="0 0 230 230">
                  {arcs.map(({ p, dash, rot }) => (
                    <circle
                      key={p.act}
                      className="donut-arc"
                      data-act={p.act}
                      cx="115"
                      cy="115"
                      r={r}
                      fill="none"
                      stroke={p.color}
                      strokeWidth={thick}
                      strokeDasharray={dash}
                      transform={`rotate(${rot} 115 115)`}
                      style={{ opacity: p.act === selAct ? 1 : 0.26, cursor: "pointer", transition: "opacity .2s" }}
                      onMouseEnter={() => setHover(p.act)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => setPinned(p.act)}
                    />
                  ))}
                </svg>
                <div className="dctr">
                  <div className="dv">{fmtMin(total)}</div>
                  <div className="dl">active compute</div>
                </div>
              </div>

              {markers.map(({ p, x, y, lx, ly, pctv }) => (
                <div key={p.act}>
                  <div
                    className={"phase-marker act-" + p.act + (p.act === selAct ? " sel" : "")}
                    data-act={p.act}
                    tabIndex={0}
                    role="button"
                    aria-label={`${p.label}: ${fmtMin(p.val)}, ${pctv}%`}
                    style={{ left: `${x.toFixed(0)}px`, top: `${y.toFixed(0)}px`, ["--pc" as string]: p.color }}
                    onMouseEnter={() => setHover(p.act)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setPinned(p.act)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setPinned(p.act);
                      }
                    }}
                  >
                    <PhaseBot act={p.act} />
                    <div className="pm-lab">
                      <b style={{ color: p.color }}>{p.label}</b>
                    </div>
                  </div>
                  <div className="ring-lab" style={{ left: `${lx.toFixed(0)}px`, top: `${ly.toFixed(0)}px` }}>
                    {fmtMin(p.val)} · {pctv}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="ac-quip">
            <span className="aq-badge">summary</span>
            <p>
              {lead.txt}
              <b style={{ color: lead.col }}>{lead.n}</b>
              {leadTail}
            </p>
          </div>
        </div>

        <PhaseDetail phase={selPhase} phTot={phTot} tools={tools} tMax={tMax} tMin={tMin} />
      </div>
    </div>
  );
}

/** Decorative phase mascot inside a marker (mirrors the prototype's phase-bot). */
function PhaseBot({ act }: { act: PhaseAct }) {
  if (act === "work") {
    return (
      <span className="phase-bot" data-act="work">
        <Sprite mount={(h) => void mountMascot(h, 3)} />
        <Sprite mount={(h) => void mountIcon(h, "wrench", 2)} className="ax-tool" />
      </span>
    );
  }
  if (act === "team") {
    return (
      <span className="phase-bot" data-act="team">
        <Sprite mount={(h) => void mountMascot(h, 3)} />
        <Sprite mount={(h) => void mountMascot(h, 2)} />
      </span>
    );
  }
  // think
  return (
    <span className="phase-bot" data-act="think">
      <Sprite mount={(h) => void mountMascot(h, 3)} />
      <span className="ax-think">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

/** Side detail panel. For "work" → real tool balloons. Otherwise → real minutes
 *  + an honest one-line explanation (NO fabricated PD stats / sub-bars). */
function PhaseDetail({
  phase,
  phTot,
  tools,
  tMax,
  tMin,
}: {
  phase: Phase;
  phTot: number;
  tools: { k: string; v: number }[];
  tMax: number;
  tMin: number;
}) {
  const [hoverTool, setHoverTool] = useState<string | null>(null);
  const pctv = Math.round((phase.val / phTot) * 100);

  const head = (
    <div className="ac-dhead">
      <span className="ac-ddot" style={{ background: phase.color, boxShadow: `0 0 12px ${phase.color}` }} />
      <b style={{ color: phase.color }}>{phase.label}</b>
      <span className="ac-dtot">
        {fmtMin(phase.val)} · {pctv}%
      </span>
    </div>
  );

  if (phase.act === "work") {
    const card = hoverTool ? tools.find((t) => t.k === hoverTool) : null;
    const cardIdx = card ? tools.findIndex((t) => t.k === card.k) : 0;
    const cardCol = card ? BALLOON_COLS[cardIdx % 3] : BALLOON_COLS[0];
    const cardW = card ? Math.round((card.v / tMax) * 100) : 0;
    return (
      <div className="ac-detail">
        {head}
        <div className="ac-dexpl">{phase.expl}</div>
        <div className="ac-tools-head">
          Top {tools.length} tools · calls <span className="ac-hint">hover a balloon →</span>
        </div>
        <div className="balloons">
          {tools.map((t, j) => {
            const inter = t.k === "AskUserQuestion";
            const frac = tMax > tMin ? (t.v - tMin) / (tMax - tMin) : 1;
            const sz = Math.round(56 + Math.pow(frac, 0.6) * 58);
            const bc = inter ? "var(--amber)" : BALLOON_COLS[j % 3];
            const by = [0, 30, 11, 44, 5, 34, 18, 50, 8, 26][j % 10];
            const bx = [-5, 7, -9, 3, -2, 9, -6, 4][j % 8];
            const rot = ((j * 37) % 23) - 11;
            const dly = ((j * 29) % 11) / 5;
            return (
              <div
                key={t.k}
                className={"balloon" + (inter ? " inter" : "")}
                tabIndex={0}
                onMouseEnter={() => setHoverTool(t.k)}
                onFocus={() => setHoverTool(t.k)}
                style={
                  {
                    "--bw": `${Math.round(sz * 1.34)}px`,
                    "--bh": `${sz}px`,
                    "--bc": bc,
                    "--bd": `${(3.4 + (j % 5) * 0.45).toFixed(1)}s`,
                    "--by": `${by}px`,
                    "--bx": `${bx}px`,
                    "--rot": `${rot}deg`,
                    animationDelay: `${dly.toFixed(2)}s`,
                  } as React.CSSProperties
                }
              >
                <div className="bln">
                  <span className="bln-name">{t.k}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="ac-toolcard">
          {card ? (
            <>
              <div className="tc-top">
                <span className="tc-dot" style={{ background: cardCol, boxShadow: `0 0 8px ${cardCol}` }} />
                <b>{card.k}</b>
                <span className="tc-n">{num(card.v)} calls</span>
              </div>
              <div className="tc-expl">{TOOL_EXPL[card.k] || "A tool used across these runs."}</div>
              <div className="tc-bar">
                <i style={{ width: `${cardW}%`, background: cardCol }} />
              </div>
              <div className="tc-cap">
                {cardW}% of the busiest tool · {tools[0]?.k}
              </div>
            </>
          ) : (
            <span className="muted">Hover a tool balloon to see what it does and how often it ran.</span>
          )}
        </div>
      </div>
    );
  }

  // model-gen / subagent: REAL minute total + honest explanation only (no PD bars)
  return (
    <div className="ac-detail ac-centered">
      {head}
      <div className="ac-dexpl big">{phase.expl}</div>
      <div className="ac-dnote">
        {fmtMin(phase.val)} of active compute ({pctv}% of the {fmtMin(phTot)} total) — summed straight from each
        session&apos;s measured active-time split. No per-turn breakdown is shown here; these are the real minute totals.
      </div>
    </div>
  );
}

/* ============================================================================
 * PANEL 2 — When you work · hour × weekday (CLIENT-DERIVED punchcard)
 * ========================================================================== */

const DOWLAB = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ROW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun

type PersonaPeriod = "morning" | "afternoon" | "evening" | "night";

/** hue by time-of-day BAND (distinct from persona periods — chat: midday = YELLOW).
 *  late-night 22–6 → 300 (magenta) · morning 6–11 → 150 · midday 11–16 → 95 (yellow) · evening 16–22 → 255 */
function hueFor(h: number): number {
  if (h >= 22 || h < 6) return 300;
  if (h < 11) return 150;
  if (h < 16) return 95;
  return 255;
}

/** persona period (time-of-day-states.md boundaries — NOT the hue bands). */
function personaOf(h: number): PersonaPeriod {
  if (h >= 6 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "afternoon";
  if (h >= 18 && h < 22) return "evening";
  return "night";
}

interface Bucket {
  n: number;
  cost: number;
}

function WhenPanel({ sessions }: { sessions: SessionRow[] }) {
  const { grid, maxN, peakKey, periods, nightRuns, missing } = useMemo(() => {
    const g: Record<string, Bucket> = {};
    let miss = 0;
    for (const s of sessions) {
      if (!s.start_ts) {
        miss++;
        continue;
      }
      const d = new Date(s.start_ts);
      if (Number.isNaN(d.getTime())) {
        miss++;
        continue;
      }
      const k = d.getUTCDay() + "|" + d.getUTCHours();
      const b = g[k] || (g[k] = { n: 0, cost: 0 });
      b.n++;
      b.cost += s.cost_usd;
    }
    let mn = 0;
    let pk: string | null = null;
    const per: Record<PersonaPeriod, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    let night = 0;
    for (const k of Object.keys(g)) {
      const b = g[k];
      if (b.n > mn) {
        mn = b.n;
        pk = k;
      }
      const h = +k.split("|")[1];
      per[personaOf(h)] += b.n;
      if (h < 6 || h >= 22) night += b.n;
    }
    return { grid: g, maxN: mn || 1, peakKey: pk, periods: per, nightRuns: night, missing: miss };
  }, [sessions]);

  // persona state — REAL peak period, with ?when= override for screenshots/QA
  const force = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("when") : null;
  const dataPeak = (Object.keys(periods) as PersonaPeriod[]).sort((a, b) => periods[b] - periods[a])[0];
  const peakP: PersonaPeriod =
    force && Object.prototype.hasOwnProperty.call(periods, force) ? (force as PersonaPeriod) : dataPeak;

  const pk = peakKey ? peakKey.split("|") : ["1", "2"];
  const peakHour = +pk[1];
  const peakLab = (peakHour % 12 || 12) + (peakHour < 12 ? "am" : "pm");
  const peakDow = DOWLAB[+pk[0]];

  return (
    <div className="dpanel whenpanel">
      <div className="when-head">
        <h4>When you work · hour × weekday</h4>
        <WhenNote
          peakP={peakP}
          periods={periods}
          nightRuns={nightRuns}
          peakDow={peakDow}
          peakLab={peakLab}
          missing={missing}
        />
      </div>
      <div className="punchwrap">
        <div className="punch" style={{ gridTemplateColumns: "52px repeat(24,1fr)" }}>
          {/* clock bar (decorative celestial sprites) */}
          <div className="pcorner" />
          <div className="pclockbar" style={{ gridColumn: "2 / -1" }}>
            <span className="cel" style={{ left: "7%" }}>
              <Sprite mount={(h) => void mountIcon(h, "moon", 2)} />
            </span>
            <span className="cel" style={{ left: "27%" }}>
              <Sprite mount={(h) => void mountIcon(h, "sun", 2)} />
            </span>
            <span className="cel" style={{ left: "50%" }}>
              <Sprite mount={(h) => void mountIcon(h, "sun", 3)} />
            </span>
            <span className="cel" style={{ left: "73%" }}>
              <Sprite mount={(h) => void mountIcon(h, "sun", 2)} />
            </span>
            <span className="cel" style={{ left: "95%" }}>
              <Sprite mount={(h) => void mountIcon(h, "moon", 2)} />
            </span>
          </div>

          {/* hour header row */}
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={"hh" + h} className="phh">
              {h % 3 === 0 ? h : ""}
            </div>
          ))}

          {/* 7 weekday rows × 24 hour cells */}
          {ROW_ORDER.map((dow) => (
            <PunchRow key={dow} dow={dow} grid={grid} maxN={maxN} peakKey={peakKey} />
          ))}
        </div>
        <div className="punch-leg">
          {(
            [
              ["late night", 300, "10pm–6am"],
              ["morning", 150, "6–11am"],
              ["midday", 95, "11am–4pm"],
              ["evening", 255, "4–10pm"],
            ] as [string, number, string][]
          ).map(([lab, hue, span]) => (
            <span key={lab}>
              <i
                style={{
                  background: `oklch(0.66 0.18 ${hue})`,
                  boxShadow: `0 0 7px oklch(0.66 0.18 ${hue} / .8)`,
                }}
              />
              {lab} <em>{span}</em>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function PunchRow({
  dow,
  grid,
  maxN,
  peakKey,
}: {
  dow: number;
  grid: Record<string, Bucket>;
  maxN: number;
  peakKey: string | null;
}) {
  return (
    <>
      <div className="prl">{DOWLAB[dow]}</div>
      {Array.from({ length: 24 }, (_, hh) => {
        const key = dow + "|" + hh;
        const b = grid[key];
        const night = hh < 6 || hh >= 22;
        if (!b || !b.n) return <div key={key} className={"pcell" + (night ? " night" : "")} />;
        const q = b.n / maxN;
        const hue = hueFor(hh);
        const isPk = key === peakKey;
        const l = (0.46 + q * 0.28).toFixed(2);
        const ch = (0.1 + q * 0.14).toFixed(2);
        const al = (0.2 + q * 0.8).toFixed(2);
        return (
          <div
            key={key}
            className={"pcell on" + (isPk ? " peak" : "")}
            title={`${DOWLAB[dow]} ${hh % 12 || 12}${hh < 12 ? "am" : "pm"} — ${b.n} runs · ${usd(b.cost, false)}`}
            style={{
              background: `oklch(${l} ${ch} ${hue} / ${al})`,
              boxShadow: `0 0 ${(q * 8).toFixed(0)}px oklch(0.72 0.16 ${hue} / ${(q * 0.5).toFixed(2)})`,
            }}
          >
            {isPk && <Sprite mount={(h) => void mountIcon(h, "star", 2)} />}
          </div>
        );
      })}
    </>
  );
}

function WhenNote({
  peakP,
  periods,
  nightRuns,
  peakDow,
  peakLab,
  missing,
}: {
  peakP: PersonaPeriod;
  periods: Record<PersonaPeriod, number>;
  nightRuns: number;
  peakDow: string;
  peakLab: string;
  missing: number;
}) {
  // persona mascot host — single key remounts the right sprite per state
  const mascot =
    peakP === "night" ? (
      <span className="owl-host">
        <Sprite mount={(h) => void mountOwl(h, 4)} className="owl-cv" />
      </span>
    ) : peakP === "morning" ? (
      <span className="owl-host">
        <Sprite mount={(h) => void mountBird(h, 4)} className="bird-cv" />
      </span>
    ) : (
      <span className="owl-host">
        <Sprite mount={(h) => void mountMascot(h, 4)} />
        <Sprite mount={(h) => void mountIcon(h, peakP === "afternoon" ? "sun" : "moon", 3)} />
      </span>
    );

  let opener: JSX.Element;
  if (peakP === "night")
    opener = (
      <>
        <b>{num(nightRuns)} runs</b> in the witching hours (10pm–6am) — certified night owl; your circadian rhythm files
        a complaint.
      </>
    );
  else if (peakP === "morning")
    opener = (
      <>
        <b>{num(periods.morning)} morning runs</b> — early bird, and you get the worm.
      </>
    );
  else if (peakP === "afternoon")
    opener = (
      <>
        <b>{num(periods.afternoon)} afternoon runs</b> — peak-of-day grinder; post-lunch productivity, respect.
      </>
    );
  else
    opener = (
      <>
        <b>{num(periods.evening)} evening runs</b> — golden-hour shipper, winding down by building more.
      </>
    );

  return (
    <span className="when-note">
      {mascot}
      <span>
        {opener} Busiest hour:{" "}
        <b>
          {peakDow}s ~{peakLab}
        </b>
        .
        {missing > 0 && (
          <span className="when-lead">
            {" "}
            ({num(missing)} session{missing === 1 ? "" : "s"} without a start time excluded.)
          </span>
        )}
      </span>
    </span>
  );
}

/* ============================================================================
 * PANEL 3 — Context re-read overhead (REAL; the "N×" reframe)
 *
 * The N× ratio + the stacked bar are anchored to the SAME quantities so they
 * agree: fed = reread_tokens + input_fresh.
 *   N×       = round(reread_tokens / input_fresh)
 *   re-read% = reread / fed   ·   fresh% = input_fresh / fed
 * We deliberately do NOT render `overhead_pct_of_input` (the cache-read FLOOR
 * share, ~11%) here: it is the OLD "small fixed floor" framing the redesign moves
 * away from, and labeling the complement "fresh" would be false (true fresh is
 * a fraction of a percent of ALL input). See the calibration-reconciliation note.
 * ========================================================================== */

function OverheadPanel({ data }: { data: DashboardData }) {
  const co = data.totals.context_overhead;
  const { isAll } = useWindow();
  if (!co || co.reread_tokens <= 0) return null;

  const fresh = data.totals.tokens.input_fresh;
  const mult = fresh > 0 ? Math.round(co.reread_tokens / fresh) : 0;
  const fed = co.reread_tokens + fresh;
  const freshPct = fed > 0 ? (fresh / fed) * 100 : 0;
  const rereadPct = 100 - freshPct;
  const saved = co.reread_saved_usd;

  return (
    <div className="ovpanel">
      <div className="ov-head">
        <h4>Context re-read · the hidden bulk</h4>
        <span>why token counts dwarf the actual work{!isAll && " · all-time (not windowed)"}</span>
      </div>
      <div className="ov-body">
        <div className="ov-hero">
          <div className="ov-big">{num(mult)}×</div>
          <div className="ov-cap">
            context tokens re-read from cache for every <b>1 fresh</b> token of new input.
          </div>
        </div>
        <div className="ov-right">
          <div className="ov-bar" aria-hidden>
            <div className="ov-reread" style={{ width: `${rereadPct.toFixed(1)}%` }}>
              <span>{rereadPct.toFixed(0)}% re-read context</span>
            </div>
            <div className="ov-fresh" style={{ width: `${freshPct.toFixed(2)}%` }} />
          </div>
          <div className="ov-stats">
            <div className="ov-stat">
              <div className="k">tokens fed (re-read)</div>
              <div className="v">{tokAbbr(co.reread_tokens)}</div>
            </div>
            <div className="ov-stat">
              <div className="k">genuinely fresh</div>
              <div className="v cy">
                {tokAbbr(fresh)} · {pct(freshPct, freshPct < 1 ? 2 : 1)}
              </div>
            </div>
            <div className="ov-stat">
              <div className="k">re-read share</div>
              <div className="v">{pct(rereadPct, 1)}</div>
            </div>
            {saved != null && (
              <div className="ov-stat">
                <div className="k">saved vs fresh-rate</div>
                <div className="v li">
                  ~{usd(saved, false)} <Est>est</Est>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="tl-cap">
        ≈{num(mult)}× context tokens were re-read from cache for every 1 fresh input token — served cheaply (cache reads
        are ~10× cheaper than fresh). This is a normal fixed cost; it&apos;s only a worry if fresh input stays near zero.{" "}
        <Est /> Your billing dashboard is authoritative.
      </div>
    </div>
  );
}

/* ============================================================================
 * Tab root
 * ========================================================================== */

export function DistributionsTab({ data }: { data: DashboardData }) {
  const { sessions } = useWindow();
  return (
    <>
      <ComputePanel sessions={sessions} />
      <WhenPanel sessions={sessions} />
      <OverheadPanel data={data} />
    </>
  );
}
