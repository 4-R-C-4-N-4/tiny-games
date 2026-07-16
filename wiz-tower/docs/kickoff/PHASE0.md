# Phase 0 — The Simulation Contract

Phase 0 is **the engine and nothing else**: no rendering, no model, no search. Those
are the *consumers* (Phase 1 = renderer + search attacker; Phase 2 = distilled model).
This document plus `src/lib.rs` and `wave.ebnf` are the contract they all build against.

The rule that justifies the whole architecture: **if a game rule exists in two places it
will drift.** So it exists here once, in Rust, compiled two ways — native (`rlib`) for the
training search, WASM (`cdylib`, via wasm-bindgen in Phase 4) for the browser.

---

## 1. Determinism contract

> Given `(seed, initial Grid, the ordered stream of player + attacker decisions)`, the
> entire tick history is identical on every platform and every run.

This is not a nice-to-have. The model is trained on search over this sim, then runs against
this sim in the browser; if the two diverge, the policy is off-distribution. Replays,
telegraph accuracy, and reproducible training all depend on it too. Three requirements:

1. **Fixed timestep.** Integer `tick: u64`, constant `dt`. No wall-clock, no variable step.
2. **Fixed-point math (`Fx`).** All positions, HP, damage, and accumulators are Q22.10 in
   an `i32`. This is the one guard against cross-platform float drift (native vs WASM can
   round f32 differently). *See the open decision in §6 — this is the call I want you to
   confirm before implementation.*
3. **Stable iteration order.** Entities live in `Vec`s indexed by id; we never iterate a
   `HashMap`. Target acquisition and damage application walk ids in order.

RNG (`Rng`, xorshift64) is seeded and used only for reproducible tie-breaks/jitter — the
sim is otherwise deterministic by construction.

---

## 2. The tick — canonical update order

`Sim::step()` advances exactly one tick in this order. **The order is part of the contract;
reordering changes outcomes.**

1. `tick += 1`
2. Process opener/reserve spawns scheduled for this tick.
3. Mobs sample the flow field → intended movement (fliers: straight line to Core).
4. Move mobs; any reaching the Core → **leak** (damage Core, despawn, record).
5. Breaching mobs damage their target wall; walls at 0 HP are removed → mark maze **dirty**.
6. If dirty → recompute flow fields **once**.
7. Towers acquire targets (by `TargetPriority`, then stable id order) and fire; apply
   typing × shields × splash × slow; accumulate `dps_util`.
8. Resolve mob deaths → bounty → currency.
9. Mender regen.
10. Accumulate metrics.
11. Emit `StepOutcome`: `DecisionPoint(obs)` if this tick is one; else `WaveComplete` if the
    schedule is drained and no mobs remain; else `GameOver` if Core ≤ 0; else `Continue`.

---

## 3. Pathing & breaching

Only **walls** block (confirmed §9.4 — towers are pure coverage). Movement is a **flow
field**, not per-mob A*: one integration field to the Core, every mob follows the gradient,
recomputed only on maze change. Cheap for many mobs on a phone.

Two fields (see `Fields`):

- **`cost_walled`** — walls impassable. The route mobs actually take. `UNREACHABLE` where
  the maze is sealed.
- **`cost_open`** — walls passable. The "if I could walk straight" field. When a mob is
  blocked (or is a Breaker choosing work), the wall to attack is the first one along *this*
  gradient — `Fields::breach_target()`. This makes breaching a deterministic, sensible
  choice instead of ad-hoc.

Because walls break, **every build is legal** — sealing the Core just guarantees a breach.
No "can't place, blocks the path" errors.

---

## 4. Decision-point protocol

This is how L2 (reserve + reaction) works without the sim knowing whether a model or a
search is driving. The sim is a **stepper that yields**:

```
step() → Continue            … keep stepping
       → DecisionPoint(obs)  … caller asks attacker.commit(ctx), then sim.commit(&commits)
       → WaveComplete(m)     … wave over, m is the scorecard
       → GameOver
```

The caller loop (in `lib.rs`, bottom) is **identical** for both consumers. Only the
`dyn Attacker` differs:

- **Live:** `PlanAttacker(parse_wave(model_output))` — the model emitted grammar-constrained
  DSL, we parsed it to a `Wave`, and the plan executes, resolving reserve guards at each point.
- **Training:** `SearchAttacker` (native-only crate, Phase 1.5) — searches the best commit
  live at each point. Its `(context → commit)` decisions become the labels we distill.

Number of decision points and reserve fraction come from `Config` (start: 2 points, ~0.35).

---

## 5. Observation & objective

- **Observation** (§4.2): a spatial `CellFeatures` grid — DPS by **element (7 channels)**,
  control / anti-air / detection coverage, wall HP, buildable, and `dist_core` (so the model
  reads the maze geometry) — plus a compact **`BuildProfile`** (starting element, attuned set,
  per-element tree depth) so the attacker can anticipate what you're teching toward. This is
  the model's input tensor and the search's read model.
- **Metrics** = the multi-term objective *and* the game score, emitted per wave: `leaked_hp`
  (leak), `currency_delta` (economy denial), `fire_misalloc` (tempo/bluff), plus `overkill`,
  `dps_util`, `breaches`, `time_to_first_leak`. Search weights these into one scalar;
  weightings are the difficulty/personality lever.

---

## 6. Open decision to confirm before writing bodies

**Fixed-point (`Fx`) vs `f32` for sim math.** I've specced fixed-point because it's the only
way to get *cross-platform* determinism (native training ≡ WASM browser), and lockstep games
do exactly this. The cost is ergonomics — every multiply goes through `fx_mul`, and porting
formulas is fiddlier.

The alternative — `f32` — is far nicer to write and is deterministic *within* one target, but
native and WASM can diverge subtly. If we accept "train and play may differ by an epsilon,"
`f32` is fine and DAgger papers over the rest, since the policy only acts at coarse decision
points, not per-tick.

My recommendation: **fixed-point**, because determinism is load-bearing for the train→play
handoff and it's cheap insurance now vs. a nasty debugging session later. But it's a real
tradeoff and it's your call — say the word and I'll swap the skeleton to `f32` before we
implement.

---

## 7. Definition of done (Phase 0)

- [ ] Grid + occupancy + buildability; build/sell tower and wall with cost/refund.
- [ ] Dual flow fields with recompute-on-dirty; `breach_target` selection.
- [ ] All mob kinds move, leak, die, drop bounty; fliers ignore walls; breakers breach.
- [ ] All tower kinds acquire + fire with typing/shield/splash/slow.
- [ ] `parse_wave` + validation against the grammar; `PlanAttacker` executes a `Wave`.
- [ ] `step()` implements the §2 order exactly; `DecisionPoint`/`commit` round-trips.
- [ ] `Metrics` emitted and reproducible: same inputs → identical metrics, native & WASM.
- [ ] A headless golden-replay test: a recorded decision stream reproduces byte-identical
      metrics on both targets (this is the determinism regression guard).

**Non-goals for Phase 0:** rendering, touch UI, any model, any search. First consumer
(Phase 1) is the renderer + a trivial scripted/search attacker to prove the loop is fun.
