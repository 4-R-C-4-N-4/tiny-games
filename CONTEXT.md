# CONTEXT — why these games exist, and how to start a new one

This document is the prompt. If you are an agent (or a human) about to design or build a
game in this repo, read all of it first — it is the difference between generating *a*
game and generating one of *these* games. The per-game deep docs
([robo-smash/ROBO-SMASH-INTENT.md](robo-smash/ROBO-SMASH-INTENT.md),
[wiz-tower/docs/kickoff/](wiz-tower/docs/kickoff/),
[lexomancy/docs/](lexomancy/docs/)) are worked examples of everything below.

---

## I. The intention

Most game "AI" is either a scripted state machine or a call out to a cloud model. This
repo chases a third path: **small models that ship with the page** — a client-side
intelligence that feels like it's thinking, in one self-contained file. No backend, no
API key, nothing phoned home at play time. Every game is a static page you can open
offline, and every game is an experiment in how much *mind* fits in one.

The intelligence takes one of two postures:

- **Adversarial — the arms race.** The game studies *you*: your habits, your favourite
  moves, your go-to build, where you habitually land — and pre-counters it, inside a
  provably fair envelope. Every run diverges because the game is genuinely responding
  to you. The magic of a great human level designer is *authored malice*; these games
  replicate that malice with a model, and a verifier keeps it honest.
- **Oracular — grounding.** The game pre-computes what a small model can't be trusted
  to notice (spread positions, suit currents, repeated ranks) and hands the model a
  reading it only has to voice. The intelligence isn't adversarial; it's interpretive —
  and the engineering is in what you compute *for* it.

Under both: **generative, seeded content**. Levels, spreads, and economies are composed
by seeded procedures, so every run is fresh, every run is shareable (`?seed=N` replays
it exactly), and every run is training data.

"Tiny" is not modesty — it's the forcing function. One page of HTML means the model
must be small enough to ship, the sim must be deterministic enough to train against,
and the design must be sharp enough to not hide behind content volume.

## II. Hard invariants (never negotiate these)

1. **One self-contained HTML file ships.** Either hand-authored (robo-smash) or a
   minimal build that emits one file (`npm run single`, vite + singlefile). No servers,
   no external inference. Big model weights may be fetched-once-and-cached from a CDN
   (tarot); the page itself stays tiny and works offline after first load.
2. **The intelligence is client-side**, in one of the proven shapes — or a new shape
   that meets the same bar:
   - **Search-distilled MLP** (wiz-tower): branching search over your own deterministic
     sim generates labels; a few-thousand-param net distills it; numpy → ONNX → a
     ~15-line pure-JS forward pass.
   - **Teacher-distilled scorer** (lexomancy): a local LLM labels a corpus once;
     a tiny head + quantized embeddings ship (~MBs); goldens pin train/serve skew to zero.
   - **In-browser LLM** (tarot): transformers.js, WebGPU with WASM fallback, weights
     cached by the browser, deterministic template fallback when unavailable.
   Training happens locally (the 3090). **Ship the student, never the teacher.**
3. **Determinism is load-bearing.** Fixed timestep, fixed tick order, no randomness in
   physics/rules. *State* randomness (layout, economy, AI) flows through a seeded RNG
   with a loggable seed; *cosmetic* randomness (particles, shake) stays unseeded and is
   never allowed to touch state. `?seed=N` replays a run exactly, drops included, and
   a share affordance (button + `C` key) copies that link.
4. **A headless test harness is a first-class artifact** and the deploy gate. The sim
   must run under Node (stub the browser APIs if hand-authored; separate engine module
   if built). Cover: generation validity across many seeds, determinism, the game's
   fairness floors, input-latch edge cases, and a long random-input soak. The passing
   count goes in `game.json.note` — brag with evidence.
5. **A minimal play loop ships, and the agent plays the game.** Every build exposes
   `play.observe() → play.act(<verbs>) → play.step()` over the real sim — the player's
   verbs and player-visible state ONLY, never internals (internals are for harness
   assertions, not for play). All harness bots go through it. Before first-gen is done,
   the building agent plays: a **null** policy, a **naive** policy, and a **tuned**
   policy, and the harness asserts the skill gradient — null always loses, outcomes
   strictly order null < naive < tuned. If null ≈ naive the game lacks depth; if tuned
   loses at random it's unfair. The same loop is the Phase-2 self-play training tap —
   "one engine, two consumers" made literal.
6. **The deploy contract**: a `game.json` (`name`, `rune` emoji, `tagline`, `note`,
   optional `embed:false` for fullscreen-only cabinets, optional `order` for cabinet
   placement — ascending, unset sorts last alphabetically) + a block in
   `.github/workflows/deploy.yml` that gates on the harness and copies/builds into
   `_site/<slug>/`. Push to main → Pages → the ARCANA site picks it up from
   `games.json` with zero site edits.
7. **PR flow.** Branch from `origin/main`, PR, merge. Worktrees live in
   `../tiny-games-worktrees/<slug>`.
8. **Baseline player expectations ship with every game**: pause (key + touch target +
   auto-pause when the tab hides, any tap resumes), instant restart, seed sharing, and
   sane idle behaviour. In any real-time game **the null strategy must lose** — hands
   off the controls is a losing strategy, and the harness proves it. (A harness full of
   competent bots will never notice that doing nothing is safe; test incompetence too.)

## III. Hard-won lessons (each cost a rewrite somewhere)

- **If a game rule exists in two places it will drift.** One engine, two consumers: the
  live game and the training/search pipeline call the same sim. (wiz-tower PHASE0)
- **Name the model's call site on day one, fill it with a heuristic.**
  `estimateArrival(state) -> frames`, `boulderPolicy(state) -> accel` — heuristic now,
  learned later, same signature. You can ship Phase 0 without ML and it already feels
  intelligent. (robo-smash crushers)
- **Validate fun with search/heuristics before spending anything on distillation.**
  If it isn't fun with a cheating heuristic, no model will save it. (wiz-tower)
- **Mechanics-width is on the AI's critical path, not a detour.** A director is only as
  interesting as the knobs it can turn. Build the vocabulary before the brain.
  (robo-smash §3.5)
- **The adversary must be legible or it feels rigged.** Telegraphs with hard time
  floors, post-hoc recaps, "SUBJECT PROFILE UPDATING…" tells. Transparency converts
  adaptive difficulty from a rig into a duel. (all adversarial games)
- **Fairness is a verifier, not a vibe.** "Adversary proposes, verifier disposes."
  Objective = near-misses, never deaths: an adversary maximizing near-misses is a great
  level designer; one maximizing deaths is a troll. And **unnumbered guardrails are
  unenforceable** — set the floors (telegraph ms, margin frames, death-rate caps) as
  numbers before the phase that needs them ships. (robo-smash §4)
- **Feel first.** Write a numbered feel contract before tuning anything; hang every
  constant off a rule; the adversary adapts to the player, never the physics. Playtest
  the first 20 seconds after every change; feel regression = revert first, discuss
  second. (robo-smash C1–C10)
- **Anti-min-max: convert the spam instinct into breadth.** Players will find the
  strongest move and repeat it; build the systems that make repetition self-defeating
  (fatigue, reactive wards, adaptation). (lexomancy)
- **Art is generative and mechanics-driven.** Procedural sprites, palettes keyed to
  game state, VFX that literally display the model's output vector. Same data drives
  mechanics and visuals. (lexomancy, tarot sigils)
- **An agent that never looks at its own output ships bad art.** Every sim check can
  pass while the game looks broken — first-gen boulder-rush did exactly that. Rendering
  claims only become falsifiable as screenshots: drive the game headless (firefox
  `--headless --screenshot`, fast-forward the sim, force a `draw()`), capture start /
  mid-action / fail-state frames, and diff them against the brief's visual checklist
  *by looking at them*. This is the lexomancy gallery loop, generalized. (boulder-rush)
- **Derive cameras and projections from one continuous function.** Piecewise mappings
  kink where the pieces meet and modulo-windowed effects pop as elements enter their
  window — players report it as "phasing in and out." One smooth `1/distance` mapping
  for everything on the track fixed it. (boulder-rush)
- **Play your own game — a policy ladder finds what checks can't.** boulder-rush's
  first "naive" bot (sloppy late jumps) scored WORSE than doing nothing, revealing both
  a bot mis-model and a real insight about the skill curve (avoidance is the low-skill
  path, timing the high-skill one). Scripted checks verify claims you thought of;
  playing finds the ones you didn't. And fix what the ladder finds in the *policies or
  the knobs*, never by bending feel constants to flatter a bot. (boulder-rush)
- **Keep decisions visible.** Resolved open questions get struck through and dated in
  the intent doc, never deleted — the doc is a living changelog of *why*. (robo-smash §6)

## IV. Starting a new game: the brief template

Copy this into `<slug>/<SLUG>-INTENT.md`, fill every slot, then build. The touchstone
loop (slot 2) is the engine of first-gen quality: **anchor on a real game and close the
gap to it before diverging.** Slots left TBD must say TBD loudly.

```markdown
# <NAME> — Design Intent & Handoff

**Status:** <one line — what exists, what's next>
**Prime directive:** <the one thing that must never regress; when in doubt, playtest X>

## 1. What this game is
<2–4 sentences: the fantasy, the loop, the AI differentiator, the ship path.>

## 2. Touchstone — "<real game / system>"
This is <real game>'s <specific system>. Build toward 1:1 on the list below BEFORE
adding anything original. The loop: implement → play 20 seconds → diff against this
list → fix the biggest gap → repeat. Parity first, divergence second.
The magic, as testable statements:
1. <e.g. "the boulder visibly almost catches you at least once per run">
2. <e.g. "reaction window from obstacle reveal to arrival is always ≥ N ms">
3. <5–10 total; each one falsifiable in a playtest or a harness check>
Divergence (only after parity): <what this game does that the touchstone never did —
usually the AI angle>.

## 3. The Feel Contract (non-negotiable)
F1. <input latency / responsiveness rule>
F2. <movement character rule>
F3. <...3–10 numbered rules; every physics/timing constant hangs off one>
Current tuned constants: <table, or TBD>.

## 4. Art direction
Palette: <hex swatches, or "inherit the house palette — slate #2b3442 / cyan #7fd8e8 /
amber #e8a33d accents on #0b0e14">. Visual touchstone: <"reads like X" — a separate
anchor from the mechanics touchstone>. Technique: <procedural canvas / pixel grids /…;
same data drives mechanics and visuals>. Negative space: <what it must NOT look like —
name the clichés to avoid, e.g. "no browns, no default-canvas look">.
Visual checklist (falsifiable, screenshot-diffable):
1. <e.g. "the pursuer rests ON the road — never spills past its contact line">
2. <e.g. "no seams, no popping, no elements phasing in and out">
3. <3–6 total; each one checkable by looking at a single frame>

## 5. Verbs & knobs
Player verbs: <the complete input surface — spend it deliberately, it will fill up>.
Adversary knobs: <every parameter the AI may tune, with ranges; it never touches
anything outside this list>.

## 6. The AI angle
Pattern: <search-distilled MLP | teacher-distilled scorer | in-browser LLM | new>.
It studies: <the player signals — with the telemetry tuple spelled out>.
Objective: <stated WITH its fairness envelope, e.g. "maximize near-misses subject to:
solvable path ≥ N frames margin, death rate ≤ X/min">.
Legibility tell: <how the player is shown they're being studied>.
Call sites: <exact function signatures where heuristic → model swap happens>.

## 7. Determinism plan
State RNG: <seeded generator, what flows through it>. Cosmetic RNG: unseeded, never
touches state. Seed sharing: ?seed=N + share button. Replay implications: <notes>.

## 8. Phase ladder
Phase 0 — substrate (no ML): telemetry, heuristic adversary at the named call sites,
  generative content grammar with knobs. SHIP TARGET for first gen.
Phase 1 — heuristic director/policy using telemetry.
Phase 2 — distilled model (local training → ONNX/weights → pure-JS inference).
Phase 3 — verifier in the loop (fairness floors enforced by search/solver).

## 9. Guardrails for the agent
- Never touch Feel Contract constants to balance the AI.
- Hard floors (NUMBERS, or "TBD before Phase 1 ships"): <telegraph ≥ __ms, margin ≥
  __frames, death rate ≤ __/min, ...>
- Single-file ship path. Deterministic core. Playtest-first-20-seconds after changes.

## 10. Harness expectations
Headless Node driver over the real sim, and a **play loop** (`observe/act/step`,
player verbs only) that all bots use. Checks: <generation validity across ≥100 seeds,
determinism, each fairness floor, input latches, the policy ladder (null always loses;
null < naive < tuned strictly), soak ≥ 20k ticks>. Wired as the deploy gate. Count
goes in game.json.note; the play report (three policies' scores) goes in this doc.
Render gate: headless-browser screenshots (start / mid-action / fail state), diffed
BY EYE against §4's visual checklist before first-gen is called done.

## 11. Ship path
game.json: {name, rune, tagline, note, embed}. Deploy block in deploy.yml. Mobile:
<touch controls / pointer scheme>. embed: <true|false + why>.

## 12. Definition of first-gen done
Touchstone parity list green in playtest + §4 visual checklist green in screenshots +
Phase 0 substrate live + harness green with the skill gradient proven through the play
loop + deployed. Then STOP and hand off with this doc updated.

## 13. Open questions (deliberately unresolved)
- <...; resolved ones get struck through and dated, never deleted>
```

## V. Worked example — BOULDER-RUSH brief

*A brief, not a commitment — the starting prompt for the next game.*
*(Postscript: the game has since shipped from this brief —
[boulder-rush/BOULDER-RUSH-INTENT.md](boulder-rush/BOULDER-RUSH-INTENT.md) is the
living version. The first build validated the mechanics slots and exposed the ones this
brief originally lacked: the art-direction section below, the screenshot render gate,
and the null-strategy test all exist because their absence cost a playtest round.)*

# BOULDER-RUSH — Design Intent & Handoff

**Status:** Brief only. Nothing built.
**Prime directive:** The boulder must feel like it is *about to catch you* for the
entire run without cheating. When in doubt, playtest 30 seconds and watch the gap.

## 1. What this game is
An endless chase down a stone canyon: the runner sprints toward the camera, a boulder
the size of the screen grinds after them, obstacles rush up from the bottom edge.
Steer with the pointer (mouse or thumb — mobile-first), tap to hop. Obstacles never
kill; they *slow* — and the boulder is the only executioner. The AI differentiator:
the chase director. One self-contained HTML file.

## 2. Touchstone — Crash Bandicoot's boulder chase
Build toward 1:1 on the list below before adding anything original.
The magic, as testable statements:
1. The player character faces the camera; dread comes from what's *behind* them
   filling the frame.
2. The boulder visibly gains on every mistake within 250ms — cause and effect readable
   in one glance.
3. At least one scripted-feeling near-miss lunge per run (telegraphed, survivable).
4. Reaction window from obstacle reveal (bottom edge) to arrival at the player is
   always ≥ 700ms at current speed.
5. A death is always attributable to mistakes made in the last ~4 seconds.
6. Proximity is multi-channel: boulder scale + rumble volume + screen shake all track
   the gap.
7. A clean no-stumble stretch visibly opens the gap — hope is part of the loop.
Divergence (after parity): the boulder is a *director* — it studies your steering
habits and spawns danger where you habitually drift; the fairness envelope keeps
every course provably passable.

## 3. The Feel Contract (non-negotiable)
F1. Pointer-to-player latency ≤ 1 sim tick; steering is critically damped — no
    overshoot, no jitter.
F2. Jump is a fixed, buffered arc (tap ≥ 1 frame registers; no double jump).
F3. 60Hz fixed-timestep sim; rendering never gates input.
F4. Boulder pressure is always legible (F=gap): scale, rumble, shake — one glance.
F5. Obstacles slow, only the boulder kills. No instant deaths from the course.
F6. Camera fixed; the road does the motion. No lateral camera movement.
Constants: TBD in build (document them in a table here as they're tuned).

## 4. Art direction
Palette: inherit the house palette — slate `#2b3442` / cyan `#7fd8e8` / amber
`#e8a33d` accents on `#0b0e14`. Visual touchstone: a midnight foundry causeway — neon
edge rails converging to the horizon, lit pylons, tower silhouettes. Technique:
procedural canvas; proximity data drives the visuals (boulder scale, crack heat,
vignette, rumble all read the gap). Negative space: no browns, no dirt-canyon
default, no gradients-as-texture.
Visual checklist:
1. The boulder rests ON the road — it never spills past its own contact line.
2. No seams on the track; nothing pops or phases — one continuous projection.
3. The three obstacle intents are tellable apart at a glance (hop / hop / never-touch).
4. Proximity is readable in a single frame with the HUD covered.
5. A frame at rest gap and a frame at near-catch look like different emotional states.

## 5. Verbs & knobs
Player verbs: steer (pointer x), hop (tap / click / space). That is the entire
surface — mobile-first means two verbs, spent.
Adversary knobs: obstacle density, pattern mix, lateral gap width & placement,
pickup-line placement, boulder target-gap curve, surge magnitude/cooldown.

## 6. The AI angle
Pattern: heuristic chase director now → search-distilled policy later (wiz-tower
recipe).
It studies: steering-position histogram, dodge direction bias, jump timing
distribution, post-stumble panic behaviour. Telemetry tuple per obstacle:
(type, x, width, player_x at reveal, steer path, jump frame offset, outcome).
Objective: maximize near-misses (gap dips within N frames of catch) subject to:
course passable with ≥ M frames slack at current speed; catch only via compounded
recent stumbles; surge telegraph ≥ 500ms.
Legibility tell: boulder "roars" (audio + shake + shadow) before every surge; a
between-runs line names what it learned ("you dodge left. it knows.").
Call sites: `boulderPolicy(state) -> accel`; `spawnPattern(rng, knobs) -> row`.

## 7. Determinism plan
Seeded mulberry32 over course generation and director decisions; cosmetic dust/shake
unseeded. `?seed=N` + share button + C, robo-smash-style. Telemetry export with T.

## 8. Phase ladder
Phase 0 (SHIP TARGET): seeded course grammar + heuristic boulder policy with the
fairness floor + full telemetry + near-miss beats. Phase 1: director tunes knobs from
the histograms between stretches. Phase 2: distilled steering-prediction model places
obstacles at habitual paths. Phase 3: passability verifier on every spawned row.

## 9. Guardrails for the agent
- Never touch F1–F6 constants to make the boulder scarier; scare via the knobs.
- Floors: surge telegraph ≥ 500ms *(fixed)*; reveal-to-arrival ≥ 700ms *(fixed)*;
  min gap without recent stumble ≥ TBD frames *(set before Phase 1)*.
- Every spawned row must be passable: a lateral gap ≥ player width + margin, or
  all-jumpable. Enforce in the spawner AND check in the harness.
- Single file, portrait-friendly canvas, touch-first. Playtest 30s after each change.

## 10. Harness expectations
Headless driver (vm + stubs) + the play loop (`play.observe/act/step`). Checks: row
passability across ≥ 200 seeds, determinism (same seed = same course + same director
decisions under scripted input), fairness floor (perfect bot is never caught; gap ≥
floor without stumbles), the policy ladder (null always dies; null < naive < tuned —
shipped report: 116m < 307m < 4809m-at-cap), stumble/surge mechanics, telemetry
shape, ≥ 30k-tick pointer-fuzz soak. Deploy gate. Render gate: headless screenshots
vs the §4 checklist.

## 11. Ship path
game.json: rune 🪨, embed:false (fullscreen — pointer tracking wants the whole
screen). Deploy block mirrors robo-smash (no build; harness gate; copy single file).

## 12. Definition of first-gen done
Touchstone list 1–7 green in playtest, Phase 0 live, harness green, deployed. Stop;
update this doc; hand off.

## 13. Open questions (deliberately unresolved)
- Endless-only, or distance milestones with escalating biomes?
- Daily seed (everyone runs the same canyon, compare distances)?
- Does the runner share the robo-smash robot's identity (same universe) or get its own?
