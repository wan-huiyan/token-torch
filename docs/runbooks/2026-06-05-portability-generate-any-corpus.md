# Runbook — Run Token Torch on any `~/.claude/projects/` corpus

Token Torch reads **only** `~/.claude/projects/` — no usage-tracking corpus step required.

## Quick start
1. `pnpm install`
2. `pnpm generate`              # auto-discovers ~/.claude/projects/, writes public/data/*.json
3. `pnpm build && pnpm preview` # build (dist/ is gitignored) then serve the dashboard
   #   — or `pnpm dev` for the no-build dev server (port 5273)

A brand-new user is all `jsonl` data-tier (no `enriched` usage-tracking overlay) and still sees a
fully-populated, honestly-labelled dashboard immediately — every figure carries its data-tier badge.

## Optional: AI insights with no API key
`pnpm generate` emits `insights-request.md`. Paste it to your own coding agent (Claude Code / Codex /
Cursor / …); it writes `insights.local.md`; re-run `pnpm generate` and the note is re-validated
server-side (no-fabrication + no-superlative gate) and baked in, tagged "written by your agent".
Both handshake files are gitignored. An `ANTHROPIC_API_KEY` is an optional power-user/CI path.

## Optional freshness
`pnpm generate` is incremental (cached) — re-run after new sessions; it only re-reads changed files.

## Verify the build
`pnpm generate:verify` asserts the cost / coverage / timing / breakdown / no-fabrication invariants and
exits non-zero on any breach. It is the real regression gate (there is no CI on the solo repo).

## Framing caveat (read before sharing)
"Works for any user" is validated only on **this** corpus (the transcripts that carry `message.usage`).
Older Claude Code versions or different transcript schemas may not populate the same fields — validate on
a second user's corpus before claiming universality in any shared copy. This caveat is part of the
public-flip gate, not optional copy.
