import { useEffect, useRef, useState } from "react";
import type { DashboardData, ProjectRow } from "../types";
import { usd, pct, usePrefersReducedMotion } from "./helpers";
import { Section } from "./Section";
import { spriteCanvas } from "./sprites";
import { EVIL_FR, EVIL_PAL, COOL_FR, COOL_PAL, NERV_FR, NERV_PAL, CROWN, CROWN_PAL } from "./sprites";

type Rank = 1 | 2 | 3;

const CH: Record<Rank, { fr: typeof EVIL_FR; pal: typeof EVIL_PAL; mv: string; sw: "fast" | "blink" }> = {
  1: { fr: EVIL_FR, pal: EVIL_PAL, mv: "mv-evil", sw: "fast" },
  2: { fr: COOL_FR, pal: COOL_PAL, mv: "mv-cool", sw: "blink" },
  3: { fr: NERV_FR, pal: NERV_PAL, mv: "mv-nervous", sw: "fast" },
};

/** facts derived from a project's real sessions, for the confession bubble. */
function projFacts(name: string, sessions: DashboardData["sessions"]) {
  const ss = sessions.filter((s) => s.project === name);
  return {
    maxSub: Math.max(0, ...ss.map((s) => s.subagents)),
    mainLoop: ss.some((s) => s.fidelity === "main_loop"),
    avgCache: ss.reduce((t, s) => t + s.cache_pct, 0) / (ss.length || 1),
  };
}

/** The pixel mascot canvas + (rank-1) crown, with personality movement loop. */
function PodMascot({ rank }: { rank: Rank }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll("canvas").forEach((c) => c.remove());
    const sc = window.innerWidth < 560 ? 3 : 4;
    const c = CH[rank];
    const b = spriteCanvas(c.fr, c.pal, sc);
    b.className = "pbot " + c.mv;
    host.appendChild(b);
    let crown: HTMLCanvasElement | undefined;
    if (rank === 1) {
      crown = spriteCanvas([CROWN], CROWN_PAL, Math.max(2, sc - 1));
      crown.className = "crown";
      crown.style.top = "-4px";
      host.appendChild(crown);
    }
    let interval: number | undefined;
    let timeout: number | undefined;
    if (!reduced) {
      if (c.sw === "fast") {
        let k = 0;
        interval = window.setInterval(() => b._draw((k = 1 - k)), rank === 3 ? 190 : 360);
      } else {
        const lp = () => {
          timeout = window.setTimeout(() => {
            b._draw(1);
            timeout = window.setTimeout(() => {
              b._draw(0);
              lp();
            }, 150);
          }, 2000 + Math.random() * 1800);
        };
        lp();
      }
    }
    return () => {
      if (interval) window.clearInterval(interval);
      if (timeout) window.clearTimeout(timeout);
      b.remove();
      crown?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, rank]);
  return <div ref={hostRef} aria-hidden="true" style={{ display: "contents" }} />;
}

function Bubble({ p, rank, sessions }: { p: ProjectRow; rank: Rank; sessions: DashboardData["sessions"] }) {
  const f = projFacts(p.name, sessions);
  let head: string;
  let body: React.ReactNode;
  if (rank === 1) {
    head = "😈 the big spender says…";
    body = (
      <>
        I torched <b>{usd(p.cost_usd, false)}</b> — that's <b>{pct(p.cost_share * 100, 0)}</b> of everything you've spent.{" "}
        {p.sessions} runs at ~{usd(p.cost_per_session, false)} each, and I once fanned out <b>{f.maxSub} subagents</b> in
        one session. Feed me more.
      </>
    );
  } else if (rank === 2) {
    head = "😎 the efficient one says…";
    body = (
      <>
        <b>{usd(p.cost_usd, false)}</b> over {p.sessions} runs, nice and tidy. <b>{pct(f.avgCache, 1)}</b> cache hits — I
        barely re-read a thing. Slow and steady wins.
      </>
    );
  } else {
    head = "😰 the nervous one says…";
    body = f.mainLoop ? (
      <>
        Only <b>{usd(p.cost_usd, false)}</b>… but I'm <b>main-loop fidelity</b>, so my real bill is higher than this.
        Please don't audit me too closely.
      </>
    ) : (
      <>
        Just <b>{usd(p.cost_usd, false)}</b> from {p.sessions} run{p.sessions > 1 ? "s" : ""} — I'm the little one. Be
        gentle.
      </>
    );
  }
  return (
    <div className="bubble" role="tooltip">
      <div className="bh">{head}</div>
      <p>“{body}”</p>
      <div className="bs">
        {usd(p.cost_usd, false)} · {pct(p.cost_share * 100, 1)} of spend · {p.sessions} run{p.sessions > 1 ? "s" : ""} ·
        max {f.maxSub} subagents
      </div>
    </div>
  );
}

function Pedestal({ p, rank, sessions }: { p: ProjectRow; rank: Rank; sessions: DashboardData["sessions"] }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`pod r${rank}`}>
      <div className="pname">{p.name}</div>
      <div className="pcost">{usd(p.cost_usd, false)}</div>
      <div className="pshare">{pct(p.cost_share * 100, 1)} of spend</div>
      <button
        type="button"
        className={`botwrap${show ? " show" : ""}`}
        aria-label={`${p.name}: ${usd(p.cost_usd, false)}, ${pct(p.cost_share * 100, 1)} of spend. Toggle details.`}
        aria-expanded={show}
        onClick={() => setShow((s) => !s)}
      >
        <PodMascot rank={rank} />
        <Bubble p={p} rank={rank} sessions={sessions} />
      </button>
      <div className="block">
        <div className="rk">{rank}</div>
        <div className="bmeta">
          {p.sessions} run{p.sessions > 1 ? "s" : ""} · {usd(p.cost_per_session, false)}/run
        </div>
      </div>
    </div>
  );
}

export function Podium({ data }: { data: DashboardData }) {
  const P = data.projects;
  // center the winner: [#2, #1, #3]; guard for <3 projects.
  const order: { p: ProjectRow; rank: Rank }[] = [
    { p: P[1], rank: 2 },
    { p: P[0], rank: 1 },
    { p: P[2], rank: 3 },
  ].filter((o): o is { p: ProjectRow; rank: Rank } => Boolean(o.p));

  return (
    <Section title="Project leaderboard" n={`winner's podium · ${P.length}`}>
      <div className="podium">
        {order.map(({ p, rank }) => (
          <Pedestal key={p.name} p={p} rank={rank} sessions={data.sessions} />
        ))}
      </div>
    </Section>
  );
}
