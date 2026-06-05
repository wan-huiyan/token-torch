/* Pure first-visit tour logic (Plan 7 / #16). React-free + storage-injected so it's
 * unit-testable. Steps point at the dashboard's HONESTY affordances via stable
 * `data-tour` anchors verified present in the live redesign tree (S14 re-validation):
 *   cost-est / coverage-flag / time-saved → Hero.tsx (always rendered)
 *   breakdown-link → the "Model & effort" tab button (DashboardPage)
 *   session-card → the sessions list (#sessBody)
 * The standalone data-tier badge step was DROPPED (hidden in the default cards view →
 * would silently skip); its "sourcing is tagged" point is folded into the coverage step. */
export interface TourStep {
  id: string;
  selector: string;
  title: string;
  body: string;
}

export const TOUR_SEEN_KEY = "tt_tour_seen_v1";

export const TOUR_STEPS: TourStep[] = [
  {
    id: "estimate",
    selector: '[data-tour="cost-est"]',
    title: "Costs are estimates",
    body: "Every dollar figure is an estimate from public per-model pricing — defer to your real Anthropic bill. Tap “how?” for the method.",
  },
  {
    id: "coverage",
    selector: '[data-tour="coverage-flag"]',
    title: "Honest coverage",
    body: "This split shows how much spend is fully measured vs. main-loop-only (subagents not attributed). Nothing is silently dropped — and each session in the table view is tagged with how its numbers were sourced (its data tier).",
  },
  {
    id: "timesaved",
    selector: '[data-tour="time-saved"]',
    title: "Parallel time saved",
    body: "Time saved by subagents is the span of their work minus the union of overlaps — a derived estimate with no authoritative source. It honestly reads zero when it can't be measured.",
  },
  {
    id: "breakdown",
    selector: '[data-tour="breakdown-link"]',
    title: "Breakdowns, not rankings",
    body: "The Model & effort view describes what differed — it never crowns a “winner.” Model versions are time-disjoint, so a breakdown is honest where a comparison would mislead.",
  },
  {
    id: "drillin",
    selector: '[data-tour="session-card"]',
    title: "Drill into any run",
    body: "Click any session to see its cost waterfall, time story, and exactly what it shipped.",
  },
];

const w = (): (Window & typeof globalThis) | undefined => (typeof window !== "undefined" ? window : undefined);

export function isTourSeen(store: Pick<Storage, "getItem"> | undefined = w()?.localStorage): boolean {
  try {
    return store?.getItem(TOUR_SEEN_KEY) === "1";
  } catch {
    return true; // storage blocked → don't nag
  }
}

export function markTourSeen(store: Pick<Storage, "setItem"> | undefined = w()?.localStorage): void {
  try {
    store?.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return !!w()?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  } catch {
    return false;
  }
}
