# Token Torch

A personal-analytics dashboard for your own Claude Code usage — cost, time, cache,
and "what shipped" — generated from your local `~/.claude/` corpus and served as a
static SPA. All cost figures are estimates; honesty (fidelity badges, small-sample
guards, estimate labels) is built in.

> **Status: work in progress.** Today it works against the author's curated corpus;
> portability to any user's `~/.claude/projects/` is in flight. A full setup/onboarding
> guide is coming.

## Run it

```bash
pnpm install
pnpm generate    # reads your local Claude Code corpus → public/data/ (gitignored)
pnpm preview     # build + serve the dashboard
```

Project-name grouping is configurable via a gitignored `scripts/lib/projects.local.json`
(see `scripts/lib/projects.ts` for the format) so your real project names never enter
version control.

The shipped fixtures under `src/fixtures/` are **illustrative sample data**, not real
usage — they're only the fallback the UI renders before you run `pnpm generate`.

## Pricing limitations

Costs are recomputed from raw-transcript token counts at per-model list rates
(see `scripts/lib/pricing.ts`) — always an **estimate**; the Anthropic billing
dashboard is authoritative. Known unmodeled cases: the **1M-context-window
premium** and the **fast-mode premium** are not in the rate table, so sessions
that used them are priced at standard rates. As a mitigation, any session whose
per-turn context peaked above the standard **200k window** carries a
`pricing_note` caveat (on both the session row and the detail page data) stating
that its cost may be an underestimate — the flag is data-derived, never guessed.

## Ecosystem

Sibling projects by the same author that Token Torch pairs with:

- [context-police](https://github.com/wan-huiyan/context-police) — audits the always-injected skill/plugin catalog; **already integrated**: Token Torch reads its snapshots for the Catalog Savings panel (`catalogSnapshot.ts` / `catalogSavings.ts`).
- [memory-hygiene](https://github.com/wan-huiyan/memory-hygiene) — keeps agent memory files lean and current so stale notes don't pollute context.
- [session-handoff](https://github.com/wan-huiyan/session-handoff) — structured handoff notes for continuing work across Claude Code sessions.
- [claude-ecosystem-hygiene](https://github.com/wan-huiyan/claude-ecosystem-hygiene) — the plugin-marketplace bundle packaging these hygiene tools together.

## ✨ Generate AI insights with your own agent (no API key)

Token Torch's "insights" note can be written by **the coding agent you're already in** —
Claude Code, Codex, Cursor, or any agent — so you don't need an Anthropic API key.

1. Run `pnpm generate`. It writes `insights-request.md` (a paste-ready prompt: your real
   aggregates + strict no-fabrication rules + where to save the result).
2. Hand `insights-request.md` to your agent — paste its contents, or (Claude Code) run the
   bundled `token-torch-insights` skill. The agent writes a short note to `insights.local.md`.
3. Run `pnpm generate` again. Token Torch **re-validates every number server-side** and bakes
   the note in, tagged "written by your agent". Any figure not in your data is rejected and it
   falls back to the built-in template — so a wrong number can never ship.

> Re-run your agent if your usage data changed between steps — the validator checks the note
> against the *current* aggregates and will discard a stale figure.

**Codex / Cursor / other agents:** just paste `insights-request.md` and ask the agent to save
its answer to `insights.local.md`, then re-run `pnpm generate`.

**Optional API-key path (power users / CI):** set `ANTHROPIC_API_KEY` and `pnpm generate` will
write the note itself via the Claude API (same no-fabrication gate). An invalid key simply falls
back to the template — it never crashes generate. `insights.local.md` (if present **and valid**)
takes precedence over the API path; an invalid local file falls back to the API path (then template).
