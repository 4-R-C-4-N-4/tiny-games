import type { Scorer, SpellProfile } from './types.ts';

// The duel loop: strict alternation, headless, deterministic (seeded RNG for
// enemy policy). Everything the UI shows comes out of the DuelEvent stream.

export interface OpponentDef {
  name: string;
  sprite: string;
  maxHp: number;
  words: string[];
  /** 'random' is the lower-floor tier; smarter policies come with the spire. */
  policy: 'random';
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
}

export interface DrainEvent {
  kind: 'drain';
  actor: string;
  drain: number;
}

export interface FalterEvent {
  kind: 'falter';
  actor: string;
}

export interface DefeatEvent {
  kind: 'defeat';
  loser: string;
}

export type DuelEvent = CastEvent | DrainEvent | FalterEvent | DefeatEvent;

export interface CastPreview {
  profile: SpellProfile;
  /** Fatigue × hex multiplier that would apply right now. */
  effectiveness: number;
  effectivePower: number;
  affordable: boolean;
}

const FATIGUE_WINDOW = 4;
const FATIGUE_RECENCY = [1, 0.75, 0.5, 0.25];
const FATIGUE_DEPTH = 0.7; // max power lost to a perfect-similarity repeat
const MIN_EFFECTIVENESS = 0.15;
const HEX_WEAKEN_CAP = 0.5;
const HEX_DRAIN_RATE = 0.25;
const HEX_TURNS = 3;
const MANA_REGEN = 4;

export const PLAYER_MAX_HP = 60;
export const PLAYER_MAX_MANA = 20;

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

export class Duel {
  readonly player: Combatant;
  readonly enemy: Combatant;
  winner: 'player' | 'enemy' | null = null;
  private readonly rng: () => number;

  constructor(
    private readonly scorer: Scorer,
    readonly opponent: OpponentDef,
    seed = 1,
  ) {
    this.player = makeCombatant('player', PLAYER_MAX_HP, PLAYER_MAX_MANA);
    this.enemy = makeCombatant(opponent.name, opponent.maxHp, PLAYER_MAX_MANA);
    this.rng = mulberry32(seed);
  }

  /** Fatigue factor for a prospective cast: 1 = fresh, MIN_EFFECTIVENESS = fizzle. */
  private fatigue(actor: Combatant, word: string): number {
    let worst = 0;
    actor.recent.slice(0, FATIGUE_WINDOW).forEach((prev, age) => {
      // Cubed so near-synonyms sting but merely same-channel words survive.
      const sim = this.scorer.similarity(word, prev);
      worst = Math.max(worst, sim * sim * sim * FATIGUE_RECENCY[age]);
    });
    return Math.max(MIN_EFFECTIVENESS, 1 - FATIGUE_DEPTH * worst);
  }

  private hexWeakening(actor: Combatant): number {
    if (!actor.hex) return 1;
    return 1 - Math.min(HEX_WEAKEN_CAP, actor.hex.potency / 30);
  }

  /** The scrying glass: exactly what this word would do if cast this instant. */
  preview(word: string): CastPreview | null {
    if (this.winner || !this.scorer.knows(word)) return null;
    const profile = this.scorer.score(word);
    const effectiveness = this.fatigue(this.player, word) * this.hexWeakening(this.player);
    return {
      profile,
      effectiveness,
      effectivePower: Math.round(profile.power * effectiveness),
      affordable: profile.cost <= this.player.mana,
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

  private resolveCast(attacker: Combatant, defender: Combatant, word: string): CastEvent {
    const profile = this.scorer.score(word);
    const effectiveness = this.fatigue(attacker, word) * this.hexWeakening(attacker);
    const eff = profile.power * effectiveness;

    // Full mana cost even when fatigued — fizzling wastes the turn's budget.
    attacker.mana -= profile.cost;

    const rawDamage = Math.round(eff * profile.mix.damage);
    const absorbed = Math.min(defender.ward, rawDamage);
    const damage = rawDamage - absorbed;
    defender.ward -= absorbed;
    defender.hp = Math.max(0, defender.hp - damage);

    const hexApplied = Math.round(eff * profile.mix.hex);
    if (hexApplied > 0) {
      defender.hex = {
        potency: (defender.hex?.potency ?? 0) + hexApplied,
        turns: HEX_TURNS,
      };
    }

    const healed = Math.min(
      attacker.maxHp - attacker.hp,
      Math.round(eff * profile.mix.heal),
    );
    attacker.hp += healed;
    // Heal cleanses: potency scrubbed by half the heal magnitude.
    if (attacker.hex && healed > 0) {
      attacker.hex.potency = Math.max(0, attacker.hex.potency - Math.round(healed / 2));
      if (attacker.hex.potency === 0) attacker.hex = null;
    }

    const wardGained = Math.round(eff * profile.mix.ward);
    attacker.ward += wardGained;

    attacker.recent.unshift(profile.word);
    if (attacker.recent.length > FATIGUE_WINDOW) attacker.recent.pop();

    // End-of-action regen keeps strict alternation simple: cast, then tick back.
    attacker.mana = Math.min(attacker.maxMana, attacker.mana + MANA_REGEN);

    return {
      kind: 'cast',
      actor: attacker.name,
      word: profile.word,
      effectiveness,
      cost: profile.cost,
      damage,
      absorbed,
      healed,
      wardGained,
      hexApplied,
    };
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
    if (this.scorer.score(word).cost > this.player.mana) return null;
    const events: DuelEvent[] = [];
    this.tickHex(this.player, events);
    this.checkDefeat(events);
    if (this.winner) return events;
    events.push(this.resolveCast(this.player, this.enemy, word));
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
    events.push(this.resolveCast(this.enemy, this.player, word));
    this.checkDefeat(events);
    return events;
  }

  private pickEnemyWord(): string | null {
    const affordable = this.opponent.words.filter(
      (w) => this.scorer.knows(w) && this.scorer.score(w).cost <= this.enemy.mana,
    );
    if (affordable.length === 0) return null;
    return affordable[Math.floor(this.rng() * affordable.length)];
  }
}
