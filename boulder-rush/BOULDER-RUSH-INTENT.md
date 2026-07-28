# BOULDER-RUSH — Design Intent & Handoff

**Status:** Phase 0 playable (`boulder-rush.html`, single hand-authored file). Course grammar, heuristic boulder policy with fairness floors, full telemetry, near-miss lunges, seed sharing — 35 harness checks green, including the agent-play policy ladder (null 116m always dies < naive 307m < tuned 4809m surviving the cap). First human playtest (2026-07-28) caught and fixed: brown-dirt palette → midnight foundry causeway (slate/cyan/amber); piecewise projection with a kink at the player line + modulo-popping strips → one smooth 1/distance mapping for everything; boulder drawn spilling past its own contact line → sphere grounded (`cy=y-r*0.94`, proximity drives its size, not a huge base radius); **AFK equilibrium** (idle player never died) → compounding stumble heat; no pause → P/Esc/button + auto-pause on tab hide. Next: Phase 1.
**Prime directive:** The boulder must feel like it is *about to catch you* for the entire run without cheating. When in doubt, playtest 30 seconds and watch the gap.

## 1. What this game is
An endless chase down a stone canyon: the runner sprints toward the camera, a boulder
grinding after them fills the top of the frame, obstacles rush up from the bottom edge.
Steer with the pointer (mouse or thumb — mobile-first, portrait canvas), tap to hop.
Obstacles never kill; they *slow* — the boulder is the only executioner. The AI
differentiator: the chase director. One self-contained HTML file.

## 2. Touchstone — Crash Bandicoot's boulder chase
Build toward 1:1 on the list below before adding anything original.
The magic, as testable statements (H = enforced in the harness, P = needs playtest):
1. **(built)** The runner faces the camera; dread comes from what's behind them filling the frame.
2. **(H)** The boulder visibly gains on every mistake within 250ms — the stumble pounce (`bSpd=max(bSpd,spd+0.09)`).
3. **(H)** At least one telegraphed near-miss lunge per run window (`nextLunge` ~20-30s), survivable for a clean runner.
4. **(H)** Reaction window from obstacle reveal to arrival ≥ 700ms at max speed (`LEAD/SPD_MAX = 42.4f`).
5. **(H)** A death is only reachable through stumbles inside the last `STUMBLE_WIN` (4s) — always attributable.
6. **(built)** Proximity is multi-channel: boulder scale + rumble gain + shake + road shadow + red vignette + antenna light.
7. **(built)** A clean stretch opens the gap — the policy relaxes toward `targetGap` when you stop stumbling.
8. **(H)** Standing still is death: stumble heat compounds (`heat+1` per stumble, target gap `−heat*4.5`), so an idle player is caught in ~15–40s; clean running bleeds heat off. No AFK equilibrium.
9. **(built, screenshot-checked)** The downhill read (visual touchstone: Crash 2's *Un-Bearable* polar-bear chase): terrain fills 100% of the frame — no sky; the runner sits mid-frame (~57% down) with generous revealed track below; the boulder sits visually ABOVE the runner on the up-slope; the road darkens up-slope and lightens toward the camera.
Divergence (only after playtest parity): the boulder as a *director* — it studies steering
habits and spawns danger where you habitually drift, inside the passability envelope.

## 3. The Feel Contract (non-negotiable)
F1. Pointer-to-player latency ≤ 1 sim tick; steering critically damped — no overshoot, no jitter.
F2. Jump is a fixed, buffered arc (tap ≥ 1 frame registers; buffer 6f). No double jump.
F3. 60Hz fixed-timestep sim; rendering never gates input.
F4. Boulder pressure is always legible (a function of the gap alone).
F5. Obstacles slow, only the boulder kills. No instant deaths from the course.
F6. Camera fixed; the road does the motion. No lateral camera movement.

### Current tuned constants (60Hz, z in metres)
| Constant | Value | Notes |
|---|---|---|
| `LEAD / BEHIND` | 14 / 30 | view window; LEAD/spd = reveal floor |
| `SPD0 → SPD_MAX` | 0.26 → 0.33 over `RAMP_Z`=1100m | 42.4f reveal at max |
| `STEER_K / PW` | 0.28 / 0.16 | exp approach = never overshoots (F1) |
| `JUMP_T / JUMP_BUF / AIR window` | 24f / 6f / f4–f20 | F2 |
| `GAP0 / GAP_FLOOR / CATCH` | 22 / 6 / 1.2 | floor only bypassed by recent stumbles |
| `ROAR_T / LUNGE_GAP` | 32f (533ms) / 4.5 | telegraph holds the gap while roaring |
| `STUMBLE_T / PIT / INVULN` | 50f / 62f / 70f | crack stumbles hurt more |
| stumble pounce | `bSpd ≥ spd+0.09` | touchstone #2 |
| stumble heat | +1/stumble (max 6), −1/240f after 3s clean | touchstone #8; target gap −`heat*4.5` |
| projection | `y = HORIZON + A/(CAMD+LEAD−rel)`, `HORIZON=70`, `CAMD=17` | one smooth mapping; downhill framing (see §2a) |
| boulder draw | `r=(185+165·prox)·s`, grounded at contact line | proximity fills the frame, not base size |

## 4. Verbs & knobs
Player verbs: **steer** (pointer x / drag; arrows-A/D fallback), **hop** (tap, second
finger, click, space). That is the entire surface — two verbs, spent.
Adversary knobs (in `knobs(z)` — the director's future surface): row `spacing`
(13.5→7.5m), `totemChance` (0.18→0.40), `boltRate`, `rockMax`, plus the boulder policy's
`targetGap` curve and lunge schedule.

## 5. The AI angle
Pattern: heuristic chase director now → search-distilled policy later (wiz-tower recipe).
It studies: steering-position histogram (`steerHist`, 12 buckets sampled every 30f),
per-row outcome tuples `(t, z, type, xs, px, gap, outcome clean|near|stumble, clear)`,
stumble/roar/lunge/pickup/death event stream.
Objective: maximize near-misses subject to: every row passable by construction
(`GAPMIN` raw gap for totem rows; everything else jumpable); catch only via compounded
recent stumbles; lunge telegraph ≥ 500ms with the gap held during the roar.
Legibility tell: the roar (`!` + audio + shake) before every lunge; death screen shows
the distance the mistake chain bought.
Call sites: `boulderPolicy(state) -> accel` · `spawnRow(z)` / `knobs(z) -> {…}`.
Play loop: `play.observe() / play.act({steer,jump}) / play.step()` — the player's verbs
only; harness bots and future self-play training both go through it.

## 6. Determinism plan
Seeded mulberry32 over course generation and the lunge schedule; cosmetic dust/chips/
shake unseeded (`Math.random`) and stateless. `?seed=N` + share button + `C` copy the
canyon; `T` exports telemetry JSON (seed, distance, steer histogram, records, events).

## 7. Phase ladder
Phase 0 ✅ (this build): seeded course grammar + heuristic boulder policy with floors +
full telemetry + near-miss lunges.
Phase 1: director tunes `knobs()` + lunge timing from `steerHist`/outcomes between stretches.
Phase 2: distilled steering-prediction model places obstacles at habitual paths
(numpy → ONNX → pure-JS).
Phase 3: passability verifier runs on every spawned row against the *learned* placements.

## 8. Guardrails for the agent
- Never touch F1–F6 constants to make the boulder scarier; scare via the knobs.
- Floors: roar telegraph ≥ 500ms *(fixed, `ROAR_T=32`)*; reveal-to-arrival ≥ 700ms
  *(fixed, `LEAD/SPD_MAX`)*; gap floor without recent stumble = `GAP_FLOOR=6`; lunges
  bottom out at `LUNGE_GAP=4.5` with no overshoot.
- Every spawned row must be passable **by construction** (spawner) AND **by check** (harness).
- Single file, portrait canvas, touch-first. Playtest 30 seconds after each change.

## 9. Harness expectations
`node test-harness.js` — headless driver (vm + stubs) over the real sim. 35 checks:
the agent-play policy ladder (null / naive / tuned through the play loop; null always
dies, skill strictly orders outcomes, observation is player-shaped — no internals),
AFK-death (no idle equilibrium), pause halts/resumes the sim, plus:
floors as numbers, row passability across 200 seeds, course+director determinism,
steering damping (monotone, no overshoot), perfect-bot fairness (never caught, never
below the lunge floor), stumble pounce timing, roar-holds-the-gap, lunge survivability,
death attribution, telemetry shape, 30k-tick pointer-fuzz soak. Wired as the deploy gate.

## 10. Ship path
`game.json`: rune 🪨, `embed:false` (fullscreen — pointer tracking wants the whole
screen). Deploy block mirrors robo-smash: no build, harness gate, copy the single file
as `index.html` + `boulder-rush.html`. Pause: P / Esc / top-right button; auto-pauses
when the tab hides; any tap resumes.

## 11. Definition of first-gen done
Touchstone list green (H-items proven, P-items playtested by a human), Phase 0 live,
harness green, deployed. Then stop and update this doc.

## 12. Open questions (deliberately unresolved)
- Endless-only, or distance milestones with biome shifts (canyon → temple → lava)?
- Daily seed (everyone runs the same canyon, compare distances)?
- Does the runner share the robo-smash robot's identity? *(Current build: yes — same
  palette and visor; cheap cross-game continuity. Revisit if it wants its own soul.)*
- Bolts currently pure score — should they buy anything (a one-hit pardon? a burst of
  speed) without violating F5?
