import type { DashboardData } from "../types";
import { num } from "./helpers";
import { Section } from "./Section";

/**
 * Context overhead (issue #10): the fixed base context (system prompt + tool/skill
 * catalog + earliest conversation) re-read into every turn and every subagent
 * dispatch. ESTIMATE — tagged. Framed as a SMALL fixed floor (the growing
 * conversation history is the larger cost), never "the main waste". Hidden when the
 * aggregate is absent (older fixtures) or zero (no cached reads). No superlative/causal copy.
 */
export function ContextOverhead({ data }: { data: DashboardData }) {
  const co = data.totals.context_overhead;
  if (!co || co.reread_tokens <= 0) return null;

  const pct = Math.min(100, Math.max(0, co.overhead_pct_of_input));
  const subTok = co.subagent_scaffolding_tokens;

  return (
    <Section title="Context overhead" n="estimate">
      <div className="co-grid">
        <div className="co-stat">
          <div className="co-big">{pct}%</div>
          <div className="co-cap">of input tokens were fixed base context, re-read every turn</div>
        </div>
        <div className="co-stat">
          <div className="co-big">{num(co.reread_tokens)}</div>
          <div className="co-cap">tokens spent re-reading scaffolding (~${co.reread_usd} est, cache-read rate)</div>
        </div>
        {subTok > 0 && (
          <div className="co-stat">
            <div className="co-big">{num(subTok)}</div>
            <div className="co-cap">extra base-context tokens re-paid across subagent dispatches</div>
          </div>
        )}
      </div>
      <div className="co-bar" aria-hidden>
        <i style={{ width: `${pct}%`, background: "var(--amber)" }} />
      </div>
      <p className="co-note">
        A small fixed floor — your growing conversation history is the larger cost. {co.note}
      </p>
    </Section>
  );
}
