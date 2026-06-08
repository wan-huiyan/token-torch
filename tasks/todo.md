# Awards Panel redesign — implementation plan

Source handoff: `design_handoff_awards_panel/` (worktree). High-fidelity port of the arcade
**awards ceremony** into the live React app. Every hero number stays **measured** (verbatim
`deriveAwards()` over real sessions) — the redesign adds visual identity + adaptive work-life
framing + the faux→real honesty reveal, never a fabricated value.

## Files to change
1. **`src/dashboard/spriteEngine.ts`** — ADD new sprites/scenes (port from `assets/sprite-kit.js`):
   - `PALM`+`PALM_PAL`, `CAL`(calendar)+`CAL_PAL` → into `ICONS` (so `mountIcon`/`mountKind` resolve them).
   - `BABY_A/B`+`BABY_PAL` + `mountSwarm(host,{count,scale})` — scurrying baby-bot bg (setInterval, frozen-safe).
   - `mountBeachScene(host)` — sun + rolling waves + sand (setInterval).
   - `confettiBurst({host,count,x,y})` — one-shot pixel-square winner burst (rAF, self-terminating).
   - `mountKind(host,kind,{scale,tier})` — generic dispatcher used by the panel's sprite hosts.
   - Convention: gate on engine `isReduced()` + register `trackAnimation` (NOT a `reduced` param) — matches
     every existing mount; the React `<Sprite>` re-runs mounts on the toggle flip.

2. **`src/dashboard/awards.ts`** — REWRITE `deriveAwards` to emit the rich measured shape + add the view layer:
   - Types: extend `AwardBeat` with `unit`; extend `Award` for `reveal`, `adaptive` (+`accent,share,threshold,
     session,praise,nudge` faces), `swarmBg`; `empty` stays.
   - `marathon`: `reveal:true`; beats split value/unit (`"122h 43m"` / `"wall-clock"`,`"active"`).
   - `offhours` (replaces `nightowl`): adaptive. Compute **offHoursShare = % of start_ts in 7pm–6am** (threshold
     decision), `afterMidnightPct` (0–5h, praise copy), deepest off-hours run (clock+session). threshold 10.
     praise=Lights Out (`${100-afterMidPct}% before midnight`), nudge=Night Owl (deepest clock). Empty if no ts.
   - `weekend`: adaptive. weekendCount/pct. threshold 5. praise=Weekend Protector (`${100-pct}% on weekdays`,
     bg beach), nudge=Weekend Check-In (`${n} runs`). Empty if no ts.
   - `swarm`: `swarmBg:true`; value/unit split.
   - Add `AWARD_IDENTITY` const + pure `resolveView(award, mode)` (ported verbatim, TS-typed; reads the const,
     not window globals). `mode:"auto"` = data-driven (share≥threshold ⇒ nudge); `"praise"`/`"nudge"` force.

3. **`src/dashboard/redesign/AwardsPanel.tsx`** — REWRITE: cabinet shell (mascot header, kicker, count,
   Now-Showing ↔ Trophy-Wall pill toggles layout), `Stage`→`AwardStage`/`RevealStage`/`EmptyStage`, `Pedestal`,
   `SessionLink` (real `#/sessions/:id`), `useStageBg` (swarm/beach), `Rail` (roster + dwell progress), `TrophyWall`.
   Auto-rotate 7s / 8.8s reveal, pause on hover + reduced. `reduced = usePrefersReducedMotion()`. `drama` fixed
   const (pulse/confetti on). Work-life = `"auto"` (data-driven). Drop demo tweaks. Reuse house `<Sprite mount=…>`.

4. **`src/dashboard/redesign.css`** — REPLACE the small `.awards` block with the full ceremony styles ported from
   `assets/awards.css`, **scoped under `.awards`** (cabinet/stage/ped/bignum/reveal/rail/wall/empty) to avoid
   global generic-class collisions. Drop the prototype's page chrome (body/`.aw-bg`/`.aw-intro`) and its
   `.reduce-motion` + `@media (prefers-reduced-motion)` blocks — the app uses the global `.tt-reduced *` rule +
   engine registry (Maximum-Fun owner call). Tokens used verbatim (gold/silver/bronze/glow-*).

5. **`src/dashboard/awards.test.ts`** — REWRITE to the new contract: marathon reveal+split; offhours adaptive
   share/faces; weekend adaptive; swarm; empty→no fabrication; `resolveView` auto/forced branches.

## Verify
- `pnpm typecheck` clean · `pnpm test` green · `pnpm generate:verify` exit 0.
- `pnpm dev` + Playwright screenshots: ceremony stage, reveal (faux→busted→real), rail rotate, trophy-wall toggle,
  beach + swarm scenes, empty state, `.tt-reduced` snaps static. Compare vs `Awards Ceremony.html`.

## Honesty invariants (must hold)
Every hero number derived from `SessionRow` fields; empty → honest blank not zero; adaptive nudge never rewards
grinding; faux→real reveal preserved (not flattened); footer "measured numbers only, no fabricated zeros".

## Review (done — branch `feat/awards-panel-redesign`)
- **Files:** spriteEngine.ts (+palm/calendar icons, mountSwarm/mountBeachScene/confettiBurst/mountKind),
  awards.ts (rewritten deriveAwards → reveal/adaptive/swarm + AWARD_IDENTITY + resolveView), AwardsPanel.tsx
  (full ceremony shell), redesign.css (scoped ceremony block; reused bob/podshine, renamed numpulse→awNumpulse,
  blink→awBlink), awards.test.ts (rewritten, TZ-safe fixtures).
- **Gates:** `tsc --noEmit` clean · `pnpm test` exit 0 (7 awards checks) · `pnpm generate:verify` exit 0.
- **Numeric oracle (deriveAwards over the real 554-session corpus) matches the mockup:** marathon 122h 43m
  (DoodleRun) → 4h 41m (schuh); swarm 67 (schuh 37b90296); weekend 79 runs/14% (was 78/11% on 06-06 — 2-day drift).
  Off-hours 7pm–6am share = 24% ≥ 10 → flips to the nudge face exactly as the README predicted.
- **Browser (DOM-verified; pixel screenshots blocked by the documented MCP rasterization timeout on a 93-canvas
  page — the `playwright-screenshot-hangs-on-infinite-animation` condition):** all 4 faces render — marathon reveal
  (reduced → real 4h 41m + crown + faux-note, NOT hidden — advisor trap #4 fixed), off-hours nudge (Night Owl 2:34am),
  weekend nudge (79 runs), swarm (67 + family sprite + swarm-bg canvas at z0/opacity .5). Rail, layout-toggle pill,
  honest footer, real `#/sessions/:id` links present. Reduce-motion stops rotation + loops.
- **Honesty spine intact:** every number measured; empty→honest blank (unit-tested); nudge never rewards grinding;
  faux→real reveal preserved; footer "measured numbers only, no fabricated zeros."
- **Not committed** (awaiting user's call on commit/PR). Beach scene + praise/moon faces + empty state are not in
  this corpus (data-driven: both adaptive awards are "heavy" → nudge; no award empty) — covered by the unit test +
  the shared mountSwarm/mountBeachScene mechanism.
