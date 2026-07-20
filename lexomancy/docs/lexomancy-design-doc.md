# LEXOMANCY
*A war of words. Climb the spire. Cast your vocabulary.*

---

## Concept

A single-page browser roguelike where **words are spells**. The player duels a sequence of AI opponents up the floors of a spire by typing words, each scored in real time across four spell channels by a small client-side ML model. Victory comes not from finding the One Best Word, but from erudition: a deep, varied vocabulary is literally the player's power.

**Platform:** One HTML page. No server. All inference client-side.

---

## The Magic System

### Four spell channels

Every word maps to a 4-dimensional spell profile:

| Channel | Effect |
|---------|--------|
| **Damage** | Direct harm to the opponent |
| **Hex** | Debuffs: weakens opponent's casts, drains over time |
| **Ward** | Absorbs incoming spells in its dominant channel |
| **Heal** | Restores health, cleanses hexes |

Words are rarely pure. "Rot" is hex + damage. "Dawn" is heal + ward. "Mirror" is nearly pure ward. Hybrid words are mana-efficient; pure words are expensive spikes.

### Live preview

As the player types, four bars fill in real time showing the word's spell profile *before* committing. The compose box is a scrying glass — exploration of the semantic space is a core pleasure loop. Deterministic scoring means the same word always produces the same spell, so players build a personal grimoire of discoveries across runs.

### Scoring engine

**Architecture (decided): static embeddings + distilled head.**
- Subset GloVe/fastText to ~50k words, int8-quantized (a few MB).
- Offline: label a few thousand seed words with a large teacher model ("score *inferno* on damage/hex/ward/heal"), train a tiny MLP head mapping embedding → channels.
- Ship head weights as a small blob; inference is instant vanilla JS. WASM optional.

**Rejected alternative:** MiniLM-class encoder via transformers.js (ONNX, ~20MB quantized) — only needed for multi-word incantations, which are out (see Open Questions #1).

**Anchor method:** channels (and stats, and floor domains) are all defined as anchor vectors — centroids of curated word sets. A word's profile is its similarity to each anchor, sharpened by softmax temperature. One mechanism powers the entire game.

### Word rarity as loot

Ship a Zipf frequency table. Common words are power-capped: "kill" is a cantrip; "immolate" hits hard; "conflagration" harder still. The min-max path *is* vocabulary depth — the exact fantasy the game sells.

---

## Anti-Min-Max Design

The central design problem: players will find the strongest word and spam it. Every system below converts that instinct into breadth-seeking.

### 1. Semantic fatigue
Each cast leaves residue. New casts lose power proportional to cosine similarity with the last N words cast. "Kill" after "murder" fizzles. Vocabulary variety is the mana pool.

### 2. Reactive wards
An active ward absorbs its dominant channel. Reading the opponent's spell and answering *orthogonally* is the core tactical read.

### 3. Floor domains
Each spire floor carries a semantic aura (one extra anchor mixed into scoring, for both combatants):
- **The Ossuary** — death/bone/decay words amplified
- **The Garden** — growth/bloom words amplified
- **The Storm Gallery** — weather/sky words amplified

The optimal wordlist changes every floor.

### 4. Taboos
Some floors forbid a semantic region:
- **The Silent Floor** — sound words fizzle
- **The Bloodless Court** — violence words backfire as self-damage

Players must find damage without damage-words: "gravity", "rust", "winter".

### 5. The spire studies you
Boss wards are tuned to the centroid of the player's last 10–15 casts across the *whole run*. A run's word history is a fingerprint; leaning on one theme all game means walking into a pre-warded boss.

---

## Character Creation: The Self-Naming Rite

Before the climb, the player describes themself in adjectives. Adjectives are scored (same engine) against five **stat anchors**:

| Stat | Governs | Example adjectives |
|------|---------|-------------------|
| **Ferocity** | Outgoing damage multiplier | ruthless, burning |
| **Guile** | Hex potency and resistance | cunning, veiled |
| **Stone** | Ward strength and duration | patient, granite |
| **Grace** | Heal efficiency, fatigue recovery | gentle, verdant |
| **Resonance** | Effective vocabulary breadth — rare/archaic words fizzle less | learned, ancient, strange |

### Anti-dump-stat mechanic
Adjectives interact by mutual similarity: near-synonym sets ("cruel, vicious, brutal, savage") collapse with diminishing returns — a glass cannon with a shallow vocabulary. Varied self-description yields a larger, rounder stat pool. Character creation teaches the fatigue mechanic before the first duel.

### Drafted, roguelike-style
Pick 5 adjectives from a rotating offer of ~12 per run (no free-form "omnipotent" exploits; natural balance and run variety for free), **plus one free-form "flaw" adjective** that grants bonus points — creative self-sabotage the player writes themself.

### True Name
The chosen adjectives seed the character's True Name. Enemies that survive enough rounds "learn" it and gain a bonus against the player's dominant stat: extremity has narrative cost.

---

## The Spire

**Structure: 7 randomized floors + the Summit (floor 8, The Mirror).** Fixed count per run — short enough for one sitting, long enough for the spire to learn the player's fingerprint. **One boss per floor, no mobs.** Every fight in a duel game is conversation-length; filler encounters are padding.

### Floor generation: archetypes × themes

Floors are **hand-authored mechanic skeletons filled with generated semantic content**:

**Archetypes** (~6–8, contain all hardcoded logic):
| Archetype | Rule |
|-----------|------|
| **Domain** | An aura anchor amplifies a theme for both combatants |
| **Taboo** | Words in a forbidden region fizzle or backfire as self-damage |
| **Drain** | Fatigue decays slower; variety pressure doubled |
| **Echo** | Your own last cast is re-cast at you at half power |
| **Leyline** | One random channel amplified for both sides |

**Theme library** (~25–30 curated anchor wordsets, authored once): bone, tide, ash, clockwork, honey, frost, ruin, choir, etc. A theme is just an anchor vector, so filling a slot is trivial.

The generator rolls `archetype × theme` per floor at run start ("Taboo × fire", "Domain × clockwork", "Echo × tide"), with constraints: no archetype twice in a row, difficulty-tiered archetype pools, at least one Taboo per run. Small authored content, large combinatoric variety.

### Floor legibility (three layers)

1. **The Threshold (entry screen).** Between floors: generated floor name ("The Bloodless Court"), one-line flavor inscription, and *plainly stated* mechanical text ("Words of violence turn against their speaker"). Includes a free **practice input** — preview-score words under the floor's rules before stepping in. The threshold is a planning phase.
2. **Ambient signal.** Palette/background tint derived from the theme anchor; persistent corner icon + rule reminder.
3. **The preview bars reflect floor modifiers — always.** Taboo words show bars crossed out or turned against you; domain-amplified words visibly glow. The player never mentally computes floor rules; the scrying glass does it. *This is the single most important indicator in the game.*

### Threshold choices (mob-replacement texture)

Each Threshold offers one optional decision, entirely menu-based:
- **Pact:** accept a minor self-hex this floor in exchange for a boon (new adjective draft, mana bonus)
- **Study:** spend a little max HP to learn the boss's wordlist theme and ward policy before the fight

### Boss = floor

Each boss's policy keys off its floor archetype (the Echo floor's boss baits casts it can echo back). Floor and enemy are one designed unit — more distinct fights, *less* content to author.

### Difficulty ladder

Enemies escalate by *policy intelligence*, not stat inflation:

| Tier | Enemy behavior |
|------|---------------|
| Lower floors | Cast randomly from a theme wordlist |
| Mid floors | Counter the player's dominant channel |
| Upper floors | Exploit fatigue trails, feint with hybrids, pre-ward |
| **Apex** | **The Mirror** — casts exclusively from the player's own run history. Beat your past self with vocabulary you haven't spent. |

### Opponent profiles
Enemies use the same scoring model with different vocabularies and policies — zero extra ML per enemy:
- **The Necromancer** — decay/death lexicon, hex-heavy
- **The Hierophant** — liturgical vocabulary, ward/heal sustain
- **The Storm-Caller** — weather lexicon, damage spikes
- *(extendable: each enemy = a wordlist + a policy + a portrait)*

---

## Visual Direction

### Framing: Gen-1 battle layout, portrait-first

Pokémon-style dueling frame: **enemy sprite upper area facing the player; player character seen from behind, lower foreground; input/preview panel at the bottom.** This layout is instantly readable, nostalgic, and — critically — native to portrait orientation, which makes mobile the *default* rather than an adaptation.

**Mobile keyboard is the layout constraint.** The on-screen keyboard consumes the lower half of the screen while composing. Design the compose state around it: input field + live 4-bar preview + fatigue indicator must sit *directly above the keyboard*; enemy sprite and health bars compress but stay visible. Casting (keyboard dismissed) restores the full battle scene for spell VFX. Two layout states: **compose** (keyboard up, info-dense strip) and **theater** (keyboard down, full scene).

Desktop browser gets the same portrait-proportioned stage centered on the page — one layout, two contexts.

### Art: pixel art with palette-swap generation

Pixel art is the right call: it matches the retro battle framing, it's small (kilobytes per sprite — fits the "everything client-side" ethos), and it's the most tractable style to produce consistently.

**Sprite economy trick:** author one base sprite per *enemy class* (Necromancer, Hierophant, Storm-Caller, ...), then **palette-swap and accent-swap by floor theme** — the classic 8/16-bit technique. The Necromancer on a frost floor is ice-blue with different trim; on an ash floor, ember-toned. The archetype × theme combinatorics that generate floors also generate visual variety from a small sprite set. Theme anchor → palette is the same data driving the background tint, so it's coherent for free.

**Player character:** back-view sprite whose palette/details derive from dominant stats chosen at the Self-Naming Rite (Ferocity-heavy = reds and jagged trim; Grace-heavy = greens and flowing lines). Your build is visible on your back.

**Spell VFX:** channel-coded pixel effects (damage = projectile burst, hex = creeping tendrils, ward = rune circle, heal = rising motes), tinted by the cast word's theme similarity. Hybrid spells blend effects proportionally — the VFX literally displays the score vector.

### Production pipeline

Generate concept sprites with an image model, then hand-clean in Aseprite (or commission cleanup). AI output rarely lands on true pixel grids, so budget for cleanup passes: reduce to a fixed palette, snap to grid, redraw hands/faces. ~8–10 base enemy sprites + 1 player back-sprite + effect sheets is a small, achievable asset list.

---

## Open Questions

1. **Single words vs. short phrases** — **DECIDED: single words.** Keeps the static-embedding architecture; casts are one word per turn.
2. **Turn structure** — **DECIDED: strict alternation** for now. Timing/speed elements shelved; revisit only if duels feel flat.
3. **Meta-progression** — **DECIDED: no cross-run carryover** to start. The grimoire exists within a run only; persistence can be layered on later without touching core systems.
4. **Mana economy** — **DECIDED: flat per-turn regen; cast cost scales with word power (channel magnitude × rarity).** Mana deliberately NOT tied to Grace — that would make Grace a mandatory stat and create a snowball loop. Cheap hybrids maintain tempo; expensive pure/rare words are spike turns you save toward. Revisit after playtesting.

---

## Build Order (suggested)

1. ~~Anchor sets + teacher labeling script → train scoring head~~ **DONE** — `train/` pipeline: 80k-word vocab (GloVe ∩ wordfreq ∩ dictionary), ~3.8k words labeled by local qwen3:8b teacher, distilled MLP head (val MAE ≈ 1.0/10), packed with anchor centroids into `web/public/lexicon.bin` (8.5MB). See `train/README.md`.
2. ~~Static page: input box, live 4-bar preview, health bars~~ **DONE**
3. ~~Duel loop vs. one random-policy enemy~~ **DONE** (the Necromancer)
4. ~~Fatigue + wards + mana~~ **DONE** — fatigue now runs on true embedding cosine, calibrated (synonyms ≈ 0.7-1, unrelated ≈ 0)
5. ~~Character draft screen (Self-Naming Rite)~~ **DONE** — drafted 5-of-12 + free-form flaw; synonym picks collapse via squared mutual similarity; flaw hollows its dominant stat, deepens the rest (scaled by rarity). Stats feed duel multipliers (ferocity→damage, guile→hex both ways, stone→wards, grace→heals+fatigue recovery, resonance→rare-word mana discount).
6. ~~Archetype × theme floor generator, Threshold screen, boss policy ladder, The Mirror~~ **DONE** — 7 rolled floors + Summit (domain/taboo/drain/echo/leyline × 26 themes, tiered pools, ≥1 taboo), Threshold with practice glass + Pact/Study, policy ladder random→counter→exploit→mirror, pre-wards from history concentration on floors 5+, The Mirror casts from the run history. Hierophant + Storm-Caller join the roster.
7. Pixel art pass: enemy base sprites + palette-swap system, player back-sprite, battle framing, compose/theater mobile layouts
8. ~~Juice: channel-coded spell VFX, grimoire UI, True Name generator~~ **DONE** — per-channel VFX shapes (damage streak / hex tendrils / ward rune-ring / heal motes), cast lunges, taboo screen-flash, two-frame sprite animation (dragon wing-flap alt grid, glow-pulse elsewhere), within-run grimoire overlay, True Name seeded from rite picks + flaw scar; bosses that survive 7 rounds speak it and their casts sharpen ×1.15.
