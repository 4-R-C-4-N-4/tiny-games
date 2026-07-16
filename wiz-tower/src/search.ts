/**
 * SearchAttacker — the Phase 1 (L1) opponent: no neural net, no reactive reserve. It
 * reads the board, generates candidate openers biased toward the player's coverage gaps,
 * SIMULATES each on a fork of the live sim (Sim.clone), scores them by a weighted blend of
 * Metrics, and commits the best (or one of the top-K, for beatability/variety).
 *
 * This is the same `Attacker` interface the distilled model will implement in Phase 2 —
 * the game never knows which is behind it. Phase 1.5 will let this branch at decision
 * points (reserve); for now the reserve pool is 0 and commit() is a no-op.
 */
import { fxToFloat, Rng } from './fx.ts';
import { Element, N_ELEMENTS, typeMult } from './element.ts';
import { Trait } from './types.ts';
import type { Observation, DecisionContext, Metrics } from './types.ts';
import { budgetFor, groupCost, mobStats } from './config.ts';
import type { Attacker, Opener, Commit, Spawn, Wave } from './wave.ts';
import { PlanAttacker } from './wave.ts';
import type { Sim } from './sim.ts';
import { playWave } from './driver.ts';

export interface SearchWeights {
  leak: number; // primary: damage to the Core
  econ: number; // economy denial: suppress the player's bounty income
  tempo: number; // fire misallocation: damage sunk into mobs that leaked anyway
}

export interface SearchOptions {
  seed?: bigint;
  candidates?: number; // how many openers to sample and simulate
  topK?: number; // pick uniformly among the K best (1 = always optimal/brutal)
  maxGroups?: number; // max spawn groups per opener
  weights?: SearchWeights;
}

const DEFAULT_WEIGHTS: SearchWeights = { leak: 1, econ: 0.3, tempo: 0.05 };

const ALL_TRAITS = [
  Trait.Grunt, Trait.Swarm, Trait.Tank, Trait.Runner,
  Trait.Flier, Trait.Shade, Trait.Shielded, Trait.Mender, Trait.Breaker,
] as const;

/** Soft per-trait cap on group size, so budgets aren't blown on one absurd stack. */
const TRAIT_MAX_COUNT: Record<Trait, number> = {
  [Trait.Grunt]: 8, [Trait.Swarm]: 12, [Trait.Tank]: 3, [Trait.Runner]: 8,
  [Trait.Flier]: 6, [Trait.Shade]: 5, [Trait.Shielded]: 5, [Trait.Mender]: 3, [Trait.Breaker]: 4,
};

export class SearchAttacker implements Attacker {
  private readonly rng: Rng;
  private readonly candidates: number;
  private readonly topK: number;
  private readonly maxGroups: number;
  private readonly weights: SearchWeights;
  /** The last opener it chose and its score — handy for the telegraph / recap UI. */
  lastPlan: { opener: Opener; score: number } | null = null;

  constructor(private readonly sim: Sim, opts: SearchOptions = {}) {
    this.rng = new Rng(opts.seed ?? 0xa11ce5eedn);
    this.candidates = opts.candidates ?? 24;
    this.topK = Math.max(1, opts.topK ?? 1);
    this.maxGroups = opts.maxGroups ?? 4;
    this.weights = opts.weights ?? DEFAULT_WEIGHTS;
  }

  open(obs: Observation): { opener: Opener; pool: number } {
    const wave = obs.wave > 0 ? obs.wave : Math.max(1, this.sim.waveNumber());
    const budget = budgetFor(wave);
    const diff = obs.diff;
    const read = this.readBoard(obs);

    let best: Opener | null = null;
    let bestScore = -Infinity;
    const scored: { opener: Opener; score: number }[] = [];
    for (let c = 0; c < this.candidates; c++) {
      const opener = this.sampleOpener(read, budget);
      const score = this.evaluate(opener, wave, diff);
      scored.push({ opener, score });
      if (score > bestScore) { bestScore = score; best = opener; }
    }
    // Pick uniformly among the top-K (topK=1 → always the best).
    scored.sort((a, b) => b.score - a.score);
    const pick = scored[this.rng.below(Math.min(this.topK, scored.length))];
    this.lastPlan = pick ?? { opener: best ?? [], score: bestScore };
    return { opener: this.lastPlan.opener, pool: 0 };
  }

  // L1 open-loop: no reactive reserve. Phase 1.5 fills this in.
  commit(_ctx: DecisionContext): Commit[] {
    return [];
  }

  /** Play `opener` on a fork of the live board and return the weighted objective. */
  private evaluate(opener: Opener, wave: number, diff: number): number {
    const fork = this.sim.clone();
    const plan: Wave = { budget: budgetFor(wave), diff, opener, reserve: { pool: 0, points: [] } };
    const m = playWave(fork, new PlanAttacker(plan), wave, diff);
    return this.score(m);
  }

  private score(m: Metrics): number {
    return (
      this.weights.leak * fxToFloat(m.leakedHp) +
      this.weights.econ * -m.currencyDelta +
      this.weights.tempo * fxToFloat(m.fireMisalloc)
    );
  }

  // ---- board reading + candidate sampling ----------------------------------------

  private readBoard(obs: Observation) {
    const totalDps = new Array(N_ELEMENTS).fill(0);
    const colDps = new Array(obs.w).fill(0);
    let antiAir = 0, detection = 0;
    for (let y = 0; y < obs.h; y++) {
      for (let x = 0; x < obs.w; x++) {
        const f = obs.cells[y * obs.w + x];
        for (let e = 0; e < N_ELEMENTS; e++) {
          totalDps[e] += fxToFloat(f.dps[e]);
          colDps[x] += fxToFloat(f.dps[e]);
        }
        antiAir += fxToFloat(f.antiAir);
        detection += fxToFloat(f.detection);
      }
    }
    // effectiveDps(E): how much of the player's fire actually lands on a mob of element E,
    // after the type chart. The attacker prefers elements the player answers weakly.
    const effective = new Array(N_ELEMENTS).fill(0);
    for (let E = 0; E < N_ELEMENTS; E++) {
      let sum = 0;
      for (let T = 0; T < N_ELEMENTS; T++) sum += totalDps[T] * fxToFloat(typeMult(T, E));
      effective[E] = sum;
    }
    return { totalDps, colDps, antiAir, detection, effective, w: obs.w };
  }

  private sampleOpener(read: ReturnType<SearchAttacker['readBoard']>, budget: number): Opener {
    const opener: Spawn[] = [];
    let remaining = budget;
    const nGroups = 1 + this.rng.below(this.maxGroups);
    // Bias elements toward low effective-DPS; columns toward low coverage.
    const elemWeights = read.effective.map((d) => 1 / (d + 1));
    const colWeights = read.colDps.map((d) => 1 / (d + 1));
    // Trait bias: exploit missing capabilities.
    const airGap = read.antiAir < 1;
    const detGap = read.detection < 1;

    for (let g = 0; g < nGroups; g++) {
      const trait = this.sampleTrait(airGap, detGap);
      const cost1 = mobStats(trait).cost;
      if (cost1 > remaining) continue;
      const element = this.sampleWeighted(elemWeights);
      const x = this.sampleWeighted(colWeights);
      const maxByBudget = Math.floor(remaining / cost1);
      const cap = Math.min(TRAIT_MAX_COUNT[trait], maxByBudget);
      if (cap < 1) continue;
      const count = 1 + this.rng.below(cap);
      remaining -= groupCost(trait, count);
      // Stagger entries across the early wave window (telegraphed opener).
      const t = this.tenths(g * 6 + this.rng.below(6)); // 0.0, ~0.6, ~1.2, … seconds
      opener.push({ t, x, group: { element, trait, count } });
    }
    // Guarantee a non-empty opener even if sampling whiffed on budget.
    if (opener.length === 0) {
      opener.push({ t: 0, x: this.sampleWeighted(colWeights), group: { element: Element.Fire, trait: Trait.Grunt, count: 1 } });
    }
    return opener;
  }

  private sampleTrait(airGap: boolean, detGap: boolean): Trait {
    const w = ALL_TRAITS.map((t) => {
      if (t === Trait.Flier) return airGap ? 4 : 1;
      if (t === Trait.Shade) return detGap ? 4 : 1;
      if (t === Trait.Mender || t === Trait.Breaker) return 0.5; // situational
      return 1;
    });
    return ALL_TRAITS[this.sampleWeighted(w)];
  }

  /** Deterministic weighted index using the attacker RNG. */
  private sampleWeighted(weights: number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return this.rng.below(weights.length);
    // 1e6 buckets of resolution — plenty, and integer-deterministic.
    let r = (this.rng.below(1_000_000) / 1_000_000) * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** Fx seconds for a tenths-of-a-second value (keeps timings on clean boundaries). */
  private tenths(tenthsOfSecond: number): number {
    // fxToFloat inverse of tenths: value/10 seconds → Fx. Use the same Q22.10 scale.
    return Math.round((tenthsOfSecond / 10) * 1024);
  }
}
