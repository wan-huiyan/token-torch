/* ============================================================================
 * TOKEN TORCH redesign — shared presentational + honesty primitives.
 * Match the prototype's class taxonomy (dashboard.css / detail.css are ported
 * verbatim). Honesty SEMANTICS mined from the old components; markup is new.
 * ========================================================================== */
import type { ReactNode } from "react";
import { num } from "../helpers";

/** The amber "≈ estimate" tag that sits on every $ figure (honesty spine #1). */
export function Est({ children = "≈ estimate" }: { children?: ReactNode }) {
  return <span className="est">{children}</span>;
}

/** Section header: H2 + neon rule + mono caption (the `.sec-head` block). The
 *  caption `n` carries the estimate/scope note for the section. */
export function SecHead({ title, n }: { title: ReactNode; n?: ReactNode }) {
  return (
    <div className="sec-head">
      <h2>{title}</h2>
      <span className="ln" />
      {n != null && <span className="n">{n}</span>}
    </div>
  );
}

/** Currency rendered with small currency symbol + de-emphasised cents (`.cur`/
 *  `.cents`), matching the prototype's centsSpan(). */
export function Cents({ v }: { v: number }) {
  const f = Math.floor(v);
  const c = (v - f).toFixed(2).slice(2);
  return (
    <>
      <span className="cur">$</span>
      {num(f)}
      <span className="cents">.{c}</span>
    </>
  );
}

/** Full / Partial cost badge (chat rename of High / Main-loop). `main_loop`
 *  fidelity means subagent spend is NOT counted → amber "Partial cost". */
export function FidelityBadge({ fidelity }: { fidelity: "high" | "main_loop" }) {
  const partial = fidelity === "main_loop";
  return (
    <span
      className={"badge " + (partial ? "ml" : "hi")}
      title={partial ? "Partial cost — subagent spend isn't counted for this session" : "Full cost — measured end to end"}
    >
      {partial ? "Partial cost" : "Full cost"}
    </span>
  );
}

/** Reconciliation note ⓘ — surfaces when source records disagreed (honesty). */
export function ReconNote({ note }: { note?: string }) {
  if (!note) return null;
  return (
    <span className="recon" title={note} aria-label={"reconciliation note: " + note}>
      ⓘ
    </span>
  );
}
