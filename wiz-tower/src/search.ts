/**
 * SearchAttacker — the search-driven opponent (no neural net). It reads the board,
 * generates candidate plans biased toward the player's coverage gaps, SIMULATES each on a
 * fork of the live sim (Sim.clone), scores them by a weighted blend of Metrics, and picks
 * the best (or one of the top-K, for beatability).
 *
 * L2 (Phase 1.5): it holds back a hidden **reserve** and, at each in-wave decision point,
 * forks the LIVE mid-wave sim and searches the best commit for the state the wave has
 * actually reached — real feints (telegraph the opener, punish with the reserve) and tempo.
 * The telegraph shows only the opener; the reserve stays hidden until it fires.
 *
 * This is the same `Attacker` interface the distilled model will implement in Phase 2 — the
 * game never knows which is behind it, and the (context → commit) decisions this makes are
 * exactly the labels Phase 2 distills.
 */
import { fxToFloat, Rng } from './fx.ts';
import { Element, N_ELEMENTS, typeMult } from './element.ts';
import { Trait, type Cell } from './types.ts';
import type { Observation, DecisionContext, Metrics } from './types.ts';
import { budgetFor, groupCost, mobStats, traitUnlocked } from './config.ts';
import type { Attacker, Opener, Commit, Spawn, MobGroup, Wave } from './wave.ts';
import { PlanAttacker } from './wave.ts';
import type { Sim } from './sim.ts';
import { playWave } from './driver.ts';

export interface SearchWeights {
  leak: number; // primary: damage to the Core
  econ: number; // economy denial: suppress the player's bounty income
  tempo: number; // fire misallocation: damage sunk into mobs that leaked anyway
}

/**
 * Per-call steering for the search, set by the L3 Strategist to bend candidate generation
 * and scoring toward a cross-wave plan (favour a flank, hammer a chronic element gap,
 * escalate air/stealth, or weight economy denial while the player is teching). Null = the
 * plain L2 search. Multipliers default to 1.
 */
export interface WaveBias {
  colWeightMul?: number[]; //   per entry-column multiplier (flank steering), length w
  elemWeightMul?: number[]; //  per-element multiplier (gap targeting), length N_ELEMENTS
  traitBoost?: Partial<Record<Trait, number>>; // e.g. escalate Flier when anti-air stays absent
  weights?: SearchWeights; //   objective override for this call
}

export interface SearchOptions {
  seed?: bigint;
  candidates?: number; // how many openers to sample and simulate
  commitCandidates?: number; // how many commits to sample per decision point
  topK?: number; // pick uniformly among the K best (1 = always optimal/brutal)
  maxGroups?: number; // max spawn groups per opener
  reserveFrac?: number; // fraction of budget held back as hidden reserve (§9.1 ~0.35)
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

type BoardRead = {
  totalDps: number[]; colDps: number[]; antiAir: number; detection: number;
  effective: number[]; walls: Cell[]; w: number;
};

export class SearchAttacker implements Attacker {
  private readonly rng: Rng;
  private readonly candidates: number;
  private readonly commitCandidates: number;
  private readonly topK: number;
  private readonly maxGroups: number;
  private readonly reserveFrac: number;
  private readonly weights: SearchWeights;
  /** The last opener it chose and its score — handy for the telegraph / recap UI. */
  lastPlan: { opener: Opener; score: number } | null = null;
  /** The commits it fired at each decision point this wave (for the recap / distillation). */
  committed: Commit[][] = [];
  /** Set by the L3 Strategist before open()/commit() to steer this call; null = plain L2. */
  bias: WaveBias | null = null;
  private curWave = 1;
  private curDiff = 3;

  constructor(private readonly sim: Sim, opts: SearchOptions = {}) {
    this.rng = new Rng(opts.seed ?? 0xa11ce5eedn);
    this.candidates = opts.candidates ?? 24;
    this.commitCandidates = opts.commitCandidates ?? 12;
    this.topK = Math.max(1, opts.topK ?? 1);
    this.maxGroups = opts.maxGroups ?? 4;
    this.reserveFrac = opts.reserveFrac ?? 0.35;
    this.weights = opts.weights ?? DEFAULT_WEIGHTS;
  }

  open(obs: Observation): { opener: Opener; pool: number } {
    const wave = obs.wave > 0 ? obs.wave : Math.max(1, this.sim.waveNumber());
    const diff = obs.diff;
    this.curWave = wave; this.curDiff = diff;
    const budget = budgetFor(wave, diff);
    const pool = Math.round(budget * this.reserveFrac);
    const openerBudget = budget - pool;
    const read = this.readBoard(obs);
    this.committed = [];

    let best: Opener | null = null;
    let bestScore = -Infinity;
    const scored: { opener: Opener; score: number }[] = [];
    for (let c = 0; c < this.candidates; c++) {
      const opener = this.sampleOpener(read, openerBudget);
      const score = this.evaluateOpener(opener, pool, wave, diff);
      scored.push({ opener, score });
      if (score > bestScore) { bestScore = score; best = opener; }
    }
    scored.sort((a, b) => b.score - a.score);
    const pick = scored[this.rng.below(Math.min(this.topK, scored.length))];
    this.lastPlan = pick ?? { opener: best ?? [], score: bestScore };
    return { opener: this.lastPlan.opener, pool };
  }

  /**
   * React at a decision point: fork the LIVE mid-wave sim, try candidate commits, roll each
   * out to the wave's end, and fire the best (or one of the top-K). This is the L2 punish —
   * the hidden reserve is spent where the board has actually developed.
   */
  commit(ctx: DecisionContext): Commit[] {
    if (ctx.reserveLeft <= 0) return [];
    this.curWave = ctx.obs.wave || this.curWave; this.curDiff = ctx.obs.diff;
    const read = this.readBoard(ctx.obs);
    const cands = this.sampleCommits(read, ctx.reserveLeft);

    let bestScore = -Infinity;
    const scored: { commit: Commit[]; score: number }[] = [];
    for (const commit of cands) {
      const score = this.evaluateCommit(commit);
      scored.push({ commit, score });
      if (score > bestScore) bestScore = score;
    }
    scored.sort((a, b) => b.score - a.score);
    const pick = scored[this.rng.below(Math.min(this.topK, scored.length))] ?? { commit: [], score: 0 };
    this.committed.push(pick.commit);
    return pick.commit;
  }

  // ---- evaluation (fork + rollout) ------------------------------------------------

  /** Play `opener` (with an unused reserve pool) on a fork and score the outcome. */
  private evaluateOpener(opener: Opener, pool: number, wave: number, diff: number): number {
    const fork = this.sim.clone();
    const plan: Wave = { budget: budgetFor(wave, diff), diff, opener, reserve: { pool, points: [] } };
    // A no-op attacker for the rollout: executes the opener, commits nothing (the reserve's
    // value is searched live at commit() time, not here — this ranks openers on their own).
    const m = playWave(fork, new PlanAttacker(plan), wave, diff);
    return this.score(m);
  }

  /** Apply `commit` to a fork of the live mid-wave sim, roll to the wave end, score it. */
  private evaluateCommit(commit: Commit[]): number {
    const fork = this.sim.clone();
    fork.commit(commit);
    for (;;) {
      const out = fork.step();
      if (out.kind === 'continue') continue;
      if (out.kind === 'decision') { fork.commit([]); continue; } // greedy: no further reserve in rollout
      break; // waveComplete | gameOver
    }
    return this.score(fork.metricsSnapshot());
  }

  private score(m: Metrics): number {
    const w = this.bias?.weights ?? this.weights;
    return (
      w.leak * fxToFloat(m.leakedHp) +
      w.econ * -m.currencyDelta +
      w.tempo * fxToFloat(m.fireMisalloc)
    );
  }

  // ---- board reading --------------------------------------------------------------

  private readBoard(obs: Observation): BoardRead {
    const totalDps = new Array(N_ELEMENTS).fill(0);
    const colDps = new Array(obs.w).fill(0);
    const walls: Cell[] = [];
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
        if (f.wallHp > 0) walls.push({ x, y });
      }
    }
    const effective = new Array(N_ELEMENTS).fill(0);
    for (let E = 0; E < N_ELEMENTS; E++) {
      let sum = 0;
      for (let T = 0; T < N_ELEMENTS; T++) sum += totalDps[T] * fxToFloat(typeMult(T, E));
      effective[E] = sum;
    }
    return { totalDps, colDps, antiAir, detection, effective, walls, w: obs.w };
  }

  // ---- candidate sampling ---------------------------------------------------------

  private sampleOpener(read: BoardRead, budget: number): Opener {
    const opener: Spawn[] = [];
    let remaining = budget;
    const nGroups = 1 + this.rng.below(this.maxGroups);
    for (let g = 0; g < nGroups; g++) {
      const picked = this.sampleGroup(read, remaining);
      if (!picked) continue;
      remaining -= groupCost(picked.group.trait, picked.group.count);
      const t = this.tenths(g * 6 + this.rng.below(6)); // 0.0, ~0.6, ~1.2, … seconds
      opener.push({ t, x: picked.x, group: picked.group });
    }
    if (opener.length === 0) {
      opener.push({ t: 0, x: this.lowCoverageColumn(read), group: { element: Element.Fire, trait: Trait.Grunt, count: 1 } });
    }
    return opener;
  }

  /** Candidate commits for a decision point: skip, a few spawn commits, and — if the player
   *  built walls — a breach that aims Breakers at a real gate (the reactive spatial feint). */
  private sampleCommits(read: BoardRead, budget: number): Commit[][] {
    const out: Commit[][] = [[]]; // holding the reserve is always an option
    for (let i = 0; i < this.commitCandidates; i++) {
      const commit: Commit[] = [];
      let remaining = budget;
      const n = 1 + this.rng.below(2); // 1–2 groups per commit
      for (let g = 0; g < n; g++) {
        const picked = this.sampleGroup(read, remaining);
        if (!picked) continue;
        remaining -= groupCost(picked.group.trait, picked.group.count);
        commit.push({ kind: 'spawn', x: picked.x, group: picked.group });
      }
      if (commit.length) out.push(commit);
    }
    // Breach candidates: pour Breakers at a wall the player relies on.
    if (read.walls.length) {
      for (let i = 0; i < 2; i++) {
        const gate = read.walls[this.rng.below(read.walls.length)];
        const cost1 = mobStats(Trait.Breaker).cost;
        const maxCount = Math.min(TRAIT_MAX_COUNT[Trait.Breaker], Math.floor(budget / cost1));
        if (maxCount < 1) break;
        const count = 1 + this.rng.below(maxCount);
        const element = this.sampleWeighted(this.elemWeights(read));
        out.push([{ kind: 'breach', x: gate.x, group: { element, trait: Trait.Breaker, count }, gate }]);
      }
    }
    return out;
  }

  /** Sample one group (element × trait × count × column) that fits `budget`, or null. */
  private sampleGroup(read: BoardRead, budget: number): { x: number; group: MobGroup } | null {
    const airGap = read.antiAir < 1;
    const detGap = read.detection < 1;
    const trait = this.sampleTrait(airGap, detGap);
    const cost1 = mobStats(trait).cost;
    if (cost1 > budget) return null;
    const element = this.sampleWeighted(this.elemWeights(read));
    const x = this.sampleWeighted(this.colWeights(read));
    const cap = Math.min(TRAIT_MAX_COUNT[trait], Math.floor(budget / cost1));
    if (cap < 1) return null;
    const count = 1 + this.rng.below(cap);
    return { x, group: { element, trait, count } };
  }

  /** Prefer elements the player answers weakly, × the Strategist's per-element bias. */
  private elemWeights(read: BoardRead): number[] {
    return read.effective.map((d, i) => (1 / (d + 1)) * (this.bias?.elemWeightMul?.[i] ?? 1));
  }
  /** Prefer thin columns, × the Strategist's per-column (flank) bias. */
  private colWeights(read: BoardRead): number[] {
    return read.colDps.map((d, i) => (1 / (d + 1)) * (this.bias?.colWeightMul?.[i] ?? 1));
  }

  private sampleTrait(airGap: boolean, detGap: boolean): Trait {
    const boost = this.bias?.traitBoost;
    const w = ALL_TRAITS.map((t) => {
      if (!traitUnlocked(t, this.curWave, this.curDiff)) return 0; // roster escalates by wave
      let base = 1;
      if (t === Trait.Flier) base = airGap ? 4 : 1;
      else if (t === Trait.Shade) base = detGap ? 4 : 1;
      else if (t === Trait.Mender || t === Trait.Breaker) base = 0.5; // situational
      return base * (boost?.[t] ?? 1);
    });
    return ALL_TRAITS[this.sampleWeighted(w)];
  }

  private lowCoverageColumn(read: BoardRead): number {
    return this.sampleWeighted(this.colWeights(read));
  }

  /** Deterministic weighted index using the attacker RNG. */
  private sampleWeighted(weights: number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return this.rng.below(weights.length);
    let r = (this.rng.below(1_000_000) / 1_000_000) * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** Fx seconds for a tenths-of-a-second value (keeps timings on clean boundaries). */
  private tenths(tenthsOfSecond: number): number {
    return Math.round((tenthsOfSecond / 10) * 1024);
  }
}
