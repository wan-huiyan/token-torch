# Session 20 — ship #72 + #75 (autonomous)

Mandate: ship both remaining tracks as far as possible without the external Claude Design
round-trip; review panel before merge; fix findings. Serial off main, two PRs.

## Data-feasibility probes (DONE — gate the designs)
- [x] #75 non-vacuity: (a) subagent-heavy 25% of sessions; (b) >150k peak ctx 73% of substantial
      (the norm → frame as a *characteristic* + accumulating-cache caveat); (c) 4+ parallel:
      peak conc 13, **~26% of active wall-clock at conc≥4 under a strict 5-min gap cap** (raw 84%
      is inflated — use gap-capped). (d) per-skill/MCP % = UNKNOWN (no token attribution). All
      three (a/b/c) NON-VACUOUS → build; (d) honest unknown.
- [x] #72 parseability + ground-truth: high-precision floor (final-msg severity-tagged [Pn],
      header/list) = 10 reviews / 5 sessions / 41 real findings. Trap ratio 316× confirms naive
      mention-count is wrong. Prose-only reviews + panels = unknown (don't zero-fill).

## Track 2 — #72 review-findings extractor (NO viz; calendar viz still gated on Claude Design)
- [ ] `scripts/lib/reviewFindings.ts` — `extractReviewFindings(id8, index)`: foreground single-agent
      review subagents only; FINAL assistant message only; count severity-tagged `[Pn]` lines;
      panels (workflow-nested) + prose-only → unknown (not counted). Returns confirmed + coverage.
- [ ] `scripts/lib/reviewFindings.test.ts` — header counts, list-item counts, prompt-scale-in-non-final
      msg → 0 (trap), panel excluded, clean-approve → unknown not zero. Add to package.json chain.
- [ ] `src/types.ts` — additive `mistakes_caught?: number` on SessionRow (like shipped_count).
- [ ] `scripts/lib/mapDashboard.ts` — call extractor at the extractShipped site; attach mistakes_caught>0.
- [ ] `src/dashboard/shippedCalendar.ts` — 2nd stat: `mistakesCaught` per CalCell + totals + coverage.
      Extend `shippedCalendar.test.ts`.
- [ ] `scripts/generate.ts --verify` — assert mistakes_caught is a non-negative int, aggregate consistency.
- [ ] Real-corpus spot-check: regen, confirm the 5 sessions carry the true confirmed counts (not 316×).

## Track 3 — #75 usage-diagnostics panel ("What's driving your usage")
- [ ] `scripts/lib/ingest.ts` — per-turn accumulation: peakContextTokens + heavyContextTokens (usage on
      turns where ctx>150k). New SessionRecord fields → **CACHE VERSION BUMP** (else stale serves 0/L8).
- [ ] `scripts/lib/usageDiagnostics.ts` — `deriveUsageDiagnostics`: (a) subagent share, (b) heavy-ctx %,
      (c) 4+ parallel % (gap-capped 5-min, cross-session sweep-line), (d) per-skill = unknown. Each
      driver carries measured detail + an action nudge. Local-only undercount caveat (verbatim style).
- [ ] `scripts/lib/usageDiagnostics.test.ts` — sweep-line concurrency, heavy-ctx %, unknown-d, empty. Chain it.
- [ ] `src/types.ts` — additive `usage_diagnostics?` on DashboardData.totals (or root).
- [ ] `scripts/generate.ts` — compute + attach; `--verify` sanity bounds (shares 0–100, unknown allowed).
- [ ] `src/dashboard/redesign/*` — `UsageDiagnosticsPanel` wired into DistributionsTab (mirror Overhead/CatalogSavings pattern).
- [ ] Gates: tsc, full test chain, generate:verify exit 0, vite build, browser-smoke the panel on real data.

## Review + merge
- [ ] agent-review-panel on each PR diff → fix → merge serial off main (solo repo, green-gate).
- [ ] Handoff: calendar viz (both stats) STILL pending Claude Design; #72 ceiling documented.
