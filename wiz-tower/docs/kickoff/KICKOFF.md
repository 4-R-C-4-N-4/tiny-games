# KICKOFF — Adversarial Tower Defense (local dev)

You are a coding agent picking up an existing, well-specified design. The design is settled —
implement it, don't redesign. This session's job: make **Phase 0** real — a deterministic,
headless sim in **TypeScript** (`sim.ts`) that passes a golden-replay determinism test.

## Stack decision (read this first)
This is a **one-page JS game**, all-JS:
- The sim is written **once in TypeScript** and shared by the Node trainer and the browser
  (both are V8 → one engine, same determinism, no second implementation).
- The tiny model ships as **`weights.json`** read by a ~15-line JS forward pass (two matmuls +
  ReLU). **No ONNX / onnxruntime-web / WASM at ship.**
- Rust/WASM is an *optional, offline* speed-up for search only — build it only if search is
  *measured* too slow, and it never reaches the browser.

## Read first (source of truth, in this order)
- `tower-defense-design-plan.md` — the game design (v0.5). Skim §§2–7.
- `PHASE0.md` — the engine contract: determinism, tick order, pathing, decision points.
- `lib.rs` — the interface skeleton, treated as a **language-agnostic spec to port to TS**
  (types, the `Attacker` trait, the `step()` tick order). Don't write Rust; mirror its shape.
- `wave.ebnf` — the Wave DSL grammar (parse target).
- `README.md` (the POC) — the already-proven pipeline: search-teacher → distilled tiny model →
  JS forward pass. You are NOT touching it yet; it validates later phases. `raw_fwd` there is
  the shipped inference.

## Mission this session: Phase 0 → Definition of Done
Port the contract into `sim.ts` so a scripted wave can be simulated headlessly with reproducible
metrics. Ship a small Node entry point that runs a fixed scenario **twice** and asserts
identical `Metrics` — that's the determinism proof.

## Hard constraints — don't violate without flagging to me (Ivy) first
- **Determinism is load-bearing.** Fixed timestep, seeded PRNG, entities in arrays iterated in
  stable id order — never iterate object/Map key order for logic. Use **integer/fixed-point
  math** for sim state (positions, HP, damage, timers); avoid float accumulation. (`PHASE0.md` §1.)
- **The tick order in `step()`'s doc comment is a contract.** Implement it exactly; don't reorder.
- **Only walls block movement; towers never affect pathing.** The basic breakable wall is a
  universal build; Earth's tree specializes it. (design §3.3, §3.5.)
- **One engine, two consumers.** Everything goes through the `Attacker` interface; the sim must
  not know whether search or a model is driving it. Keep the ported types/signatures stable; if
  one must change, call it out in the commit message.
- **Type chart:** 7 elements, wheel Sonic→Earth→Zap→Ice→Fire→Sonic, Light↔Dark mutual, strong/
  weak = **1.5 / 0.5**, neutral & mirror = 1.0. `typeMult` is the single source of truth.

## Suggested order of work (each step compiles + has a test)
1. **Project:** TS + Vitest (or node:test) + a bundler (Vite). One repo; `sim.ts` importable by
   both a Node script and the browser build. Confirm tests run.
2. `Element` + `typeMult` (7×7) — test every strong/weak/mutual edge.
3. Grid + occupancy + buildability; build tower / build wall / sell with cost/refund.
4. **Dual flow fields** (`costWalled`, `costOpen`) via BFS/Dijkstra from Core; recompute only on
   maze change; breach-target selection along the open gradient. Test: a wall detour lengthens
   `distCore`; a sealed Core makes it unreachable and yields a breach target.
5. Entities + movement: mobs follow the field; fliers ignore walls; leaks damage Core; deaths pay
   bounty; breakers damage target walls → removal → field recompute.
6. Towers: target acquisition (priority, then stable id order) + firing with typing × shield ×
   splash × slow; accumulate `dpsUtil`.
7. `parseWave` (grammar in `wave.ebnf`) + validation (budget, ranges, real gates, timings); a
   `PlanAttacker` that executes a wave and resolves reserve guards at decision points.
8. `step()` implementing the exact tick order; decision-point / commit round-trip; `observe()`
   builds the feature grid + build profile.
9. `Metrics` accumulation.
10. **Golden-replay test** (the DoD gate): a recorded (seed, layout, decision stream) runs to
    identical `Metrics` on repeat runs. Add a `headless` Node script that prints the scorecard.

## Definition of done
- Tests green, including the determinism/golden-replay test.
- A headless Node run plays a scripted wave vs a scripted defense and prints a reproducible
  `Metrics` scorecard; running it twice gives identical output.
- No stubbed logic left in the Phase 0 path. Non-goals stay out: no renderer, no model, no search
  (Phase 1+).

## Working style
- Small, compiling commits; a test with each piece. Clarity over cleverness.
- Keep implementations faithful to the doc comments in `lib.rs`.
- If reality forces a contract change, keep it small, isolated, and called out — the training side
  (Phase 2) depends on these types.

## What comes after (context, not this session)
- **Phase 1:** minimal Canvas renderer + a search attacker implementing the `Attacker` interface —
  first *playable*, validates the loop is fun with zero ML.
- **Phase 1.5:** turn on reserve + decision points (still search) — validate the feint/tempo feel.
- **Phase 2:** port the POC recipe (search-teacher → soft-target distill → `weights.json` + JS
  forward pass) onto the real spatial observation, adding a small conv encoder in front.

Before deep work, confirm two things with me: that the **integer/fixed-point** approach for sim
math is what we want (default: yes), and that the repo has `sim.ts` importable by both Node and the
browser build. Then start at step 1.
