/* Playful, HONEST awards derived from real session rows. Numbers come straight from
 * SessionRow fields (no fabrication). The redesign layers two things on top, neither
 * of which alters a measured value:
 *   1. per-award visual identity (accent / sprite / pedestal tone), and
 *   2. ADAPTIVE framing for the work-life awards (off-hours, weekend): each carries a
 *      `praise` face and a `nudge` face, chosen from the MEASURED share vs a threshold —
 *      healthy boundaries get praised, heavy off-hours work gets a caring nudge to rest.
 *      We never hand out a badge for grinding.
 * The Marathon is a two-beat reveal (faux idle-inflated → real active). Awards with no
 * qualifying data degrade to an honest empty state, never invented.
 *
 * resolveView(award, mode) (below) maps a raw award → the displayed "view". It is the
 * single contract the panel renders from. mode "auto" = data-driven (share>=threshold ⇒
 * nudge); "praise"/"nudge" force a face. */
import type { SessionRow } from "../types";

export interface AwardSession {
  id: string;
  project: string;
  date: string;
}
export interface AwardBeat {
  headline: string; // e.g. "The Real MVP 🏆"
  value: string; // the hero figure, split from its unit, e.g. "4h 41m"
  unit?: string; // the unit pill, e.g. "active" / "wall-clock" / "subagents"
  comment: string; // playful template line (cites real numbers)
  session?: AwardSession;
}
/** One face of an adaptive award (praise or nudge). Carries its own identity + beat. */
export interface AwardFace {
  title: string;
  emoji: string;
  sprite: string; // sprite-engine key
  scale: number;
  block: string; // pedestal glow tone: "gold" | "silver" | "bronze" | "dim"
  tier?: string;
  tagline: string;
  bg?: string; // ambient stage scene: "beach" | "swarm"
  headline: string;
  value: string;
  unit?: string;
  comment: string;
}
export type AwardId = "marathon" | "offhours" | "weekend" | "swarm";
export interface Award {
  id: AwardId;
  emoji: string;
  title: string;
  beats: AwardBeat[];
  empty?: boolean; // true → honest "no data" state
  empty_copy?: string;
  /** Visual identity (optional; resolveView falls back to AWARD_IDENTITY). */
  accent?: string;
  block?: string;
  sprite?: string;
  scale?: number;
  tier?: string;
  tagline?: string;
  bg?: string;
  /** The Marathon two-beat honesty reveal. */
  reveal?: boolean;
  /** Render the baby-bot swarm behind the stage (Subagent Swarm). */
  swarmBg?: boolean;
  /** Adaptive work-life award (off-hours, weekend). */
  adaptive?: boolean;
  share?: number; // measured % (0–100) used for the threshold decision
  threshold?: number; // share >= this ⇒ show the nudge face
  session?: AwardSession;
  praise?: AwardFace;
  nudge?: AwardFace;
}

const NO_RUNS = "No qualifying runs yet — that's an honest blank, not a zero. 🌱";

const ref = (s: SessionRow): AwardSession => ({ id: s.id, project: s.project, date: s.date });
const fmtH = (min: number): string => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const localHour = (iso: string): number => new Date(iso).getHours(); // local TZ (matches punchcard)
const weekday = (iso: string): number => new Date(iso).getDay(); // 0=Sun..6=Sat
const clockOf = (iso: string): string => {
  const t = new Date(iso), h = t.getHours();
  return `${(h % 12) || 12}:${String(t.getMinutes()).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
};
// off-hours window = 7pm–6am: hours 19–23 or 0–5. "Lateness" ranks how deep into the
// window a start is (7pm→0 … 5am→10) so the deepest off-hours run can be cited.
const inOffHours = (h: number): boolean => h >= 19 || h <= 5;
const offLateness = (h: number): number => (h >= 19 ? h - 19 : h <= 5 ? h + 5 : -1);

function marathon(rows: SessionRow[]): Award {
  const base = { id: "marathon" as const, emoji: "🏆", title: "The Real MVP" };
  if (!rows.length) return { ...base, beats: [], empty: true, empty_copy: NO_RUNS };
  const faux = [...rows].sort((a, b) => (b.active_min + b.idle_min) - (a.active_min + a.idle_min))[0];
  const real = [...rows].sort((a, b) => b.active_min - a.active_min)[0];
  const fauxWall = faux.active_min + faux.idle_min;
  const idlePct = fauxWall > 0 ? Math.round((faux.idle_min / fauxWall) * 100) : 0;
  return {
    ...base,
    reveal: true,
    beats: [
      {
        headline: "The Faux Marathon 🛋️",
        value: fmtH(fauxWall),
        unit: "wall-clock",
        comment: `“${faux.project}” looked like a ${fmtH(fauxWall)} epic… but ${idlePct}% of that was Claude waiting on you. 😴`,
        session: ref(faux),
      },
      {
        headline: "The Real MVP 🏆",
        value: fmtH(real.active_min),
        unit: "active",
        comment: `The REAL grind: “${real.project}” — ${fmtH(real.active_min)} of actual active compute. No idling. 🔥`,
        session: ref(real),
      },
    ],
  };
}

// ADAPTIVE — off-hours (7pm–6am). share = % of timestamped runs STARTING in that window;
// nudge at share >= 10%. The praise copy cites the (smaller) after-midnight share; the
// nudge cites the deepest off-hours start. No qualifying data → honest empty.
function offhours(rows: SessionRow[]): Award {
  const base = { id: "offhours" as const, emoji: "🌙", title: "Lights Out" };
  const withTs = rows.filter((r) => r.start_ts);
  if (!withTs.length) return { ...base, beats: [], empty: true, empty_copy: NO_RUNS };
  const offRuns = withTs.filter((r) => inOffHours(localHour(r.start_ts!)));
  const afterMid = withTs.filter((r) => { const h = localHour(r.start_ts!); return h >= 0 && h <= 5; }).length;
  const afterMidPct = Math.round((afterMid / withTs.length) * 100);
  const offShare = Math.round((offRuns.length / withTs.length) * 100);
  const deepest = offRuns
    .map((r) => ({ r, l: offLateness(localHour(r.start_ts!)) }))
    .sort((a, b) => b.l - a.l)[0]?.r;
  const clock = deepest ? clockOf(deepest.start_ts!) : "";
  const session = deepest ? ref(deepest) : undefined;
  const praise: AwardFace = {
    title: "Lights Out", emoji: "🌙", sprite: "moon", scale: 7, block: "silver", tagline: "Healthy hours",
    headline: "Lights Out 🌙", value: `${100 - afterMidPct}%`, unit: "before midnight",
    comment: deepest
      ? `Only ${afterMidPct}% of your runs start after midnight (your latest: a ${clock} session on “${deepest.project}”). You mostly sign off at a sane hour — nice. 🌙`
      : `Only ${afterMidPct}% of your runs start after midnight — you mostly sign off at a sane hour. Nice. 🌙`,
  };
  const nudge: AwardFace = {
    title: "Night Owl", emoji: "🦉", sprite: "owl", scale: 6, block: "bronze", tagline: "After Hours",
    headline: "Night Owl 🦉", value: clock || `${offShare}%`, unit: clock ? "deepest run" : "after dark",
    comment: clock
      ? `${offShare}% of your runs fire up between 7pm and 6am — your deepest kicked off at ${clock}. That's a lot of after-dark work; the agents can hold the fort, go get some rest. 🌙`
      : `${offShare}% of your runs fire up between 7pm and 6am — that's a lot of after-dark work; the agents can hold the fort, go get some rest. 🌙`,
  };
  return { ...base, beats: [], adaptive: true, accent: "--magenta", share: offShare, threshold: 10, session, praise, nudge };
}

// ADAPTIVE — weekend (Sat/Sun). share = % of timestamped runs on a weekend; nudge at
// share >= 5% (working most weekends isn't a badge). No timestamps → honest empty.
function weekend(rows: SessionRow[]): Award {
  const base = { id: "weekend" as const, emoji: "🌴", title: "Weekend Protector" };
  const withTs = rows.filter((r) => r.start_ts);
  if (!withTs.length) return { ...base, beats: [], empty: true, empty_copy: NO_RUNS };
  const wk = withTs.filter((r) => { const d = weekday(r.start_ts!); return d === 0 || d === 6; });
  const pct = Math.round((wk.length / withTs.length) * 100);
  const busiest = wk.length ? [...wk].sort((a, b) => b.active_min - a.active_min)[0] : undefined;
  const session = busiest ? ref(busiest) : undefined;
  const praise: AwardFace = {
    title: "Weekend Protector", emoji: "🌴", sprite: "palm", scale: 6, block: "bronze", tagline: "Off the Clock", bg: "beach",
    headline: "Weekend Protector 🌴", value: `${100 - pct}%`, unit: "on weekdays",
    comment: `Almost all of your runs land Monday–Friday — ${pct < 1 ? "under 1%" : `only ${pct}%`} touch a Saturday or Sunday. You keep your weekends your own. Keep protecting that downtime. 🌴`,
  };
  const nudge: AwardFace = {
    title: "Weekend Check-In", emoji: "📅", sprite: "calendar", scale: 7, block: "bronze", tagline: "Off the Clock",
    headline: "Weekend Check-In 📅", value: `${wk.length} run${wk.length === 1 ? "" : "s"}`, unit: `${pct}% on weekends`,
    comment: `${wk.length} of your runs (${pct}%) landed on a Saturday or Sunday — more than a healthy share. The diffs will still be there Monday; go enjoy your time off. 🌴`,
  };
  return { ...base, beats: [], adaptive: true, accent: "--amber", share: pct, threshold: 5, session, praise, nudge };
}

function swarm(rows: SessionRow[]): Award {
  const base = { id: "swarm" as const, emoji: "🤖", title: "Subagent Swarm" };
  const top = [...rows].sort((a, b) => b.subagents - a.subagents)[0];
  if (!top || top.subagents <= 0) return { ...base, beats: [], empty: true, empty_copy: NO_RUNS };
  return {
    ...base,
    swarmBg: true,
    beats: [{
      headline: "Subagent Swarm 🤖",
      value: `${top.subagents}`,
      unit: "subagents",
      comment: `One “${top.project}” run fanned out ${top.subagents} subagents in parallel — a whole AI swarm working at once. 🐝`,
      session: ref(top),
    }],
  };
}

export function deriveAwards(rows: SessionRow[]): Award[] {
  return [marathon(rows), offhours(rows), weekend(rows), swarm(rows)];
}

/* ============================================================================
 * View layer — identity + resolveView (ported from the prototype's components.jsx).
 * Pure: maps a raw award → the displayed "view" object the panel renders. New award
 * types need no bespoke render code — they flow through these four branches.
 * ========================================================================== */
export interface AwardIdentity {
  accent: string;
  block: string;
  sprite: string;
  scale: number;
  tier?: string;
  tagline: string;
}
// Identity for NON-adaptive awards (adaptive ones carry identity per-face).
export const AWARD_IDENTITY: Record<string, AwardIdentity> = {
  marathon: { accent: "--gold", block: "gold", sprite: "trophy", scale: 7, tagline: "Headliner" },
  swarm: { accent: "--cyan", block: "silver", sprite: "family", scale: 4, tagline: "Parallelism" },
  offhours: { accent: "--magenta", block: "bronze", sprite: "owl", scale: 6, tagline: "After Hours" },
  weekend: { accent: "--amber", block: "bronze", sprite: "palm", scale: 6, tagline: "Off the Clock" },
};

export type FaceMode = "auto" | "praise" | "nudge";
export interface AwardView {
  id: string;
  accent: string; // resolved `var(--x)` string
  title: string;
  sprite?: string;
  scale?: number;
  tier?: string;
  block?: string;
  tagline?: string;
  emoji?: string;
  bg?: string;
  face?: "praise" | "nudge";
  beat?: AwardBeat;
  isReveal?: boolean;
  award?: Award;
  empty?: boolean;
  empty_copy?: string;
  adaptive?: boolean;
  share?: number;
  threshold?: number;
}

export function resolveView(award: Award, mode: FaceMode): AwardView {
  const idt = AWARD_IDENTITY[award.id] || ({} as Partial<AwardIdentity>);
  const accent = `var(${award.accent || idt.accent || "--cyan"})`;

  if (award.empty) {
    return {
      id: award.id, empty: true, empty_copy: award.empty_copy, title: award.title, accent,
      block: "dim", sprite: award.sprite || idt.sprite, scale: award.scale || idt.scale,
      tier: award.tier || idt.tier, tagline: award.tagline || idt.tagline,
    };
  }
  if (award.reveal) {
    return {
      id: award.id, isReveal: true, award, accent: "var(--gold)", title: award.title,
      sprite: "trophy", block: "gold", scale: idt.scale || 7, tagline: idt.tagline || "Headliner",
    };
  }
  if (award.adaptive) {
    const heavy = mode === "nudge" || (mode !== "praise" && (award.share ?? 0) >= (award.threshold ?? Infinity));
    const f = (heavy ? award.nudge : award.praise)!;
    return {
      id: award.id, accent, title: f.title, emoji: f.emoji, sprite: f.sprite, scale: f.scale,
      tier: f.tier, block: f.block, tagline: f.tagline, face: heavy ? "nudge" : "praise", bg: f.bg,
      adaptive: true, share: award.share, threshold: award.threshold,
      beat: { headline: f.headline, value: f.value, unit: f.unit, comment: f.comment, session: award.session },
    };
  }
  // plain single-beat award
  return {
    id: award.id, accent, title: award.title, emoji: award.emoji, sprite: idt.sprite,
    scale: idt.scale, tier: idt.tier, block: idt.block, tagline: idt.tagline,
    bg: award.swarmBg ? "swarm" : award.bg, beat: award.beats[0],
  };
}
