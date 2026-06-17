/* ============================================================================
 * Pure honesty gate for LLM-generated insights. No API, no I/O.
 *
 * allowedNumbers(data)  -> the whitelist of numeric values the LLM is allowed to
 *                          cite, drawn from DASHBOARD-LEVEL AGGREGATES ONLY (never
 *                          sessions[], which would make the check vacuous).
 * validateInsightNumbers(prose, data) -> { ok, offending } : every $/%/integer-count
 *                          token in `prose` must match an allowed value within a
 *                          documented tolerance, else it is "offending" (fabricated).
 *
 * This file is unit-tested without any API key — it is the project's honesty spine
 * (ADR 0001/0002, L4/L7). The actual LLM call is exercised only when a key exists.
 * ========================================================================== */

import type { DashboardData, SessionDetailData } from "../../src/types";
import { prettyModelId } from "../../src/shared/models";

export interface ValidationResult {
  ok: boolean;
  /** numeric tokens found in the prose that match no allowed value (UNIT-AWARE: a $-token
   *  matches only dollar values, a %-token only percent values; #37). */
  offending: string[];
  /** forbidden superlative / performance-comparison / causal phrases — qualitative claims
   *  the data cannot support (HARD RULES 2 & 5; #37 vacuity fix). Distinct from numbers. */
  claims: string[];
}

/** A unit dimension for an allowed number, so cross-unit collisions (a fabricated 50%
 *  matching a $50 aggregate) can't pass. "bare" = count / minutes / hours / tokens, or a
 *  dollar written without a sign — genuinely ambiguous, so it matches permissively. */
type Unit = "dollar" | "percent" | "bare";
interface AllowedNumber {
  value: number;
  unit: Unit;
}

/** Relative tolerance for matching a prose number to an allowed value.
 *  The insights.ts usd() helper rounds to 0 decimals, so prose "$12,985" must
 *  match data 12984.78 — ~1% relative covers integer-rounded dollars and percents. */
const REL_TOL = 0.01;

/** Year tokens (4-digit 19xx/20xx) come from dates, not metrics — never fabrication. */
const YEAR_RE = /^(?:19|20)\d{2}$/;

/** Escape a literal string for use inside a RegExp (model labels carry a "." e.g. "Opus 4.7"). */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Scale multipliers for a trailing k/K/M/B/m/b suffix ("$5M" => 5_000_000). We scale
 *  the mantissa BEFORE matching so a fabricated "$5M" cannot slip through merely because
 *  the bare "5" coincides with a whitelisted aggregate (issue #9). */
const SCALE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/** Matches $1,234.56 | 1,234 | 95.0% | .5% | $5M | 80B — captures (1) an optional "$" prefix,
 *  (2) the numeric core (commas/decimals/leading-dot), (3) an optional k/K/M/B scale suffix,
 *  (4) an optional "%" suffix. Groups 1 & 4 give the token its UNIT (#37). Module-scope so the
 *  generic core and the dashboard wrapper share one definition; `matchAll` clones it, so the
 *  /g lastIndex is never shared across calls. */
const TOKEN_RE = /(\$)?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)([kKmMbB])?\s?(%)?/g;

/** #37 vacuity gate: superlatives / performance comparisons / causal claims the usage data
 *  CANNOT support (HARD RULES 2 & 5). A note that wears the "agent"/"llm" trust badge must
 *  not assert value judgments — even WITH a valid number ("Best week ever — $12,679.22!").
 *
 *  DELIBERATELY high-precision — only value-judgment / performance / causal vocabulary that
 *  has NO factual-ranking use over this cost/size/share/count data. EXCLUDED on purpose
 *  (the templates + live arcade voice use these legitimately): priciest / pricey / biggest /
 *  largest / smallest / most / least / top / highest / lowest / more / fewer / led / leader /
 *  leading / dominant, and BARE "record" (insights.ts writes "sessions on record"). The cost
 *  comparatives "cheaper/cheapest" are also excluded (factual cost use) — a residual "cheaper
 *  than" model comparison is a documented fail-OPEN, consistent with the PCN binding posture
 *  (#27). Matches are whole-word (\b) or explicit phrases; case-insensitive. */
const CLAIM_RE =
  /\b(?:best|worst|better|worse|fastest|faster|slowest|slower|superior|inferior|smartest|smarter|dumbest|dumber|outperform(?:s|ed)?|beats|blowout)\b|\brecord[ -](?:breaking|shattering)\b|\bbecause\b|\bcaus(?:ed|es|ing)\b|\bdue to\b|\bthanks to\b/gi;

/** The whitelist of citable numbers, TAGGED with a unit dimension (single source of truth).
 *  Dashboard-level aggregates ONLY (never sessions[], which would make the check vacuous). */
function allowedNumbersTyped(data: DashboardData): AllowedNumber[] {
  const t = data.totals;
  const D = (value: number): AllowedNumber => ({ value, unit: "dollar" });
  const P = (value: number): AllowedNumber => ({ value, unit: "percent" });
  const N = (value: number): AllowedNumber => ({ value, unit: "bare" }); // count / minutes / hours / tokens
  const out: AllowedNumber[] = [
    D(t.cost_usd),
    D(t.cost_by_fidelity.high),
    D(t.cost_by_fidelity.main_loop),
    N(t.active_minutes),
    N(t.active_hours),
    N(t.idle_minutes),
    N(t.idle_hours),
    N(t.sessions),
    N(t.subagent_dispatches),
    D(t.cost_per_active_min),
    P(t.avg_cache_hit_pct),
    N(t.tokens.input_fresh),
    N(t.tokens.cache_read),
    N(t.tokens.output),
    N(t.time_saved_min),
    N(t.time_saved_hours),
    N(data.meta.session_count),
    N(data.meta.project_count),
  ];
  if (t.floored_usd != null) out.push(D(t.floored_usd));
  if (t.complete_spend_usd != null) out.push(D(t.complete_spend_usd));
  for (const p of data.projects) {
    out.push(D(p.cost_usd), N(p.sessions), N(p.active_min), D(p.cost_per_session), P(p.cost_share * 100));
  }
  if (data.meta.floor) {
    const f = data.meta.floor;
    out.push(N(f.discovered), N(f.kept), N(f.dropped), N(f.dropped_with_usage), D(f.dropped_with_usage_usd));
  }
  for (const v of Object.values(data.distributions.model_mix)) out.push(P(v));
  return out;
}

/** The whitelist as a flat number[] — for the prompt/cache consumers that just list values.
 *  (Validation uses the typed version above for unit-aware matching.) Dashboard aggregates ONLY. */
export function allowedNumbers(data: DashboardData): number[] {
  return allowedNumbersTyped(data).map((a) => a.value);
}

/** Does `value` (of `unit`) match any allowed number, as exact, integer-rounded, or within
 *  REL_TOL? UNIT-AWARE: a $-token matches only dollar values and a %-token only percent values
 *  (so a fabricated 50% can't pass on a $50 aggregate); a bare token matches any unit
 *  (its true unit is ambiguous, so we don't over-reject — fail-open). */
function matchesAllowed(value: number, allowed: AllowedNumber[], unit: Unit): boolean {
  for (const a of allowed) {
    if (unit !== "bare" && a.unit !== unit) continue; // unit gate for $/% tokens
    if (value === a.value) return true;
    if (Math.round(value) === Math.round(a.value)) return true;
    const denom = Math.max(Math.abs(a.value), 1);
    if (Math.abs(value - a.value) / denom <= REL_TOL) return true;
  }
  return false;
}

/** Generic no-fabrication + no-superlative core (the reusable honesty spine). Every $/%/numeric
 *  token in `prose` (commas/$/% stripped; bare 4-digit years exempt as date labels; a k/M/B
 *  suffix scaled BEFORE matching, #9) must match an `allowed` value, UNIT-AWARE (#37: a $-token
 *  matches only dollar values, a %-token only percents; a bare token matches any unit). Plus the
 *  #37 vacuity gate on the markdown-stripped text: forbidden superlative / performance-comparison
 *  / causal phrases, rejected even WITH a valid number. NO entity binding — the model_mix PCN swap
 *  check is dashboard-specific (validateInsightNumbers). The per-session takeaway gate
 *  (validateSessionTakeaway, #52) reuses this directly: one model per session ⇒ no swap surface. */
export function validateNumbersAgainst(prose: string, allowed: AllowedNumber[]): ValidationResult {
  const offending: string[] = [];
  for (const m of prose.matchAll(TOKEN_RE)) {
    const raw = m[2];
    if (YEAR_RE.test(raw.replace(/[,.].*$/, ""))) continue; // a bare 4-digit year (date label) is not a metric claim
    let value = parseFloat(raw.replace(/,/g, ""));
    if (Number.isNaN(value)) continue;
    const suffix = m[3];
    if (suffix) value *= SCALE[suffix.toLowerCase()];
    const unit: Unit = m[4] === "%" ? "percent" : m[1] === "$" ? "dollar" : "bare";
    if (!matchesAllowed(value, allowed, unit)) offending.push(m[0].trim());
  }
  // #37 vacuity: scan the markdown-stripped text, NOT raw prose — `_` is a \w char so `\b` has no
  // boundary at `_best_`, and `**` splitting a word (`b**est**`) breaks the match (review catch).
  const flat = prose.replace(/[*_]+/g, "");
  const claims = [...new Set([...flat.matchAll(CLAIM_RE)].map((m) => m[0].trim()))];
  return { ok: offending.length === 0 && claims.length === 0, offending, claims };
}

/** Dashboard insights gate: the generic number/claim core against the DASHBOARD whitelist, PLUS
 *  the model_mix swap-binding pass (#24/#27). Every $/%/count must trace to a dashboard aggregate
 *  and no model-version share may be misattributed. */
export function validateInsightNumbers(prose: string, data: DashboardData): ValidationResult {
  const base = validateNumbersAgainst(prose, allowedNumbersTyped(data));
  const offending = [...base.offending];

  // --- #24 PCN first cut: catch a SWAPPED model_mix version share. ---
  // The whitelist scan above only asks "is this value a valid share SOMEWHERE?", so a
  // SWAPPED attribution ("Opus 4.7 20%" when 20% is Opus 4.8's share) sails through —
  // both values are valid shares. Here each model-version LABEL bound to a nearby % is a
  // SWAP iff the value is NOT this version's own share but IS another version's share.
  // Division of labour: the whitelist scan owns "not a valid number at all" (fabrication);
  // this binding owns ONLY "valid-but-misattributed" — so a non-share number near a label
  // (e.g. a cache-hit %) is left to the whitelist, never flagged here. Per-claim match
  // reuses matchesAllowed's tolerance; markdown emphasis (**74.75%**) is stripped first.
  //
  // BINDING WINDOW: the label, then a BOUNDED gap of ≤16 non-digit/non-% chars, then the
  // %. The gap spans the short connectors the live arcade voice uses ("Opus 4.7 AT 74%",
  // "Opus 4.7: 74%", "Opus 4.7 — 74%") — observed 2026-06-03 — but because it admits NO
  // digit it can never reach across another model's label (each has digits, e.g. "4.8")
  // or another number; the ≤16 cap refuses long loose prose. DELIBERATELY fail-OPEN on
  // UNBOUND numbers (loose phrasing, or "74% went to Opus 4.7" number-before-label, is
  // uncovered) — defense-in-depth; the full inline-tag PCN protocol is the documented
  // follow-up (#24). Fail-open + swap-only is what keeps this from false-positiving on
  // legit prose (no generate:verify regression).
  const flat = prose.replace(/[*_]+/g, "");
  const mixEntries = Object.entries(data.distributions.model_mix);
  for (const [id, share] of mixEntries) {
    const label = prettyModelId(id);
    if (label === id) continue; // unrecognised id shape — no label to bind against
    const otherShares = mixEntries.filter(([oid]) => oid !== id).map(([, v]) => v);
    const bindRe = new RegExp(`${escapeRe(label)}[^%\\d\\n\\r]{0,16}(\\d+(?:\\.\\d+)?|\\.\\d+)\\s*%`, "gi");
    for (const m of flat.matchAll(bindRe)) {
      const bound = parseFloat(m[1]);
      if (Number.isNaN(bound)) continue;
      // bound and the shares are all PERCENTs (bindRe requires a trailing %).
      const ownShare: AllowedNumber[] = [{ value: share, unit: "percent" }];
      const others: AllowedNumber[] = otherShares.map((v) => ({ value: v, unit: "percent" }));
      if (!matchesAllowed(bound, ownShare, "percent") && matchesAllowed(bound, others, "percent"))
        offending.push(m[0].trim());
    }
    // NOTE (#27): the SYMMETRIC number-before-label case ("74.35% went to Opus 4.7") is
    // deliberately NOT covered by a reverse heuristic — "<num>%, <NextLabel>" in list prose
    // is structurally ambiguous (the number belongs to the PRECEDING label), so a reverse
    // bind false-positives on legitimate "Opus 4.8 70%, Opus 4.7 25%" mixes. The order-
    // independent guarantee is owned by the inline PCN tags (validateTaggedInsights), which
    // bind (entity,value) regardless of word order. Prose binding stays forward-only + fail-open,
    // so an UNTAGGED number-before-label swap is a documented residual (#47); the tags close it
    // when emitted (forcing a tag on every % would break the zero-tags fail-open passthrough).
  }

  // The #37 vacuity (superlative/comparison/causal) gate already ran inside validateNumbersAgainst
  // on the same markdown-stripped text — reuse its claims here (the PCN pass only adds offending).
  return { ok: offending.length === 0 && base.claims.length === 0, offending, claims: base.claims };
}

/* ============================================================================
 * #52 — per-session takeaway whitelist + gate. A session's AI takeaway may cite ONLY that
 * session's own measured/estimated figures (its time split, cost breakdown, cache, tokens) —
 * a number from any OTHER session is fabrication for THIS one. Per-session grounding (not the
 * corpus aggregate) is the whole point: it is what makes the gate non-vacuous at session scope.
 * One model per session ⇒ no model_mix swap surface, so the gate is the generic core only.
 * ========================================================================== */

/** Every citable number of ONE session, unit-tagged. Durations are in MINUTES (the request asks
 *  the agent to cite minutes); shares/percents and dollar figures are tagged so a fabricated 50%
 *  can't pass on a $50 line. Includes the derived active-share % (the template's headline) and
 *  per-cost-category $ / cost% / token% so an AI takeaway can say what the template says. */
export function allowedNumbersSessionTyped(s: SessionDetailData): AllowedNumber[] {
  const D = (value: number): AllowedNumber => ({ value, unit: "dollar" });
  const P = (value: number): AllowedNumber => ({ value, unit: "percent" });
  const N = (value: number): AllowedNumber => ({ value, unit: "bare" }); // minutes / tokens / counts
  const { time: t, tokens: tk, cost: c } = s;
  const ab = t.active_breakdown;
  const out: AllowedNumber[] = [
    D(s.cost_usd),
    P(s.cache_pct),
    N(t.wall_clock_min), N(t.active_min), N(t.idle_min), N(t.wait_min),
    N(ab.thinking_min), N(ab.tool_min), N(ab.subagent_min), N(ab.planning_min),
    N(tk.fresh_input), N(tk.output), N(tk.cache_write), N(tk.cache_read), N(tk.total),
    P(tk.cache_hit_pct),
    D(c.total_usd), D(c.main_loop_usd), D(c.subagent_usd),
    D(c.cache_savings_usd), D(c.cache_write_premium_usd), D(c.blended_per_mtok_usd),
  ];
  // Derived active share of wall-clock — the Takeaway's headline "(X%) was real compute".
  if (t.wall_clock_min > 0) out.push(P((t.active_min / t.wall_clock_min) * 100));
  // Per-category cost + token shares (the "cache reads were X% of the bill" line).
  if (c.by_category) for (const cat of Object.values(c.by_category)) out.push(D(cat.usd), P(cat.cost_pct), P(cat.tok_pct));
  return out;
}

/** Flat number[] of one session's citable values — for the request file's "citable numbers" line. */
export function allowedNumbersSession(s: SessionDetailData): number[] {
  return allowedNumbersSessionTyped(s).map((a) => a.value);
}

/** Per-session no-fabrication + no-superlative gate (#52). Same core as the dashboard insights
 *  gate, against THIS session's own whitelist; no model_mix PCN binding (a session has one model). */
export function validateSessionTakeaway(prose: string, s: SessionDetailData): ValidationResult {
  return validateNumbersAgainst(prose, allowedNumbersSessionTyped(s));
}

/* ============================================================================
 * #27 — PCN inline-tag protocol for model_mix (the full, order-independent mechanism
 * that the #24 prose-binding heuristic only partially covers).
 *
 * The agent / LLM may append an inline binding tag [[mm:<model_mix-id>=<value>]] right
 * after a version's share in the prose. validateTaggedInsights runs at GENERATE-TIME and is
 * FAIL-CLOSED on the tags: every PRESENT tag's (entity, value) must bind to a real model_mix
 * entry within tolerance — a swap (the value is another version's share), a fabricated value,
 * an unknown id, or a malformed [[mm: attempt all fail. It ALWAYS returns the prose with every
 * tag stripped, so neither the display nor the downstream VERIFY-time validateInsightNumbers
 * (which stays FAIL-OPEN) ever sees tag debris. ZERO tags ⇒ fail-OPEN passthrough, so template
 * / legacy / untagged agent prose is wholly unaffected by the protocol.
 * ========================================================================== */

export interface TaggedValidationResult {
  /** true iff no present tag is malformed or misattributed. ZERO tags ⇒ true (fail-open). */
  ok: boolean;
  /** the prose with EVERY [[mm:…]] tag removed — what ships/displays and what the fail-open
   *  validateInsightNumbers re-checks at verify time. */
  stripped: string;
  /** tag tokens that failed the (entity,value) binding, kind-tagged for an honest log/retry. */
  taggedOffending: string[];
}

/** Well-formed model_mix binding tag: [[mm:<model_mix-id>=<value>]]. */
const MM_TAG_RE = /\[\[mm:\s*([a-z0-9-]+)\s*=\s*(\d+(?:\.\d+)?|\.\d+)\s*\]\]/gi;
/** Any [[mm: … ]] occurrence (well-formed or not), with one optional leading space — for
 *  stripping. A bare "[[mm:" count vs. parsed-tag count surfaces malformed attempts. */
const MM_STRIP_RE = /\s?\[\[mm:[^\]]*\]\]/gi;

/** GENERATE-TIME, FAIL-CLOSED PCN tag check (#27). See the block comment above. */
export function validateTaggedInsights(prose: string, data: DashboardData): TaggedValidationResult {
  const attempts = (prose.match(/\[\[mm:/gi) || []).length;
  if (attempts === 0) return { ok: true, stripped: prose, taggedOffending: [] };
  const stripped = prose.replace(MM_STRIP_RE, "").trimEnd();
  const taggedOffending: string[] = [];
  const tags = [...prose.matchAll(MM_TAG_RE)];
  // A present-but-garbled binding must not silently pass (a [[mm: that did not parse).
  if (tags.length < attempts) taggedOffending.push("malformed model_mix tag — expected [[mm:<model-id>=<value>]]");
  const mix = data.distributions.model_mix;
  for (const m of tags) {
    const id = m[1].toLowerCase();
    const value = parseFloat(m[2]);
    const share = mix[id];
    if (share == null) {
      taggedOffending.push(`${m[0]} (unknown model id "${id}")`);
      continue;
    }
    // share is a PERCENT; reuse the whitelist tolerance for the (entity,value) bind.
    if (!matchesAllowed(value, [{ value: share, unit: "percent" }], "percent"))
      taggedOffending.push(`${m[0]} (claims ${value}% but ${id}'s share is ${share}%)`);
  }
  return { ok: taggedOffending.length === 0, stripped, taggedOffending };
}
