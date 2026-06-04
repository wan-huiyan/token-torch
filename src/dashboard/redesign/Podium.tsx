/* ============================================================================
 * TOKEN TORCH redesign — Project leaderboard PODIUM.
 * Recreates 00-dashboard.html `.podwrap`/`.podium` + dashboard.js renderPodium
 * (the "max cuteness" mascot podium). Visual L→R order is [silver, gold, bronze]
 * = top indices [1, 0, 2]; class [r2, r1, r3]; mascot kind [cool, evil, nervous];
 * crown on rank 1 only. Binds the REAL projectAgg fields over the windowed pool.
 * Honesty: <Est/> on the bound $, Cents-rendered cost, content visible at rest.
 * ========================================================================== */
import { useState } from "react";
import type { DashboardData } from "../../types";
import type { ProjectAggRow } from "../windowAgg";
import { projectAgg } from "../windowAgg";
import { useWindow } from "../useWindow";
import { Sprite } from "../Sprite";
import { mountPodiumBot, spriteCanvas, sprites, PAL } from "../spriteEngine";
import { usd, pct } from "../helpers";
import { SecHead, Cents, Est } from "./ui";

type Kind = "evil" | "cool" | "nervous";
interface Slot {
  idx: number; // index into the top-3 (cost-desc) array
  rank: 1 | 2 | 3;
  cls: "r1" | "r2" | "r3";
  kind: Kind;
  medal: "GOLD" | "SILVER" | "BRONZE";
}

// Visual left→right order centres the winner: silver, gold, bronze.
const SLOTS: Slot[] = [
  { idx: 1, rank: 2, cls: "r2", kind: "cool", medal: "SILVER" },
  { idx: 0, rank: 1, cls: "r1", kind: "evil", medal: "GOLD" },
  { idx: 2, rank: 3, cls: "r3", kind: "nervous", medal: "BRONZE" },
];

/** The confessional speech-bubble — decorative personality copy keyed on rank
 *  (recreated verbatim from the prototype's podiumBubble templates). The `.bs`
 *  bottom line shows the real stats. */
function Bubble({ p, rank }: { p: ProjectAggRow; rank: 1 | 2 | 3 }) {
  let face: string;
  let line: JSX.Element;
  if (rank === 1) {
    face = "the big spender says…";
    line = (
      <>
        I torched <b>{usd(p.cost, false)}</b> — that's <b>{pct(p.share * 100, 0)}</b> of everything. {p.sessions} runs at
        ~{usd(p.cps, false)} each, and I once fanned out <b>{p.subsMax} subagents</b> in one go. Feed me more.
      </>
    );
  } else if (rank === 2) {
    face = "the efficient one says…";
    line = (
      <>
        <b>{usd(p.cost, false)}</b> over {p.sessions} runs, tidy. <b>{pct(p.cacheAvg, 1)}</b> cache hits — I barely re-read
        a thing.
      </>
    );
  } else {
    face = "the nervous one says…";
    line = p.ml ? (
      <>
        Only <b>{usd(p.cost, false)}</b>… but some of my runs are <b>main-loop fidelity</b>, so my real bill is higher.
        Please don't audit me.
      </>
    ) : (
      <>
        Just <b>{usd(p.cost, false)}</b> from {p.sessions} runs — I'm the little one. Be gentle.
      </>
    );
  }
  return (
    <div className="bubble" role="tooltip">
      <div className="bh">{face}</div>
      <p>“{line}”</p>
      <div className="bs">
        {usd(p.cost, false)} · {pct(p.share * 100, 1)} of spend · {p.sessions} runs · max {p.subsMax} subagents
      </div>
    </div>
  );
}

/** One pedestal: cost → name → share → mascot+bubble → block (rank/medal/runs). */
function Pod({ p, slot }: { p: ProjectAggRow; slot: Slot }) {
  const [show, setShow] = useState(false);
  const { rank, kind, cls, medal } = slot;
  return (
    <div className={"pod " + cls}>
      <div className="pcost">
        <Cents v={p.cost} /> <Est />
      </div>
      <div className="pname">{p.name}</div>
      <div className="pshare">{pct(p.share * 100, 1)} of spend</div>
      <div className={"botwrap" + (show ? " show" : "")} onClick={() => setShow((s) => !s)}>
        <Sprite
          className="botmount"
          mount={(host) => {
            const stop = mountPodiumBot(host, kind, 4);
            if (rank === 1) {
              const cr = spriteCanvas([sprites.CROWN], PAL.crown, 4);
              cr.className = "crown";
              host.appendChild(cr);
            }
            return stop;
          }}
        />
        <Bubble p={p} rank={rank} />
      </div>
      <div className="block">
        <div className="rk">#{rank}</div>
        <div className="bmeta">
          {medal}
          <br />
          {p.sessions} runs
        </div>
      </div>
    </div>
  );
}

export function Podium(_props: { data: DashboardData }) {
  const top = projectAgg(useWindow().sessions).slice(0, 3);
  // Honest-degrade: render only the pods that exist (never fabricate empties).
  const pods = SLOTS.map((slot) => ({ slot, p: top[slot.idx] })).filter(
    (x): x is { slot: Slot; p: ProjectAggRow } => Boolean(x.p),
  );

  return (
    <section className="sec">
      <SecHead title="Project leaderboard" n="winner's podium · by spend" />
      <div className="podwrap">
        <div className="podium">
          {pods.map(({ slot, p }) => (
            <Pod key={p.name} p={p} slot={slot} />
          ))}
        </div>
      </div>
    </section>
  );
}
