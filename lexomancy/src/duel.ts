import { evaluateWord, fatigueRecency, type FloorSpec, type FloorWordEffect } from './floors.ts';
import type { SpriteArt } from './sprites.ts';
import { NEUTRAL_STATS, type Stats } from './stats.ts';
import type { Scorer, SpellProfile } from './types.ts';

// The duel loop: strict alternation, headless, deterministic (seeded RNG for
// enemy policy). Everything the UI shows comes out of the DuelEvent stream.

export type Policy = 'random' | 'counter' | 'exploit' | 'mirror';

export interface OpponentDef {
  name: string;
  sprite: string;
  art: SpriteArt;
  maxHp: number;
  words: string[];
  /** The difficulty ladder is policy intelligence, not stat inflation. */
  policy: Policy;
}

export interface HexState {
  potency: number;
  turns: number;
}

export interface Combatant {
  name: string;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  /** Absorb pool: soaks incoming damage-channel harm before HP. */
  ward: number;
  hex: HexState | null;
  /** Recent casts, newest first — the fatigue window. */
  recent: string[];
}

export interface CastEvent {
  kind: 'cast';
  actor: string;
  word: string;
  /** Effectiveness multiplier actually applied (fatigue × hex weakening). */
  effectiveness: number;
  cost: number;
  damage: number;
  absorbed: number;
  healed: number;
  wardGained: number;
  hexApplied: number;
  /** Offense redirected onto the caster by a taboo floor. */
  tabooed: boolean;
}

export interface DrainEvent {
  kind: 'drain';
  actor: string;
  drain: number;
}

export interface EchoEvent {
  kind: 'echo';
  actor: string;
  damage: number;
}

export interface FalterEvent {
  kind: 'falter';
  actor: string;
}

export interface DefeatEvent {
  kind: 'defeat';
  loser: string;
}

export type DuelEvent = CastEvent | DrainEvent | EchoEvent | FalterEvent | DefeatEvent;

export interface CastPreview {
  profile: SpellProfile;
  /** Fatigue × hex multiplier that would apply right now. */
  effectiveness: number;
  effectivePower: number;
  affordable: boolean;
  /** What this floor does to the word — the scrying glass never lies. */
  floor: FloorWordEffect;
  /** Mana cost after resonance discount. */
  cost: number;
}

const FATIGUE_WINDOW = 4;
const FATIGUE_DEPTH = 0.7; // max power lost to a perfect-similarity repeat
const MIN_EFFECTIVENESS = 0.15;
const HEX_WEAKEN_CAP = 0.5;
const HEX_DRAIN_RATE = 0.25;
const HEX_TURNS = 3;
const MANA_REGEN = 4;
const ECHO_FACTOR = 0.5;

export const PLAYER_MAX_HP = 60;
export const PLAYER_MAX_MANA = 20;

export interface DuelOptions {
  stats?: Stats;
  floor?: FloorSpec;
  playerHp?: number;
  playerMaxHp?: number;
  playerMana?: number;
  playerMaxMana?: number;
  /** "The spire studies you": upper bosses open pre-warded. */
  enemyWard?: number;
  /** Pact self-hex carried into the floor. */
  playerHex?: HexState;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCombatant(name: string, maxHp: number, maxMana: number): Combatant {
  return { name, hp: maxHp, maxHp, mana: maxMana, maxMana, ward: 0, hex: null, recent: [] };
}

/** Counter policy: answer the player's dominant channel orthogonally. */
const COUNTER: Record<string, string> = {
  damage: 'ward', // they hit — wall up
  hex: 'heal', //    they curse — cleanse
  ward: 'hex', //    they turtle — hex slips through wards
  heal: 'damage', // they stall — pressure
};

export class Duel {
  readonly player: Combatant;
  readonly enemy: Combatant;
  readonly stats: Stats;
  readonly floor: FloorSpec | null;
  winner: 'player' | 'enemy' | null = null;
  private readonly rng: () => number;
  private readonly recency: number[];

  constructor(
    private readonly scorer: Scorer,
    readonly opponent: OpponentDef,
    seed = 1,
    opts: DuelOptions = {},
  ) {
    const maxHp = opts.playerMaxHp ?? PLAYER_MAX_HP;
    const maxMana = opts.playerMaxMana ?? PLAYER_MAX_MANA;
    this.player = makeCombatant('player', maxHp, maxMana);
    this.player.hp = Math.min(maxHp, opts.playerHp ?? maxHp);
    this.player.mana = Math.min(maxMana, opts.playerMana ?? maxMana);
    if (opts.playerHex) this.player.hex = { ...opts.playerHex };
    this.enemy = makeCombatant(opponent.name, opponent.maxHp, PLAYER_MAX_MANA);
    this.enemy.ward = opts.enemyWard ?? 0;
    this.stats = opts.stats ?? NEUTRAL_STATS;
    this.floor = opts.floor ?? null;
    this.rng = mulberry32(seed);
    this.recency = fatigueRecency(this.floor);
  }

  /** Stat multiplier helper: 1.0 at the neutral 0.5, ±25% at the extremes. */
  private statMul(value: number): number {
    return 0.75 + 0.5 * value;
  }

  private fatigue(actor: Combatant, word: string): number {
    let worst = 0;
    actor.recent.slice(0, FATIGUE_WINDOW).forEach((prev, age) => {
      // Squared so near-synonyms sting while loosely-related words survive.
      // (similarity() is already calibrated: synonyms ≈ 0.7-1, unrelated ≈ 0.)
      const sim = this.scorer.similarity(word, prev);
      worst = Math.max(worst, sim * sim * this.recency[age]);
    });
    // Grace hastens fatigue recovery (player only).
    const depth =
      actor === this.player ? FATIGUE_DEPTH * (1 - 0.4 * (this.stats.grace - 0.5)) : FATIGUE_DEPTH;
    return Math.max(MIN_EFFECTIVENESS, 1 - depth * worst);
  }

  private hexWeakening(actor: Combatant): number {
    if (!actor.hex) return 1;
    return 1 - Math.min(HEX_WEAKEN_CAP, actor.hex.potency / 30);
  }

  /** Resonance makes rare words cheaper (player only). */
  private manaCost(actor: Combatant, profile: SpellProfile): number {
    if (actor !== this.player) return profile.cost;
    const discount = 1 - 0.3 * this.stats.resonance * profile.rarity;
    return Math.max(1, Math.round(profile.cost * discount));
  }

  /** The scrying glass: exactly what this word would do if cast this instant. */
  preview(word: string): CastPreview | null {
    if (this.winner || !this.scorer.knows(word)) return null;
    const profile = this.scorer.score(word);
    const effectiveness = this.fatigue(this.player, word) * this.hexWeakening(this.player);
    const floor = evaluateWord(this.scorer, this.floor, word);
    const cost = this.manaCost(this.player, profile);
    return {
      profile,
      effectiveness,
      effectivePower: Math.round(profile.power * effectiveness * floor.amp),
      affordable: cost <= this.player.mana,
      floor,
      cost,
    };
  }

  private tickHex(actor: Combatant, events: DuelEvent[]): void {
    if (!actor.hex) return;
    const drain = Math.round(actor.hex.potency * HEX_DRAIN_RATE);
    if (drain > 0) {
      actor.hp = Math.max(0, actor.hp - drain);
      events.push({ kind: 'drain', actor: actor.name, drain });
    }
    actor.hex.turns -= 1;
    if (actor.hex.turns <= 0) actor.hex = null;
  }

  private resolveCast(
    attacker: Combatant,
    defender: Combatant,
    word: string,
    events: DuelEvent[],
  ): CastEvent {
    const profile = this.scorer.score(word);
    const isPlayer = attacker === this.player;
    const floor = evaluateWord(this.scorer, this.floor, word);
    const effectiveness = this.fatigue(attacker, word) * this.hexWeakening(attacker);
    const eff = profile.power * effectiveness * floor.amp;
    const chAmp = (c: 'damage' | 'hex' | 'ward' | 'heal') => floor.channelAmp[c] ?? 1;

    attacker.mana -= this.manaCost(attacker, profile);

    // Taboo floors: offense turns on the caster; utility is halved.
    const offenseTarget = floor.tabooed ? attacker : defender;
    const utilityScale = floor.tabooed ? 0.5 : 1;

    const dmgMul = isPlayer ? this.statMul(this.stats.ferocity) : 1;
    const rawDamage = Math.round(eff * profile.mix.damage * chAmp('damage') * dmgMul);
    const absorbed = Math.min(offenseTarget.ward, rawDamage);
    const damage = rawDamage - absorbed;
    offenseTarget.ward -= absorbed;
    offenseTarget.hp = Math.max(0, offenseTarget.hp - damage);

    const hexMul = isPlayer ? this.statMul(this.stats.guile) : 1;
    // Guile also resists incoming hexes.
    const hexResist =
      offenseTarget === this.player ? 1.25 - 0.5 * this.stats.guile : 1;
    const hexApplied = Math.round(eff * profile.mix.hex * chAmp('hex') * hexMul * hexResist);
    if (hexApplied > 0) {
      offenseTarget.hex = {
        potency: (offenseTarget.hex?.potency ?? 0) + hexApplied,
        turns: HEX_TURNS,
      };
    }

    const healMul = isPlayer ? this.statMul(this.stats.grace) : 1;
    const healed = Math.min(
      attacker.maxHp - attacker.hp,
      Math.round(eff * profile.mix.heal * chAmp('heal') * healMul * utilityScale),
    );
    attacker.hp += healed;
    // Heal cleanses: potency scrubbed by half the heal magnitude.
    if (attacker.hex && healed > 0) {
      attacker.hex.potency = Math.max(0, attacker.hex.potency - Math.round(healed / 2));
      if (attacker.hex.potency === 0) attacker.hex = null;
    }

    const wardMul = isPlayer ? this.statMul(this.stats.stone) : 1;
    const wardGained = Math.round(eff * profile.mix.ward * chAmp('ward') * wardMul * utilityScale);
    attacker.ward += wardGained;

    attacker.recent.unshift(profile.word);
    if (attacker.recent.length > FATIGUE_WINDOW) attacker.recent.pop();

    // End-of-action regen keeps strict alternation simple: cast, then tick back.
    attacker.mana = Math.min(attacker.maxMana, attacker.mana + MANA_REGEN);

    const event: CastEvent = {
      kind: 'cast',
      actor: attacker.name,
      word: profile.word,
      effectiveness,
      cost: this.manaCost(attacker, profile),
      damage,
      absorbed,
      healed,
      wardGained,
      hexApplied,
      tabooed: floor.tabooed,
    };
    events.push(event);

    // Echo floors: your own cast returns at half force (skip taboo backfires —
    // the word already struck its speaker once).
    if (this.floor?.archetype === 'echo' && !floor.tabooed && damage > 0) {
      const echo = Math.round(damage * ECHO_FACTOR);
      if (echo > 0) {
        attacker.hp = Math.max(0, attacker.hp - echo);
        events.push({ kind: 'echo', actor: attacker.name, damage: echo });
      }
    }
    return event;
  }

  private checkDefeat(events: DuelEvent[]): void {
    if (this.winner) return;
    if (this.enemy.hp === 0) {
      this.winner = 'player';
      events.push({ kind: 'defeat', loser: this.enemy.name });
    } else if (this.player.hp === 0) {
      this.winner = 'enemy';
      events.push({ kind: 'defeat', loser: 'player' });
    }
  }

  /** Player's half of the round. Returns null if the cast is illegal right now. */
  castPlayer(word: string): DuelEvent[] | null {
    if (this.winner || !this.scorer.knows(word)) return null;
    if (this.manaCost(this.player, this.scorer.score(word)) > this.player.mana) return null;
    const events: DuelEvent[] = [];
    this.tickHex(this.player, events);
    this.checkDefeat(events);
    if (this.winner) return events;
    this.resolveCast(this.player, this.enemy, word, events);
    this.checkDefeat(events);
    return events;
  }

  /** Enemy's half of the round, driven by its policy. */
  enemyTurn(): DuelEvent[] {
    if (this.winner) return [];
    const events: DuelEvent[] = [];
    this.tickHex(this.enemy, events);
    this.checkDefeat(events);
    if (this.winner) return events;

    const word = this.pickEnemyWord();
    if (!word) {
      // Nothing affordable: gather mana instead.
      this.enemy.mana = Math.min(this.enemy.maxMana, this.enemy.mana + MANA_REGEN * 2);
      events.push({ kind: 'falter', actor: this.enemy.name });
      return events;
    }
    this.resolveCast(this.enemy, this.player, word, events);
    this.checkDefeat(events);
    return events;
  }

  private affordableWords(): string[] {
    return this.opponent.words.filter(
      (w) => this.scorer.knows(w) && this.scorer.score(w).cost <= this.enemy.mana,
    );
  }

  private pickEnemyWord(): string | null {
    const affordable = this.affordableWords();
    if (affordable.length === 0) return null;
    switch (this.opponent.policy) {
      case 'random':
        return affordable[Math.floor(this.rng() * affordable.length)];
      case 'counter':
        return this.pickCounter(affordable);
      case 'exploit':
      case 'mirror':
        return this.pickExploit(affordable);
    }
  }

  /** Mid-floor tier: answer the player's last dominant channel orthogonally. */
  private pickCounter(affordable: string[]): string {
    const last = this.player.recent[0];
    const want = last ? COUNTER[this.scorer.score(last).dominant] : 'damage';
    const matching = affordable.filter((w) => this.scorer.score(w).dominant === want);
    const pool = matching.length > 0 ? matching : affordable;
    return this.bestByPower(pool);
  }

  /**
   * Upper-floor tier (and the Mirror): avoid own fatigue, hex through wards,
   * otherwise spike with the strongest fresh word. Never trips its own taboo.
   */
  private pickExploit(affordable: string[]): string {
    let pool = affordable.filter(
      (w) => !evaluateWord(this.scorer, this.floor, w).tabooed,
    );
    if (pool.length === 0) pool = affordable;
    const fresh = pool.filter((w) => this.fatigue(this.enemy, w) > 0.75);
    if (fresh.length > 0) pool = fresh;
    if (this.player.ward > 6) {
      const hexes = pool.filter((w) => this.scorer.score(w).dominant === 'hex');
      if (hexes.length > 0) return this.bestByPower(hexes);
    }
    return this.bestByPower(pool);
  }

  private bestByPower(pool: string[]): string {
    let best = pool[0];
    let bestScore = -1;
    for (const w of pool) {
      const s = this.scorer.score(w).power * this.fatigue(this.enemy, w);
      if (s > bestScore) {
        bestScore = s;
        best = w;
      }
    }
    return best;
  }
}
