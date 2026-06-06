/* Awards — an auto-rotating "ceremony" carousel of playful, honest scorecards.
 * Window-reactive (reads useWindow().sessions), consistent with ComputePanel.
 * v1 renders the deterministic template comment; an AI-rewrite layer can set
 * beat.comment from the insights handshake later. All numbers are real. */
import { useEffect, useMemo, useState } from "react";
import { useWindow } from "../useWindow";
import { deriveAwards, type Award, type AwardBeat } from "../awards";
import { usePrefersReducedMotion } from "../helpers";

const ROTATE_MS = 7000;

type Slide = { award: Award; beat: AwardBeat | null };

export function AwardsPanel() {
  const { sessions } = useWindow();
  const awards = useMemo(
    () => deriveAwards(sessions).filter((a) => !a.empty || a.id === "marathon"),
    [sessions],
  );
  // flatten to beats so the two-beat Marathon plays as two slides
  const slides = useMemo<Slide[]>(
    () => awards.flatMap((a): Slide[] => (a.empty ? [{ award: a, beat: null }] : a.beats.map((beat) => ({ award: a, beat })))),
    [awards],
  );
  const [i, setI] = useState(0);
  const reduced = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (reduced || paused || slides.length <= 1) return;
    const t = setInterval(() => setI((p) => (p + 1) % slides.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [reduced, paused, slides.length]);

  if (!slides.length) return null;
  const idx = Math.min(i, slides.length - 1);
  const cur = slides[idx];

  return (
    <div className="dpanel awards" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <h4>Awards · the fun stats</h4>
      <div className="aw-stage" key={idx /* re-trigger the reveal animation on slide change */}>
        {cur.beat ? (
          <>
            <div className="aw-head">{cur.beat.headline}</div>
            <div className="aw-value">{cur.beat.value}</div>
            <p className="aw-comment">{cur.beat.comment}</p>
            {cur.beat.session && (
              <a className="aw-link" href={`#/sessions/${encodeURIComponent(cur.beat.session.id)}`}>
                see “{cur.beat.session.project}” · {cur.beat.session.date} →
              </a>
            )}
          </>
        ) : (
          <>
            <div className="aw-head">{cur.award.emoji} {cur.award.title}</div>
            <p className="aw-comment aw-empty">No qualifying runs yet — that's an honest blank, not a zero. 🌱</p>
          </>
        )}
      </div>
      <div className="aw-dots" role="tablist" aria-label="awards">
        {slides.map((_, j) => (
          <button
            key={j}
            className={"aw-dot" + (j === idx ? " on" : "")}
            aria-label={`award ${j + 1}`}
            aria-selected={j === idx}
            onClick={() => setI(j)}
          />
        ))}
      </div>
    </div>
  );
}
