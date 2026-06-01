import type { ReactNode } from "react";

/** Section scaffold — uppercase header + gradient rule + mono caption. */
export function Section({ title, n, children }: { title: ReactNode; n: ReactNode; children: ReactNode }) {
  return (
    <section className="sec">
      <div className="sec-head">
        <h2>{title}</h2>
        <div className="ln" />
        <div className="n">{n}</div>
      </div>
      {children}
    </section>
  );
}
