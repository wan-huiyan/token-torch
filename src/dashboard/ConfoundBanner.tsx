import type { GroupBy } from "./aggregate";

/* ============================================================================
 * TOKEN TORCH — ConfoundBanner (Plan 5 T4, L7).
 * A PROMINENT validity warning, NOT a footnote. The breakdown describes what
 * each group DID; it is never a performance ranking. Model-version buckets are
 * time-disjoint (the 4.7/4.8 windows don't overlap), so usage logs cannot
 * isolate model performance — only a controlled A/B can (see the README).
 * Verbatim core copy below; bold rendered as <strong>, not via md().
 * ========================================================================== */
export function ConfoundBanner({ by }: { by: GroupBy }) {
  // dimension-specific emphasis line under the shared core copy
  const extra =
    by === "model" ? (
      <p className="confound-extra">
        Model-version groups are <strong>time-disjoint</strong> — each version was the only one
        running during its own window. Differences in spend, tokens or cache reflect <strong>when</strong>{" "}
        the work happened (and which projects were active then), not how the models perform.
      </p>
    ) : by === "effort" ? (
      <p className="confound-extra">
        Effort groups carry a <strong>selection bias</strong>: you reach for higher effort on
        harder tasks, so the groups differ by task difficulty as well as effort. Effort is also
        partly inferred (see the source tags), not all observed.
      </p>
    ) : (
      <p className="confound-extra">This grouping is descriptive only — a slice of activity by {by}.</p>
    );

  return (
    <div className="confound" role="note" aria-label="validity warning">
      <div className="confound-head">
        <span className="confound-tag">read this first</span>
        <span className="confound-title">These groups are not a controlled experiment</span>
      </div>
      <p className="confound-core">
        These groups differ in <strong>date-span and task mix</strong> and were <strong>not</strong> run
        as a controlled experiment. Read this as a description of what each group did —{" "}
        <strong>not</strong> a performance ranking. For a real model comparison you need a controlled
        A/B (see the README), not usage logs.
      </p>
      {extra}
    </div>
  );
}
