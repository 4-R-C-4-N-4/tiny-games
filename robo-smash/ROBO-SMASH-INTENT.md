# ROBO-SMASH — Design Intent & Handoff

**Status:** Playable single-file prototype (`robo-smash.html`) with finished movement feel. **Phase 0 substrate implemented** (telemetry, phase-locked crushers, chunk grammar — see §4). Next phase: Phase 1 heuristic director.
**Prime directive:** *Feel first.* Any change that degrades the Feel Contract (below) is wrong, no matter what it adds. When in doubt, playtest the first 20 seconds — if the robot doesn't feel snappy and obedient, revert.

---

## 1. What this game is

A Crash Bandicoot–style side-scroller starring a robot. Crates to smash, death pits, things that smash *you*. The long-term differentiator: the level itself is an adversary with procedural intelligence — it studies the player and places danger where they habitually go, inside a provably-fair envelope. Crash's magic is *authored malice* (the TNT is exactly where a panicked player lands); we replicate that malice with a model instead of a level designer, without ever letting it become unfair.

Ship path is all-JS, in keeping with prior projects: heuristics first, then a tiny model trained locally (RTX 3090) and distilled to a pure-JS/ONNX forward pass running client-side. No server inference.

## 2. The Feel Contract (non-negotiable)

Derived from community post-mortems of the N. Sane Trilogy remake vs. the PS1 originals. The originals were praised for "instant jerkiness" and tightness; the remake was damned for added gravity, floaty binary max-height jumps, input lag, and a camera that made players misjudge jumps. These rules are also documented in a comment block at the top of `robo-smash.html` (C1–C10) and every physics constant hangs off them.

1. **C1 — Zero perceived input latency.** Fixed 60 Hz sim, input polled every tick, edge-detected. Nothing waits on animation.
2. **C2 — Snappy, "jerky" ground movement.** Max run speed in ~6 frames; dead stop in ~6 frames.
3. **C3 — Sustain-model variable jump.** Modest impulse; *low gravity while jump is held and rising*; heavy gravity + one-time velocity cut the instant it's released. Hold duration maps near-continuously to height: tap ≈ 1 tile, full hold ≈ 2.5 tiles. Never binary max-height jumps.
4. **C4 — Asymmetric gravity.** Lighter up, heavier down. Weighty, never floaty.
5. **C5 — Coyote time (7f) + jump buffer (8f).** Ledge deaths are the player's fault, never the sim's.
6. **C6 — Generous spin.** Big hitbox; crates offer *zero resistance* (plow through, momentum preserved); works in air.
7. **C7 — Air-spin hover.** Fall speed hard-capped while spinning (the "death tornado" hang), rationed by a gyro-heat gauge: 4 chained spins → short overheat cooldown (the original games' spin fatigue).
8. **C8 — Crate bounce.** Landing on a crate breaks it and springs you; holding jump springs much higher (classic box-stack climbing); bounce refreshes the double jump. Stomping TNT starts a 3s fuse + bounce; *spinning* TNT detonates instantly.
9. **C9 — Juice on every impact.** 2–3f hitstop, particles, small screenshake, squash & stretch. Death → respawn loop under 1.5 s.
10. **C10 — Calm camera.** Gentle horizontal lookahead, stable vertical. Never make the player misjudge a jump.

### Current tuned constants (60 Hz, px/frame)

| Constant | Value | Notes |
|---|---|---|
| `ACCEL / AIR_ACCEL / FRICTION / MAXRUN` | 0.85 / 0.50 / 0.76 / 4.6 | C2 |
| `JUMP_V / DJUMP_V` | −9.2 / −8.4 | C3 |
| `SUSTAIN_G / RELEASE_G / GRAV_DOWN / CUT` | 0.34 / 0.92 / 0.84 / 0.45 | C3/C4 |
| `MAXFALL` | 13 | |
| `COYOTE / BUFFER` | 7f / 8f | C5 |
| `SPIN_T / SPIN_FALL / SPIN_GRAV` | 20f / 3.2 / 0.32 | C6/C7 |
| `HEAT_MAX / OVERHEAT_T` | 4 / 55f | C7 |
| Crate bounce | held −9.4 / tap −7.8 | C8 |

Known tuning watch-item: sustain models can feel slightly "helium" at apex. If so: `SUSTAIN_G` → ~0.40, `JUMP_V` → ~−9.8 (same max height, punchier arc).

## 3. Current implementation notes

- Single HTML file, canvas 960×540, tile size 48, level ~125×12 composed by the chunk grammar (§4 Phase 0.3): authored start pad → 7 sequenced cells → finale. `?seed=N` replays a layout; the seed shows in the HUD and win screen.
- Entities: crates (`B`), TNT (`T`), ceiling crushers (`M`, slam-cast to ground), spikes (`^`), checkpoints (`!`), goal (`G`). Collision = swept AABB vs. tiles + live crates; crates are solid unless spinning.
- Tiny WebAudio synth SFX; canvas touch controls (auto-appear on first touch); parallax scrap-tower backdrop; robot rendered procedurally with squash/stretch and spin gyro-ring + afterimages.
- Sim *state* is deterministic (fixed timestep, no randomness in physics) — load-bearing for the solver in §4. Layout/director randomness flows through a seeded mulberry32 (`SEED`, loggable, exported with telemetry). Cosmetic `Math.random()` (particles, shake, dust) is unseeded, so replays match state, not visuals. If replays become a feature, seed cosmetics too.
- ~~**Known bug (violates C1):** a jump tapped inside a 2–6f hitstop is eaten.~~ **Fixed:** `p.buffer` (and a spin latch, `sLatch`) is set from the edge-detect at the top of the tick, *before* the hitstop early-return. The buffer intentionally doesn't decay during hitstop, so intent survives the freeze. Note: if press *and* release both land inside the freeze, the C3 cut applies as soon as the buffered jump executes → minimum hop, which is the honest reading of a tap.
- **Headless test harness:** `node test-harness.js` (Node `vm` + browser stubs, drives `tick()` directly; not part of the shipped file). Checks: layout validity over 200 seeds (7 cells, goal present, every >4-tile gap bridged by platforms), the C1 fix both tapped-in-freeze and held-through-freeze, the 250 ms crusher telegraph floor, telemetry tuple shape + hold tracking, seed determinism, and a 20k-tick random-input soak. The Phase 3 verifier should grow out of this driver — it already proves the sim runs headless.

## 4. Adversarial intelligence plan

Principle: **the intelligence operates inside an authored grammar; it never places raw tiles.** And its objective is **near-misses, not deaths** — "maximize misses-by-<8-frames, subject to: a solvable path exists with ≥N frames of margin, and death rate ≤ X/min." An adversary maximizing near-misses is a great level designer; one maximizing deaths is a troll.

### Phase 0 — Substrate (no ML) — ✅ IMPLEMENTED
Implementation notes: telemetry = takeoff→landing tuples (`jump`/`djump`/`bounce`/`fall` takeoffs; `land`/`death`/`win`/`chain:*` outcomes) each carrying cell id + knobs; 4096-entry ring buffer; **press T in-game to download JSON** (includes seed + full cell list). Crushers: `estimateArrival(c, player)` straight-line heuristic; `CRUSH_TELE=16f` (267 ms ≥ the 250 ms floor, on top of ~16.5f travel); per-crusher `slack` knob from its cell (0 = max aggression — more slack fires *earlier*, so the head lands ahead of the player = mercy). Grammar: 5 cell types (`pitBoxBridge`, `crusherCorridor`, `tntTrap`, `bounceLadder`, `spikeGauntlet`) + authored start pad + finale; sequencer draws 7 cells, no immediate repeats, checkpoint breather every 2.

1. **Telemetry.** Log every jump/landing tuple: `(vx, vy at takeoff, takeoff x/y, height delta to landing, hold frames, spin used, landed x, outcome)` **plus context: chunk/cell id, cell knob values, and director seed** — without these you can predict landings but can't evaluate the director's choices. Ring buffer, export as JSON (training data for Phase 2).
2. **Phase-locking crushers.** Crusher reads approach velocity, estimates arrival time, schedules its slam to intersect — with a hard floor of a **250 ms telegraph *before* the slam begins** (visual/audio tell). Note: current slam travel is already ~267 ms total (15 px/f over ~240 px); the 250 ms floor is *warning time on top of travel*, not total travel — misreading this makes phase-locked crushers undodgeable. Live, feels intelligent, ~20 lines. Interface: `estimateArrival(playerState) -> frames`; heuristic now, learned model later, same call site.
3. **Chunk grammar.** Refactor level build into parameterized challenge cells — *pit-with-box-bridge*, *crusher corridor*, *TNT landing trap*, *bounce ladder*, *spike gauntlet* — each exposing cruelty knobs (gap width, crusher phase, TNT offset from natural landing spot, stack height). A sequencer composes cells per run.

### Phase 1 — Heuristic director
Cheap online model of the player: running histograms of hold-duration, landing-offset bias, spin usage, hesitation before gaps. Director tunes cell knobs between checkpoints toward the near-miss objective. UI tell: a Cortex-style antagonist with "SUBJECT PROFILE UPDATING…" between checkpoints — transparency converts adaptive difficulty from feeling rigged into feeling like a duel.

### Phase 2 — Learned landing predictor
Small MLP (same recipe as the tower-defense project: numpy → ONNX → pure-JS forward pass, few-thousand params): input = takeoff state, output = landing-x distribution. Director places hazards at the distribution's **mode, offset by a guaranteed dodge window** — the trap sits where the player *habitually* lands, never where they *must* land. Train on own-play telemetry first; optionally fine-tune online per player with the histogram as fallback. **Caveat — non-stationarity is inherent:** an adversary that moves traps teaches players to change their habits, so the landing distribution the model learned drifts *because the model acted on it*. Use recency-weighted data, keep the histogram baseline live as a sanity check, and treat "model confidence collapsed" as a signal the player has adapted (which is itself useful director input), not as a failure.

### Phase 3 — Solver-in-the-loop fairness (adversary proposes, verifier disposes)
The sim is state-deterministic, but under the sustain jump model arcs are **piecewise, not closed-form**: reachability = a search over discrete jump templates `(hold frames 0..~27) × (double-jump timing) × (spin-hover frames)`. Still cheap — precompute the template family once, then A* over the platform graph after every adversarial edit; **reject/repair** any layout whose best-path margin drops below threshold (frames of slack, required-input tightness). Two extra requirements: (a) adaptive hazards (phase-locked crushers) must be verified against their **worst-case schedule** given the telegraph floor, not a static snapshot; (b) verify from every checkpoint spawn, not just level start. This is the piece naive AI-level-gen skips and why it feels unfair. Constrained adversarial generation *is* the game.

## 5. Guardrails for the agent

- Never touch the Feel Contract constants to "balance" the adversary — the adversary adapts to the player, not the physics.
- Every adversarial placement must pass the verifier (Phase 3) once it exists; before then, respect hard floors — **these numbers are TBD and must be set before Phase 1 ships** (unnumbered guardrails are unenforceable): crusher telegraph ≥ 250 ms *(fixed)*, min best-path margin N frames *(TBD, suggest starting at 10f ≈ jump-buffer + coyote combined)*, death-rate cap X/min *(TBD, tune from own-play telemetry median × ~1.5)*.
- Keep the single-file ship path (or a minimal build step that still emits one file). No servers, no external inference.
- Preserve determinism of the core sim; all randomness lives in the director/sequencer with a loggable seed (replayability + debugging + training data hygiene).
- Playtest loop: first 20 seconds after every change. Feel regression = revert first, discuss second.

## 6. Open questions (deliberately unresolved)

- Run structure: fixed-length levels vs. roguelike-ish escalating runs (there's adjacent design thinking in the Lexomancy project — anti-min-max systems, run-wide fingerprinting — that could transfer to the director's player model).
- Should the director's aggression be a visible dial/difficulty setting, or purely emergent?
- Crate economy: does %-crates-broken feed the director (reward thoroughness with mercy, or punish greed with traps near optional crates)?
- Enemy actors (patrollers the spin launches into other crates, à la Crash 4) — big juice payoff, new collision class.
