/* Awards — an arcade "ceremony" that crowns each playful, HONEST superlative on a
 * glowing podium pedestal with its own pixel sprite, hero number, and session
 * drill-down. Window-reactive (reads useWindow().sessions), consistent with the
 * other panels. Every number is measured (verbatim deriveAwards()); the redesign
 * adds visual identity, the faux→real "Real MVP" reveal, and adaptive work-life
 * framing (praise ↔ nudge) — never a fabricated value.
 *
 * Reduced motion is the in-app "reduce animations" toggle (usePrefersReducedMotion):
 * it skips the reveal timers + auto-rotate here, while the canvas engine + the global
 * `.tt-reduced *` CSS rule neutralise the sprite/keyframe decoration in lockstep. */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useWindow } from "../useWindow";
import { Sprite } from "../Sprite";
import { usePrefersReducedMotion } from "../helpers";
import { confettiBurst, mountBeachScene, mountKind, mountMascot, mountSwarm } from "../spriteEngine";
import { deriveAwards, resolveView, type AwardSession, type AwardView } from "../awards";

// `drama` was a demo dial in the prototype (1–10); production runs it hot so the
// hero pulse + crowning confetti are on. The fairy-dust path (drama≥6) is NOT wired —
// it's a global fullscreen effect, explicitly demo-only.
const DRAMA = 7;
const FAUX_MS = 2600;
const BUST_MS = 950;

const stripTrailingEmoji = (s: string): string =>
  (s || "").replace(/[\s\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}\u{20E3}]+$/u, "").trim();

/* ---- pixel sprite host (reuses the house <Sprite> mount wrapper) --------- */
function Px({ kind, scale, tier, className }: { kind: string; scale?: number; tier?: string; className?: string }) {
  return <Sprite className={className} mount={(host) => mountKind(host, kind, { scale, tier })} />;
}

/* ---- pedestal: a glowing plinth the sprite stands on --------------------- */
function Pedestal({ tone, meta, sprite, scale, tier, crown, crownDrop }: {
  tone: string; meta?: string; sprite: string; scale?: number; tier?: string; crown?: boolean; crownDrop?: boolean;
}) {
  return (
    <div className="ped-wrap">
      {crown ? <div className={`crown-mount ${crownDrop ? "drop" : ""}`}><Px kind="crown" scale={5} /></div> : null}
      <div className="sprite-mount bob"><Px kind={sprite} scale={scale} tier={tier} /></div>
      <div className={`ped ${tone}`}>{meta ? <span className="ped-meta">{meta}</span> : null}</div>
    </div>
  );
}

/* ---- session drill-down link --------------------------------------------- */
function SessionLink({ s, cls }: { s?: AwardSession; cls?: string }) {
  if (!s) return null;
  return (
    <a className={cls || "aw-link"} href={`#/sessions/${encodeURIComponent(s.id)}`} title={`Open session ${s.id}`}>
      <span aria-hidden="true">▸</span> see “{s.project}” · {s.date} →
    </a>
  );
}

/* ---- stage background hook (swarm bots / beach scene) -------------------- */
function useStageBg(ref: RefObject<HTMLDivElement | null>, bg?: string) {
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (!bg || !ref.current) return;
    const host = (ref.current.closest(".stage") as HTMLElement) || ref.current;
    let stop: (() => void) | undefined;
    if (bg === "swarm") stop = mountSwarm(host, { count: 14, scale: 3 });
    else if (bg === "beach") stop = mountBeachScene(host);
    return () => stop?.();
    // re-mount on a reduced-motion flip (the engine reads isReduced() at mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bg, reduced]);
}

/* ---- single-beat award on the pedestal stage ----------------------------- */
function AwardStage({ view }: { view: AwardView }) {
  const beat = view.beat!;
  const ref = useRef<HTMLDivElement>(null);
  useStageBg(ref, view.bg);
  return (
    <div className="stage-card enter" ref={ref} style={{ ["--aw" as string]: view.accent }}>
      <div className="stage-pos">▸ Now crowning</div>
      <Pedestal tone={view.block!} meta={view.tagline} sprite={view.sprite!} scale={view.scale} tier={view.tier} />
      <div className="ped-floor" />
      <div className="aw-head">{stripTrailingEmoji(beat.headline)}</div>
      <div className="aw-bignum pulse">{beat.value}</div>
      {beat.unit ? <span className="unit">{beat.unit}</span> : null}
      <p className="aw-comment">{beat.comment}</p>
      <SessionLink s={beat.session} />
    </div>
  );
}

/* ---- The Real MVP reveal: faux → busted → real --------------------------- */
function RevealStage({ view }: { view: AwardView }) {
  const award = view.award!;
  const faux = award.beats[0], real = award.beats[1];
  const reduced = usePrefersReducedMotion();
  const auto = !reduced;
  const [phase, setPhase] = useState<"faux" | "busted" | "real">(reduced ? "real" : "faux");
  const [replay, setReplay] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);

  const fire = useCallback(() => {
    if (reduced) return;
    confettiBurst({ host: hostRef.current, count: Math.round(34 + DRAMA * 9), y: (hostRef.current?.clientHeight || 392) * 0.32 });
  }, [reduced]);

  useEffect(() => {
    if (!auto) return;
    setPhase("faux");
    const t1 = window.setTimeout(() => setPhase("busted"), FAUX_MS);
    const t2 = window.setTimeout(() => { setPhase("real"); fire(); }, FAUX_MS + BUST_MS);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [replay, auto, fire]);

  // Reduced-motion: show the REAL beat directly + a faux-note. NB: no `empty` class
  // here (it would hit `.empty .aw-bignum{display:none}` and hide the real number).
  if (reduced) {
    return (
      <div className="stage-card reveal-static" ref={hostRef} style={{ ["--aw" as string]: "var(--lime)" }}>
        <div className="stage-pos">The honesty reveal · <b>faux → real</b></div>
        <Pedestal tone="gold" meta="True MVP" sprite="trophy" scale={7} crown />
        <div className="ped-floor" />
        <span className="reveal-tag real"><i className="dot" /> Active compute · the real grind</span>
        <div className="aw-head">{stripTrailingEmoji(real.headline)}</div>
        <div className="aw-bignum">{real.value}</div>
        {real.unit ? <span className="unit">{real.unit}</span> : null}
        <p className="aw-comment">{real.comment}</p>
        <SessionLink s={real.session} />
        <p className="faux-note">Looked like <b>{faux.value} {faux.unit}</b> on “{faux.session?.project}” — but that was 100% idle. The clock lies; this doesn't.</p>
      </div>
    );
  }

  const isReal = phase === "real";
  return (
    <div className={`stage-card ${isReal ? "enter" : ""}`} ref={hostRef} style={{ ["--aw" as string]: isReal ? "var(--lime)" : "var(--magenta)" }}>
      {isReal ? (
        <>
          <div className="stage-pos">Beat 2 · <b>the truth</b></div>
          <Pedestal tone="gold" meta="True MVP" sprite="trophy" scale={7} crown crownDrop />
          <div className="ped-floor" />
          <span className="reveal-tag real"><i className="dot" /> Active compute · the real grind</span>
          <div className="aw-head">{stripTrailingEmoji(real.headline)}</div>
          <div className="aw-bignum pulse">{real.value}</div>
          {real.unit ? <span className="unit">{real.unit}</span> : null}
          <p className="aw-comment">{real.comment}</p>
          <SessionLink s={real.session} />
          <div className="reveal-ctrl"><button className="reveal-btn" onClick={() => setReplay((r) => r + 1)}>↻ Replay the reveal</button></div>
        </>
      ) : (
        <>
          <div className="stage-pos">Beat 1 · <b>the setup</b></div>
          <Pedestal tone="dim" meta="Looks epic…" sprite="trophy" scale={7} />
          <div className="ped-floor" />
          <span className="reveal-tag faux"><i className="dot" /> Wall-clock · looks legendary</span>
          <div className="aw-head">{stripTrailingEmoji(faux.headline)}</div>
          <div className="aw-bignum-wrap">
            <div className={`aw-bignum ${phase === "busted" ? "deflate" : ""}`}>{faux.value}</div>
            {phase === "busted" ? <div className="busted stamp">100% idle</div> : null}
          </div>
          {faux.unit ? <span className="unit">{faux.unit}</span> : null}
          <p className="aw-comment">{faux.comment}</p>
          <SessionLink s={faux.session} />
          <div className="reveal-track" aria-hidden="true"><i className={phase === "faux" ? "run" : ""} /></div>
        </>
      )}
    </div>
  );
}

/* ---- honest empty state -------------------------------------------------- */
function EmptyStage({ view }: { view: AwardView }) {
  return (
    <div className="stage-card enter empty" style={{ ["--aw" as string]: view.accent }}>
      <div className="stage-pos">Up for grabs · <b>{view.tagline}</b></div>
      <Pedestal tone="dim" meta="No winner yet" sprite={view.sprite!} scale={view.scale} tier={view.tier} />
      <div className="ped-floor" />
      <div className="aw-head empty-head">{view.title}</div>
      <span className="empty-seed" aria-hidden="true">🌱</span>
      <p className="empty-copy">{view.empty_copy}</p>
      <span className="empty-pill">Honest blank · not a zero</span>
    </div>
  );
}

/* ---- a stage that renders the right face for a view ---------------------- */
function Stage({ view }: { view: AwardView }) {
  if (view.isReveal) return <RevealStage view={view} />;
  if (view.empty) return <EmptyStage view={view} />;
  return <AwardStage view={view} />;
}

/* ---- leaderboard roster -------------------------------------------------- */
function Rail({ views, active, onPick, accent, dur, paused, restartKey }: {
  views: AwardView[]; active: number; onPick: (i: number) => void; accent: string; dur: number; paused: boolean; restartKey: number;
}) {
  return (
    <>
      <div className="rail" role="tablist" aria-label="awards">
        {views.map((v, i) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={i === active}
            className={`rail-chip ${i === active ? "on" : ""} ${v.empty ? "empty" : ""}`}
            style={{ ["--c" as string]: v.accent }}
            onClick={() => onPick(i)}
          >
            <span className="rail-mini"><Px kind={v.sprite!} scale={2} tier={v.tier} /></span>
            <span>{v.title}</span>
          </button>
        ))}
      </div>
      <div className="rail-prog" style={{ ["--aw" as string]: accent, ["--dur" as string]: dur + "ms" }}>
        <i className={!paused ? "run" : ""} key={`${active}-${dur}-${paused}-${restartKey}`} />
      </div>
    </>
  );
}

/* ---- Trophy Wall: every award as a mini-pedestal card -------------------- */
function TrophyWall({ views }: { views: AwardView[] }) {
  return (
    <div className="wall">
      {views.map((v) => {
        if (v.isReveal) {
          const faux = v.award!.beats[0], real = v.award!.beats[1];
          return (
            <div key={v.id} className="tw-card feature" style={{ ["--c" as string]: "var(--gold)" }}>
              <span className="tw-rank">★ Headliner</span>
              <Pedestal tone="gold" meta="True MVP" sprite="trophy" scale={6} crown />
              <div className="tw-feat-main">
                <div className="tw-feat-faux"><span className="t">Faux wall-clock</span><span className="v">{faux.value}</span></div>
                <div className="tw-head" style={{ marginTop: 0 }}>The Real MVP</div>
                <div className="tw-value">{real.value}</div>
                <div className="tw-unit">{real.unit} · the real grind</div>
                <p className="tw-comment">{real.comment}</p>
                <SessionLink s={real.session} cls="tw-link" />
              </div>
            </div>
          );
        }
        if (v.empty) {
          return (
            <div key={v.id} className="tw-card empty" style={{ ["--c" as string]: v.accent }}>
              <span className="tw-rank">{v.tagline}</span>
              <Pedestal tone="dim" meta="No winner" sprite={v.sprite!} scale={4} tier={v.tier} />
              <div className="tw-head empty-head">{v.title}</div>
              <span className="empty-seed" aria-hidden="true">🌱</span>
              <p className="tw-comment">{v.empty_copy}</p>
              <span className="empty-pill">Honest blank</span>
              <div style={{ height: 16 }} />
            </div>
          );
        }
        const beat = v.beat!;
        return (
          <div key={v.id} className="tw-card" style={{ ["--c" as string]: v.accent }}>
            <span className="tw-rank">{v.tagline}</span>
            <Pedestal tone={v.block!} sprite={v.sprite!} scale={Math.max(3, (v.scale || 5) - 2)} tier={v.tier} />
            <div className="tw-head">{stripTrailingEmoji(beat.headline)}</div>
            <div className="tw-value">{beat.value}</div>
            {beat.unit ? <div className="tw-unit">{beat.unit}</div> : null}
            <p className="tw-comment">{beat.comment}</p>
            <SessionLink s={beat.session} cls="tw-link" />
          </div>
        );
      })}
    </div>
  );
}

/* ---- the cabinet (panel shell) ------------------------------------------- */
export function AwardsPanel() {
  const { sessions } = useWindow();
  const reduced = usePrefersReducedMotion();
  const awards = useMemo(() => deriveAwards(sessions), [sessions]);
  const views = useMemo(() => awards.map((a) => resolveView(a, "auto")), [awards]);

  const [layout, setLayout] = useState<"stage" | "wall">("stage");
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [nonce, setNonce] = useState(0); // bump to restart the dwell timer on a manual pick
  const pick = (i: number) => { setActive(i); setNonce((n) => n + 1); };

  const safeActive = Math.min(active, views.length - 1);
  const view = views[safeActive];
  const award = awards[safeActive];
  const accent = view?.accent ?? "var(--cyan)";
  const dur = award?.reveal ? 8800 : 7000; // the reveal needs longer to play out

  useEffect(() => {
    if (layout !== "stage" || paused || reduced || awards.length <= 1) return;
    const id = window.setTimeout(() => setActive((a) => (a + 1) % awards.length), dur);
    return () => window.clearTimeout(id);
  }, [active, nonce, paused, layout, dur, awards.length, reduced]);

  if (!views.length) return null;

  return (
    <section className="awards" aria-label="Awards · the fun stats">
      <header className="cab-head">
        <div className="cab-mascot"><Sprite mount={(host) => mountMascot(host, 3)} /></div>
        <div className="cab-kicker">
          <span className="k1">★ Token Torch Awards</span>
          <span className="k2">Awards · the fun stats</span>
        </div>
        <span className="cab-rule" />
        <div className="cab-meta">
          <span className="cab-count"><b>{awards.length}</b> awards</span>
          <button
            className={`cab-pill ${layout === "wall" ? "idle" : ""}`}
            onClick={() => setLayout((l) => (l === "stage" ? "wall" : "stage"))}
            title={layout === "stage" ? "Switch to the trophy wall" : "Back to the ceremony"}
          >
            {layout === "stage" ? <><i className="dot" /> Now showing</> : <>▦ Trophy wall</>}
          </button>
        </div>
      </header>

      <div className="cab-body">
        {layout === "stage" ? (
          <>
            <div
              className="stage"
              style={{ ["--aw" as string]: accent }}
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
            >
              <Stage key={`${safeActive}-${view.face || "x"}`} view={view} />
            </div>
            <Rail views={views} active={safeActive} onPick={pick} accent={accent} dur={dur} paused={paused || reduced} restartKey={nonce} />
          </>
        ) : (
          <TrophyWall views={views} />
        )}

        <div className="cab-foot">
          <span>🔦 <b>Honest by design</b> — measured numbers only, no fabricated zeros.</span>
        </div>
      </div>
    </section>
  );
}
