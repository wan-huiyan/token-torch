---
name: token-torch-insights
description: Generate Token Torch's AI insights using THIS agent session (no API key). Use when the user says "generate token torch insights", "write my insights", "run token-torch insights", or after running `pnpm generate` in the token-torch repo. Reads insights-request.md, writes insights.local.md, re-runs generate.
---

# Token Torch — agent-written insights

You are the user's coding agent. Generate Token Torch's insights note from the local usage
data, with NO API key, by writing the file the generator validates and bakes in.

## Steps

1. Ensure the prompt exists: run `pnpm generate` (it writes `insights-request.md`). If the
   user just ran generate, it's already there.
2. Read `insights-request.md` in the repo root. It contains the GROUND TRUTH (citable numbers),
   the HARD RULES (no-fabrication, breakdown-not-comparison, no superlatives, exact model-version
   labels), and the FORMAT (one bold header + 2–4 bullets, under 90 words).
3. Write the insights note — following every rule — to `insights.local.md` in the repo root.
   Use ONLY the citable numbers. Playful arcade voice is welcome; invented figures are not.
4. Run `pnpm generate` again. Confirm the log says `using agent-written insights.local.md
   (validated …)` and that `public/data/dashboard.json` has `insights_source: "agent"`.
5. If the log instead says the file was DISCARDED (a number wasn't in the data), fix the
   offending figure (the warning names it) and repeat step 4.

## Honesty contract (do not bypass)

The generator re-validates every number server-side; you cannot ship a fabricated figure. If a
number isn't in `insights-request.md`'s citable list, do not write it — spell out small
structural counts as words instead.
