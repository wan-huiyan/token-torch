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
