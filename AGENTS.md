# Agent instructions — tiny-games

**Before designing or building any game here, read [CONTEXT.md](CONTEXT.md) in full.**
It is the intention of this collection, the hard invariants, and the template for
starting a new game (with a worked example). This file is only the summary.

## Hard invariants

1. Every game ships as **one self-contained HTML file** (hand-authored, or a minimal
   build that emits one file). No servers, no API keys, nothing phoned home at play time.
2. The intelligence is **client-side**: search-distilled MLP, teacher-distilled scorer,
   or in-browser LLM. Train locally; **ship the student, never the teacher**.
3. **Deterministic sim**: fixed timestep, seeded state-randomness (loggable, `?seed=N`
   replays exactly), cosmetic randomness unseeded and stateless.
4. **Headless test harness** driving the real sim, wired as the deploy gate. Passing
   count goes in `game.json.note`.
5. **Feel first**: each game has a numbered feel contract; never touch its constants to
   balance the AI. Playtest the first 20 seconds after every change; feel regression =
   revert first, discuss second.
6. **Look at what you built**: verify rendering with headless-browser screenshots
   (start / mid-action / fail state) diffed against the brief's visual checklist —
   passing sim checks does not mean the game looks right.
7. **Baseline player expectations**: pause (+ auto-pause on tab hide), instant restart,
   seed sharing — and in real-time games the null strategy must lose (harness-proved).
8. **PR flow**: branch from `origin/main` (worktrees in `../tiny-games-worktrees/<slug>`),
   PR, merge. Never push main directly.

## Starting a new game

Copy the brief template from CONTEXT.md §IV into `<slug>/<SLUG>-INTENT.md`, fill every
slot — especially the **touchstone** ("this is <real game>'s <system>; reach 1:1 on the
testable magic list before diverging") — then build Phase 0 (no ML: telemetry, heuristic
adversary at named call sites, seeded content grammar).

## Deep-doc worked examples

- `robo-smash/ROBO-SMASH-INTENT.md` — intent-doc shape, feel contract, phase ladder
- `wiz-tower/docs/kickoff/` — engine contract ("a rule in two places will drift"), design plan
- `lexomancy/docs/` + `lexomancy/train/README.md` — anti-min-max design, distillation pipeline
- `.github/workflows/deploy.yml` + any `game.json` — the deploy contract
