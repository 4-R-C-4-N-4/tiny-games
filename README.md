# tiny-games

Small games, each an experiment in one idea: **give the player a real opponent** — a tiny,
learned, adversarial AI that reads what you're doing and attacks it, running **entirely
client-side**. No backend, no API key, nothing phoned home at play time. The whole game is a
static page you can open offline.

## The idea

Most game "AI" is either a scripted state machine or a call out to a cloud model. This repo
chases a third path: the opponent is a **small model distilled from search over the game's
own deterministic simulator**, plus a few hand-authored strategist layers on top — all
shipped as a self-contained file.

The interesting behaviour doesn't come from a big model writing clever things. It comes from
the **arms race**: an attacker that partially conceals its plan, commits a hidden reserve
based on where your fire *actually* goes, remembers your habits across a run, and probes the
specific board you built — so every run diverges because it's genuinely responding to *you*.
WASM and LLM-emitted content are tools in the box (the wave format is a tiny grammar a model
could emit), but the bar is a client-side opponent that feels like it's thinking, not the
size of the model behind it.

## Games

### 🧙 wiz-tower — adversarial tower defense

A mobile-first, vertical tower-defense game where the attacking waves are generated live by a
tiny adversary that reads your defense and strikes its gaps. You pick a **wizard discipline**
(one of seven elemental schools), maze the field with wards and walls, **scry** the
telegraphed opener, counter-build, and hold your Heartstone as the assault escalates.

**What makes it tick — one deterministic engine, several opponents behind one interface:**

- **The simulator.** A headless, fully deterministic sim (fixed-point Q22.10 math, flow-field
  pathing with destructible walls and breaching, a strict tick order). Determinism is the
  whole foundation — the attacker *forks the live game*, plays candidate waves on the copy,
  scores the outcomes, and fires the best one. Locked down by golden-replay tests.
- **The elemental lattice.** Seven schools on a 5-wheel plus a Light⇄Dark mutual pair (1.5× /
  0.5× matchups), each a T1→T2→T3 tree. Every school has a real mechanical identity —
  Fire splashes, Ice slows, Zap chains anti-air, **Sonic (Resonance)** shatters shields and
  hushes healers, **Dark (Umbra)** harvests bonus power from its own kills, and so on — so
  "read the foe's colours and answer the school they ward weakly" is the core read.
- **The Mind (the shipped foe).** A cross-wave **Strategist** that models your habits: it
  hammers the school you *chronically* answer weakest, escalates air/stealth when you never
  cover it, runs a **multi-wave feint** (bait a flank, watch you reinforce it, then strike the
  flank you thinned), **paces itself to your skill** (presses when you're cruising, eases when
  you're on the ropes), and **pre-counters your go-to build** — all narrated in the telegraph
  so you can watch the trap form.
- **The distilled net (dev tool).** A ~2.5k-parameter MLP distilled from the search teacher and
  run by a ~15-line JS forward pass — the original "the AI is a tiny shippable model" thesis.
  Kept behind a training toggle now that the Mind is the headline opponent.

**Also built along the way:** an escalating difficulty ramp that actually scales (late waves
arrive as denser, tougher, faster hordes instead of a fixed trickle a maxed board ignores);
in-wave tactical verbs (overcharge / reveal / reinforce); a post-wave recap that makes the
feint legible; a full wizard-arcane visual identity (procedural creatures, warded-runestone
walls, an affinity sigil); and a one-file, offline-capable build. 95 tests, green.

**Play it:**

```bash
cd wiz-tower
npm install
npm run dev          # play in the browser
npm run single       # → dist/wiz-tower.html, one self-contained offline file
npm test             # the full suite
```

Full details, the phase-by-phase build log, and the design docs live in
**[`wiz-tower/README.md`](wiz-tower/README.md)** and
[`wiz-tower/docs/kickoff/`](wiz-tower/docs/kickoff) (design plan, engine contract, wave
grammar).

## Repo layout

```
tiny-games/
├── wiz-tower/          # the first game — adversarial tower defense
│   ├── src/            # deterministic sim + attacker tiers (search, strategist, distilled net)
│   ├── web/            # Canvas renderer, DOM HUD, start screen, theming
│   ├── scripts/        # training, distillation, balance harnesses, headless tools
│   ├── docs/kickoff/   # design plan, engine contract (PHASE0), wave DSL grammar
│   └── README.md       # deep dive on wiz-tower
└── README.md           # you are here
```

## License

[Apache 2.0](LICENSE).
