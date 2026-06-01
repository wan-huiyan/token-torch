/* ============================================================================
 * CacheSavings — the savings hero: "~$X saved" = what the cache-read tokens
 * would have cost at the fresh-input rate, with the small-print cache-write
 * premium (the price of those savings). Mirrors the prototype savings().
 * Requires by_category (cache_read) — only rendered inside the money section.
 * ========================================================================== */
import type { SessionDetailData } from "../types";
import { abbr, usd } from "./helpers";

export function CacheSavings({ data }: { data: SessionDetailData }) {
  const c = data.cost;
  const readUsd = c.by_category!.cache_read.usd;
  return (
    <div className="panel savings">
      <div className="k">Prompt caching saved</div>
      <div className="v">~{usd(c.cache_savings_usd, false)}</div>
      <p>
        Those {abbr(data.tokens.cache_read)} cache-read tokens would've cost{" "}
        <b style={{ color: "var(--ink)" }}>{usd(c.cache_savings_usd + readUsd, false)}</b> at the fresh-input rate.
        You paid <b style={{ color: "var(--ink)" }}>{usd(readUsd)}</b>.
      </p>
      <div className="sp">
        Small print: a ~{usd(c.cache_write_premium_usd)} cache-write premium is the price of those savings.
      </div>
    </div>
  );
}
