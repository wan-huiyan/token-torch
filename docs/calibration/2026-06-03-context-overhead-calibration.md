# Context-overhead metric calibration (issue #10 / Plan 8)

**Measured 2026-06-03**, full-scan of ~297 main-loop transcripts (`~/.claude/projects/*/*.jsonl`,
non-sidechain) + subagent transcripts. These are the empirical facts the `scaffoldingFloor` metric
rests on (L8: calibrate, full-scan not head-sample).

## Live confirmation numbers (re-run this session)

```
sessions: 297 floor min/median/max: 19069 28963 71048
inv floor<=total_in violations: 0
inv floor*turns<=total_cr violations: 0
```

Median floor ≈ **28,963 tokens** — matches issue #10's "~30k base context" observation.

## Calibration findings

- Each assistant `message.usage` carries `input_tokens` (fresh, typically **1–6** — negligible),
  `cache_creation_input_tokens` (cw, the per-turn delta written to cache), `cache_read_input_tokens`
  (cr, the cached prefix read this turn), `output_tokens`.
- **`cache_read` grows monotonically** through a session as the conversation accumulates into cache
  (observed: turn-1 cr ≈ 27.8k → last-turn cr ≈ 566k in a 348-turn session). So per-turn cr is NOT
  fixed; the FIXED part is the **floor**.
- **Stable base-context floor = `min(cache_read over the session's non-zero-cr turns)`** — the prefix
  (system prompt + tool/skill catalog + earliest conversation) re-read on EVERY turn. Corpus median
  ≈ 28,963 (min 19,069, max 71,048).
- **Provable invariants (0 violations / 297 sessions):**
  - first-turn `(cw+cr)` ≤ session total `(fresh+cw+cr)` — a one-turn subset.
  - `floor × (#non-zero-cr turns)` ≤ total `cache_read` — the re-read floor cannot exceed the reads
    that actually happened.
- **Honest LIMIT (scope the metric to what IS derivable — ADR 0001/0002 honesty spine):**
  - The floor is **base context, not isolated catalog.** `cache_read` bundles system prompt +
    tool/skill catalog + the earliest cached conversation turns; we cannot cleanly subtract the
    initial user prompt from the catalog. Copy says "fixed base context re-read each turn,"
    estimate-tagged — NOT "system-prompt+catalog = X%" as an isolated figure.
  - The cache-prefix identity (turn-2 `cache_read` == turn-1 `cw+cr`) holds EXACTLY in clean subagent
    dispatches but only approximately on main-loop transcripts (corpus median ratio 0.43; 58/297
    within ±50%) because resumed/`--continue` sessions read a large PRE-WARMED cache on turn 1. This
    is why we use the **min-over-turns floor** (robust to pre-warming and TTL eviction), not the
    first-turn value, as the primary measure.
  - Cache has a TTL; a >120s idle gap (the same threshold `deriveTime` uses) can evict it, forcing a
    mid-session re-WRITE of the prefix. "re-read every turn" is an ESTIMATE of a real effect, never
    asserted as an identity.
- **Subagents carry their own floor.** Subagent transcripts (`<slug>/<session-uuid>/subagents/agent-*.jsonl`,
  plus `subagents/workflows/wf_*/agent-*.jsonl`) show a first-turn `(cw+cr)` median ≈ 25.6k — each
  dispatch re-pays the catalog. Summing the per-dispatch floor across a session's subagents is the
  quantitative "N× catalog" story.

## Research grounding (2026 primary sources; see `docs/research/2026-06-03-context-overhead-and-agent-token-research.md` in the knowledge repo)

These refine how the metric must be FRAMED (honesty spine):

- **The floor is a SMALL, fixed slice — not the headline waste.** A worked example (Augment Code,
  2026-04-06) puts the fixed `N×S` system-prompt term at ~2% of session input; the accumulating
  `N(N+1)/2` conversation-history term dominates and caching does not reduce it. → The panel frames the
  floor as a small fixed component, NEVER "the main source of waste."
- **Price re-reads at the cache-read rate (0.1× base input).** Anthropic caching: read 0.1×, write
  1.25×(5-min)/2×(1-hr). The floor is real in tokens but its marginal cost is ~1/10th. This plan
  prices `reread_usd` at the per-model cache-read rate → correct.
- **The min-floor is BLIND to TTL eviction re-pays (the biggest undercount).** It drops exactly the
  turns where the prefix was re-billed as a cache WRITE. The metric is a floor; it understates.
- **Deferred-tool-loading re-bills the floor as a write next turn** (tools→system→messages cache
  invalidation cascade). Very Claude-Code-relevant; name it in caveats.
- Stanford Digital Economy Lab (2026-05-05, arXiv 2604.22750): agent cost is concentrated in re-read
  input ("context snowball"). The circulating "62%" figure is an aggregator embellishment, NOT in the
  primary — do not cite a precise percentage.

## Classification rule (what the code implements)

Given a session's assistant turns (deduped by message.id, as ingest already does),
let CR = the list of per-turn `cache_read_input_tokens` values that are > 0.

- scaffoldingFloor = min(CR)            # base context re-read EVERY turn (0 if CR empty)
- turnCount        = len(CR)            # turns that read the cached prefix
- overhead_reads   = scaffoldingFloor * turnCount   # ESTIMATE: total tokens spent re-reading base context
- productive_reads = total_cache_read - overhead_reads  # the growing conversation delta

Priced at the per-model cache_read rate (overhead is, by definition, cached reads).
This is the floor of base-context cost; it understates when the prefix is re-WRITTEN
after a TTL eviction (those re-writes are counted as productive, conservatively).
Below the cache minimum (1,024 tok Opus 4.8 / Sonnet 4.6; 4,096 older) cache_read is 0,
so the floor is undefined — render "no floor measurable", never "zero overhead".

## S12 reframe (2026-06-04) — the redesign's "N× re-read" headline reconciled with this calibration

The redesigned Distributions panel leads with a different VIEW of the same numbers: a
**token RATIO** — `N× = round(reread_tokens / input_fresh)` — framed as *"≈N context tokens
re-read from cache for every 1 fresh input token."* On the live corpus this is a **large
multiple (~60–66× at the time of writing, and DRIFTING as the corpus grows** — fresh input
accumulates, so the exact factor must be read off the live `reread_tokens`/`input_fresh`,
NEVER hardcoded here), NOT the prototype mock's illustrative "51×" (which was a seeded
placeholder — the panel computes it from real fields per the no-fabrication rule).

This does **not** contradict the "small fixed slice — never the headline $ waste" framing
above. They are two honest views of different quantities:

- **The 66× is a TOKEN ratio** — a huge MULTIPLE of tokens flows through, almost all of it
  cache re-reads. This is "the hidden bulk" the panel surfaces: token counts dwarf the bill.
- **The $ is still small / cache-cheap** — cache reads are ~10× cheaper than fresh input
  (Anthropic pricing), so that 66× token bulk is a modest dollar slice (`overhead_pct_of_input`
  ≈10–11% of input-side tokens; `reread_usd` priced at the cache-read rate). The panel copy
  says so verbatim: *"served cheaply… a normal fixed cost; only a worry if fresh input stays
  near zero."*

So: **tokens-are-a-big-multiple (66×) AND dollars-are-a-small-cache-cheap-slice are BOTH true
and now BOTH shown.** The reframe shifts the panel's *headline emphasis* from the $-floor to
the token-ratio (the user's call — the 66× is the more arresting, and still-honest, framing),
while the dollar honesty (cache-cheap, not "main waste") is preserved in the copy + caveats.
The `scaffoldingFloor` $-metric documented above is unchanged; the 66× is an additional
ratio surfaced from `reread_tokens` (real) and `input_fresh` (real). The panel's stacked bar
is anchored to `reread_tokens + input_fresh` (so bar % and the 66× agree); it deliberately
does NOT label the complement of `overhead_pct_of_input` as "fresh" (true fresh is ~1.5% of
all input — calling 89% of it "fresh" would be a fabrication).
