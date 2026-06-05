/* #/about — plain-English methodology page (Plan 7 / #16). Static; the honesty spine
 * in prose. Linked from the hero estimate label ("how?"). Uses the shared nt-* panel
 * classes (styles-tokens.css), same as App.tsx's NotFound/Loading. */
export function AboutPage({ onBack }: { onBack: () => void }) {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "var(--sec-gap)" }}>
      <button
        className="nt-kicker"
        onClick={onBack}
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cyan)" }}
      >
        ← dashboard
      </button>
      <section className="nt-panel" style={{ padding: "var(--pad)", marginTop: 16 }}>
        <div className="nt-sec-head">How these numbers are made</div>

        <h4>Costs are estimates</h4>
        <p>
          Every dollar figure is computed from <em>public</em> per-model pricing applied to the token counts in your
          transcripts. They are estimates, not invoices — for the authoritative amount, use the Anthropic Cost API or
          your real bill. We show one pricing method per figure and never blend methods.
        </p>

        <h4>Time saved &amp; what-shipped have no authoritative source</h4>
        <p>
          Parallel “time saved” is the span of subagent work minus the union of overlapping intervals — a derived
          figure that honestly reads zero when it can’t be measured. “What shipped” is reconstructed from the commands
          in your transcripts (PRs opened/merged, commits, reviews). Both are best-effort descriptions, not ground
          truth.
        </p>

        <h4>We never silently drop data</h4>
        <p>
          Low-signal sessions are <em>floored</em>, not deleted: their count and rolled-in spend are surfaced on the
          dashboard, and each session row in the table view is tagged with how its numbers were sourced (its data
          tier). Model and effort views are{" "}
          <em>breakdowns, not comparisons</em> — they are confounded by time and task mix, so we describe what differed
          and never crown a winner.
        </p>

        <h4>Portability</h4>
        <p>
          Token Torch reads only <code>~/.claude/projects/</code>. Run <code>pnpm generate</code> then{" "}
          <code>pnpm build &amp;&amp; pnpm preview</code> to see your own usage. Validated on this corpus; other Claude
          Code versions or transcript schemas may differ.
        </p>
      </section>
    </main>
  );
}
