/* Playful, HONEST awards derived from real session rows. Numbers come straight from
 * SessionRow fields (no fabrication). Each award has 1+ "beats"; the Marathon has two
 * (faux idle-inflated → real active). Awards with no qualifying data degrade to an
 * honest empty state, never invented. v1 voice = deterministic templates. */
import type { SessionRow } from "../types";

export interface AwardBeat {
  headline: string;            // e.g. "The Real MVP 🏆"
  value: string;               // the hero figure, e.g. "6h 12m active"
  comment: string;             // playful template line (cites real numbers)
  session?: { id: string; project: string; date: string };
}
export interface Award {
  id: "marathon" | "nightowl" | "weekend" | "swarm";
  emoji: string;
  title: string;
  beats: AwardBeat[];
  empty?: boolean;             // true → honest "no data" state
}

const ref = (s: SessionRow) => ({ id: s.id, project: s.project, date: s.date });
const fmtH = (min: number) => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const localHour = (iso: string) => new Date(iso).getHours();      // local TZ (matches punchcard)
const weekday = (iso: string) => new Date(iso).getDay();          // 0=Sun..6=Sat
// "nightness": how deep into the small hours a start is. 22:00→0 … 05:00→7. Non-night → -1.
const nightness = (h: number) => (h >= 22 ? h - 22 : h <= 5 ? h + 2 : -1);

function marathon(rows: SessionRow[]): Award {
  const base = { id: "marathon" as const, emoji: "🏆", title: "The Real MVP" };
  if (!rows.length) return { ...base, beats: [], empty: true };
  const faux = [...rows].sort((a, b) => (b.active_min + b.idle_min) - (a.active_min + a.idle_min))[0];
  const real = [...rows].sort((a, b) => b.active_min - a.active_min)[0];
  const fauxWall = faux.active_min + faux.idle_min;
  const idlePct = fauxWall > 0 ? Math.round((faux.idle_min / fauxWall) * 100) : 0;
  return {
    ...base,
    beats: [
      {
        headline: "The Faux Marathon 🛋️",
        value: `${fmtH(fauxWall)} wall-clock`,
        comment: `“${faux.project}” looked like a ${fmtH(fauxWall)} epic… but ${idlePct}% of that was Claude waiting on you. 😴`,
        session: ref(faux),
      },
      {
        headline: "The Real MVP 🏆",
        value: `${fmtH(real.active_min)} active`,
        comment: `The REAL grind: “${real.project}” — ${fmtH(real.active_min)} of actual active compute. No idling. 🔥`,
        session: ref(real),
      },
    ],
  };
}

function nightowl(rows: SessionRow[]): Award {
  const base = { id: "nightowl" as const, emoji: "🦉", title: "Night Owl" };
  const withTs = rows.filter((r) => r.start_ts);
  const night = withTs
    .map((r) => ({ r, n: nightness(localHour(r.start_ts!)) }))
    .filter((x) => x.n >= 0)
    .sort((a, b) => b.n - a.n)[0];
  if (!night) return { ...base, beats: [], empty: true };
  const afterMidnight = withTs.filter((r) => { const h = localHour(r.start_ts!); return h >= 0 && h <= 5; }).length;
  const pct = withTs.length ? Math.round((afterMidnight / withTs.length) * 100) : 0;
  const t = new Date(night.r.start_ts!);
  const clock = `${((t.getHours() % 12) || 12)}:${String(t.getMinutes()).padStart(2, "0")}${t.getHours() < 12 ? "am" : "pm"}`;
  return {
    ...base,
    beats: [{
      headline: "Night Owl 🦉",
      value: clock,
      comment: `Your deepest-night run on “${night.r.project}” kicked off at ${clock}. ${pct}% of your runs start after midnight. 🌙`,
      session: ref(night.r),
    }],
  };
}

function weekend(rows: SessionRow[]): Award {
  const base = { id: "weekend" as const, emoji: "📅", title: "Weekend Warrior" };
  const withTs = rows.filter((r) => r.start_ts);
  const wk = withTs.filter((r) => { const d = weekday(r.start_ts!); return d === 0 || d === 6; });
  if (!wk.length) return { ...base, beats: [], empty: true };
  const pct = withTs.length ? Math.round((wk.length / withTs.length) * 100) : 0;
  const busiest = [...wk].sort((a, b) => b.active_min - a.active_min)[0];
  return {
    ...base,
    beats: [{
      headline: "Weekend Warrior 📅",
      value: `${wk.length} run${wk.length === 1 ? "" : "s"}`,
      comment: `${wk.length} of your runs (${pct}%) happened on a Saturday or Sunday. Weekends are for the weak. 💪`,
      session: ref(busiest),
    }],
  };
}

function swarm(rows: SessionRow[]): Award {
  const base = { id: "swarm" as const, emoji: "🤖", title: "Subagent Swarm" };
  const top = [...rows].sort((a, b) => b.subagents - a.subagents)[0];
  if (!top || top.subagents <= 0) return { ...base, beats: [], empty: true };
  return {
    ...base,
    beats: [{
      headline: "Subagent Swarm 🤖",
      value: `${top.subagents} subagents`,
      comment: `One “${top.project}” run fanned out ${top.subagents} subagents in parallel — a whole AI swarm working at once. 🐝`,
      session: ref(top),
    }],
  };
}

export function deriveAwards(rows: SessionRow[]): Award[] {
  return [marathon(rows), nightowl(rows), weekend(rows), swarm(rows)];
}
