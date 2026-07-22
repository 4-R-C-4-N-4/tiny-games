# tiny-games

Small games, each an experiment in **plugging a tiny AI into a single page of HTML** — a
learned adversary that reads what you're doing and attacks it, a distilled scorer that
grades your vocabulary as spellcraft, a pocket LLM that reads your tarot spread — all
running **entirely client-side**. No backend, no API key, nothing phoned home at play time.
Every game is a static page you can open offline.

## The idea

Most game "AI" is either a scripted state machine or a call out to a cloud model. This repo
chases a third path: **small models that ship with the page**. That takes different shapes
per game — an opponent distilled from search over the game's own deterministic simulator
(wiz-tower), an embedding-space word scorer distilled from a local-LLM teacher (lexomancy),
a quantized instruct model pulled into a Web Worker to interpret a spread (tarot) — but the
bar is always the same: a client-side intelligence that feels like it's thinking, in one
self-contained file.

In the adversarial games the interesting behaviour comes from the **arms race**: an attacker
that partially conceals its plan, commits a hidden reserve based on where your fire
*actually* goes, remembers your habits across a run, and probes the specific board you built
— so every run diverges because it's genuinely responding to *you*. In the oracular ones it
comes from **grounding**: the page pre-computes what the model can't be trusted to notice
(spread positions, suit currents, repeated ranks) and hands the small model a reading it
only has to voice.

## Games

### 📖 lexomancy — a war of words

A word-spell roguelike where **your vocabulary is your build**. Type any English word; a
client-side model scores it live across four spell channels (damage / hex / ward / heal)
in a scrying-glass preview, then you cast it in strict-alternation duels up a spire of
eight floors. "Kill" is a cantrip; "conflagration" is an arcane spike; "bureaucracy" is,
correctly, a hex.

**What makes it tick — one embedding space powers every system:**

- **The scorer.** 80k dictionary-filtered words as int8 PCA-reduced GloVe embeddings plus
  a tiny MLP head distilled from a local-LLM teacher (~8.5MB total, instant vanilla-JS
  inference). Word rarity (Zipf) is the power knob — erudition is literally damage. The
  reusable distillation pipeline lives in [`lexomancy/train/`](lexomancy/train/README.md).
- **Semantic fatigue.** Casts leave residue: repeat a word — or a near-synonym — and it
  fizzles at full mana cost. Real embedding cosine, so "inferno" after "conflagration"
  genuinely tires. Variety is the mana pool.
- **The Self-Naming Rite.** Draft five adjectives (synonyms collapse — the anti-dump-stat
  lesson) plus a free-form flaw; stat anchors turn them into your build, and they seed
  your **True Name** — which bosses that survive long enough will speak, and sharpen.
- **The spire studies you.** Floors roll archetype × theme (domains amplify, taboos
  backfire, echoes return your words, drains cling); bosses climb a policy ladder from
  random through counter-casting to fatigue-exploiting; upper floors open pre-warded
  against your run's semantic fingerprint. At the Summit, **The Mirror** casts only words
  you cast this run — beat your past self with vocabulary you haven't spent.
- **Procedural pixel art.** Sprites are text grids palette-swapped by floor theme; your
  cloak (and The Mirror) wear your dominant stat's color. Channel-coded VFX display the
  score vector: damage streaks, hex tendrils, ward rune-rings, heal motes.

**Play it:**

```bash
cd lexomancy
npm install
npm run dev          # play in the browser
npm run single       # → dist/lexomancy.html, one self-contained offline file (model included)
npm test             # engine + scorer golden suite
```

Design doc: [`lexomancy/docs/lexomancy-design-doc.md`](lexomancy/docs/lexomancy-design-doc.md).
Sprite gallery for art direction: `npm run dev`, then open `/?gallery`.

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

### 🔮 tarot — a tiny oracle reads your spread

A daily tarot table. Ask a question (or don't), draw a 3-card or Celtic Cross spread from
the full 78-card deck, flip the cards, then let a **tiny LLM running in your browser** weave
the spread into a reading.

**What makes it tick:**

- **The deck is bound to the day.** Spreads are seeded from `date::spread::question` — the
  same question on the same day always deals the same cards (Fisher–Yates over an LCG, no
  card repeats). Readings are shareable as deep links (`?spread=three-card&q=…&rev=1`).
- **Reversals are off by default** — flip them on in the settings pane (gear, top right).
  Toggling never changes *which* cards you draw, only whether they may land inverted.
- **The 1909 deck.** Card faces are Pamela Colman Smith's original Waite–Smith artwork
  (public domain: US pre-1931 publication; UK/EU since 2022, 70 years after Smith's death),
  sourced from Wikimedia Commons scans of the 1909 printing and bundled as ~2.8MB of WebP.
  Note the deck is deliberately *not* branded "Rider-Waite" — that name is a U.S. Games
  trademark, and their modern recolored editions remain copyrighted; only the original
  printing's art is used. Procedural pixel sigils (mirrored cellular-automata glyphs,
  suit-tinted) remain as the fallback for any card without a scan.
- **The spread reads itself before the model does.** Every position carries its meaning
  into the prompt, every card brings its imagery, and cheap pre-computed "currents" —
  suit dominance, repeated ranks (The Empress counts among the Threes), Major Arcana
  density, reversal skew — hand the small model the cross-card patterns it would never
  spot alone. The same currents surface in the UI.
- **The oracle.** SmolLM2-360M-Instruct via transformers.js — WebGPU when a real adapter
  answers the probe, WASM otherwise. Weights (~270MB q4) are fetched once on first
  "Interpret Spread" and cached by the browser; the game page itself stays a ~30KB static
  file. Offline or blocked? A deterministic template reading steps in, currents included.

**Play it:**

```bash
cd tarot
npm install
npm run dev          # play in the browser
npm run single       # → dist/tarot.html, one self-contained offline file
npm test             # engine suite
```

## Repo layout

```
tiny-games/
├── lexomancy/          # word-spell roguelike duel (in progress)
│   ├── src/            # headless duel engine + scorers (stub and distilled model)
│   ├── web/            # portrait battle stage, live spell preview, lexicon.bin asset
│   ├── train/          # reusable distillation pipeline: vocab → teacher labels → head → pack
│   └── docs/           # design doc
├── tarot/              # daily tarot with an embedded in-browser LLM interpreter
│   └── src/            # spread engine, procedural card art, oracle (transformers.js)
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
