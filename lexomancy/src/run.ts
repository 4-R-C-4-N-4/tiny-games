import { draftOffer } from './adjectives.ts';
import { Duel, PLAYER_MAX_HP, PLAYER_MAX_MANA, type DuelEvent, type HexState, type Policy } from './duel.ts';
import { generateSpire, type FloorSpec } from './floors.ts';
import { NEUTRAL_STATS, performRite, type RiteResult, type Stats } from './stats.ts';
import { makeTrueName } from './truename.ts';
import { makeMirror, ROSTER } from './opponents.ts';
import type { OpponentDef } from './duel.ts';
import type { Scorer } from './types.ts';

// One run up the spire: rite → (threshold → duel) × 7 → the Mirror.
// Headless and seeded, like everything else; the UI is a thin shell.

export type RunPhase = 'rite' | 'threshold' | 'duel' | 'fallen' | 'ascended';

/** Floor tier → boss policy intelligence (the difficulty ladder). */
function policyForFloor(index: number): Policy {
  if (index >= 8) return 'mirror';
  if (index >= 6) return 'exploit';
  if (index >= 3) return 'counter';
  return 'random';
}

const FLOOR_CLEAR_HEAL = 12;
const PACT_MANA_BONUS = 4;
const PACT_HEX: HexState = { potency: 7, turns: 3 };
const STUDY_HP_PRICE = 5;
const PREWARD_FROM_FLOOR = 5;
const PREWARD_SCALE = 20;
const HISTORY_STUDIED = 10;

export interface StudyReport {
  bossName: string;
  wordHint: string;
  policyHint: string;
}

const POLICY_HINTS: Record<Policy, string> = {
  random: 'It casts on instinct, without design.',
  counter: 'It reads your last word and answers it orthogonally.',
  exploit: 'It hunts your fatigue and slips hexes past your wards.',
  mirror: 'It knows every word you have spoken here.',
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SpireRun {
  readonly floors: FloorSpec[];
  phase: RunPhase = 'rite';
  stats: Stats = NEUTRAL_STATS;
  rite: RiteResult | null = null;
  trueName: string | null = null;
  duel: Duel | null = null;
  /** Every word the player has cast this run — the spire's fingerprint of you. */
  readonly history: string[] = [];
  floorIndex = 0; // 0-based into floors[]
  playerMaxHp = PLAYER_MAX_HP;
  playerHp = PLAYER_MAX_HP;
  playerMaxMana = PLAYER_MAX_MANA;
  pactArmed = false;
  studyReport: StudyReport | null = null;
  private readonly rng: () => number;
  private readonly riteOffer: string[];

  constructor(
    private readonly scorer: Scorer,
    readonly seed = 1,
  ) {
    this.rng = mulberry32(seed);
    this.floors = generateSpire(this.rng);
    this.riteOffer = draftOffer(this.rng);
  }

  /** The 12 adjectives offered at the Self-Naming Rite. */
  offer(): string[] {
    return this.riteOffer;
  }

  completeRite(picks: string[], flaw?: string): RiteResult {
    if (this.phase !== 'rite') throw new Error('rite already performed');
    this.rite = performRite(this.scorer, picks, flaw);
    this.stats = this.rite.stats;
    this.trueName = makeTrueName(picks, this.stats, flaw);
    this.phase = 'threshold';
    return this.rite;
  }

  currentFloor(): FloorSpec {
    return this.floors[this.floorIndex];
  }

  /** Clamped variant for end-of-run rendering (never undefined). */
  currentFloorSafe(): FloorSpec | null {
    if (this.phase === 'rite') return null;
    return this.floors[Math.min(this.floorIndex, this.floors.length - 1)] ?? null;
  }

  currentBossSafe(): OpponentDef | null {
    if (this.phase === 'rite' || this.phase === 'ascended') return null;
    return this.currentBoss();
  }

  currentBoss(): OpponentDef {
    const floor = this.currentFloor();
    if (floor.archetype === 'mirror') return makeMirror(this.history);
    // Seeded but stable per floor: index into the roster.
    const base = ROSTER[(this.seed + floor.index) % ROSTER.length];
    return {
      ...base,
      maxHp: base.maxHp + 3 * (floor.index - 1),
      policy: policyForFloor(floor.index),
    };
  }

  /** Threshold choice: a self-hex on entry in exchange for deeper mana, permanently. */
  takePact(): void {
    if (this.phase !== 'threshold' || this.pactArmed) return;
    this.pactArmed = true;
    this.playerMaxMana += PACT_MANA_BONUS;
  }

  /** Threshold choice: pay flesh to read the boss before the fight. */
  takeStudy(): StudyReport | null {
    if (this.phase !== 'threshold' || this.studyReport) return this.studyReport;
    this.playerMaxHp = Math.max(10, this.playerMaxHp - STUDY_HP_PRICE);
    this.playerHp = Math.min(this.playerHp, this.playerMaxHp);
    const boss = this.currentBoss();
    this.studyReport = {
      bossName: boss.name,
      wordHint: `Its lexicon: ${boss.words.slice(0, 5).join(', ')}…`,
      policyHint: POLICY_HINTS[boss.policy],
    };
    return this.studyReport;
  }

  /** How repetitive the run's recent vocabulary is, 0..1 — powers pre-wards. */
  historyConcentration(): number {
    const recent = this.history.slice(-HISTORY_STUDIED);
    if (recent.length < 2) return 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < recent.length; i++) {
      for (let j = i + 1; j < recent.length; j++) {
        sum += this.scorer.similarity(recent[i], recent[j]);
        n++;
      }
    }
    return sum / n;
  }

  enterFloor(): Duel {
    if (this.phase !== 'threshold') throw new Error(`cannot enter floor from ${this.phase}`);
    const floor = this.currentFloor();
    const preWard =
      floor.index >= PREWARD_FROM_FLOOR
        ? Math.round(PREWARD_SCALE * this.historyConcentration())
        : 0;
    this.duel = new Duel(this.scorer, this.currentBoss(), (this.seed * 31 + floor.index) | 0, {
      stats: this.stats,
      floor,
      playerHp: this.playerHp,
      playerMaxHp: this.playerMaxHp,
      playerMaxMana: this.playerMaxMana,
      enemyWard: preWard,
      playerHex: this.pactArmed ? { ...PACT_HEX } : undefined,
    });
    this.pactArmed = false;
    this.phase = 'duel';
    return this.duel;
  }

  castPlayer(word: string): DuelEvent[] | null {
    if (this.phase !== 'duel' || !this.duel) return null;
    const events = this.duel.castPlayer(word);
    if (events) {
      this.history.push(word.trim().toLowerCase());
      this.afterAction();
    }
    return events;
  }

  enemyTurn(): DuelEvent[] {
    if (this.phase !== 'duel' || !this.duel) return [];
    const events = this.duel.enemyTurn();
    this.afterAction();
    return events;
  }

  private afterAction(): void {
    const duel = this.duel;
    if (!duel?.winner) return;
    if (duel.winner === 'enemy') {
      this.phase = 'fallen';
      return;
    }
    // Floor cleared: carry HP forward with a breather, refill mana.
    this.playerHp = Math.min(this.playerMaxHp, duel.player.hp + FLOOR_CLEAR_HEAL);
    this.studyReport = null;
    this.floorIndex += 1;
    this.phase = this.floorIndex >= this.floors.length ? 'ascended' : 'threshold';
  }
}
