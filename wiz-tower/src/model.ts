/**
 * The distilled opponent's brain — Phase 2. A tiny MLP (10 → 64 → 28) distilled from
 * search over the REAL sim (the same recipe the POC proved on the collapsed coverage
 * vector), shipped as `weights.json` and run by a ~15-line JS forward pass. No ONNX, no
 * WASM: this is plain arithmetic on plain arrays.
 *
 * Input  (10): pooled player DPS per element (7) + anti-air, detection, control coverage.
 * Output (28): a leak proxy for each (element × MODEL_TRAITS) lead action; argmax = the
 *              wave the net thinks best exploits the board. The standardization is folded
 *              into W1/b1 at export, so the forward pass takes raw features.
 */
import { fxToFloat } from './fx.ts';
import { Element, N_ELEMENTS, typeMult } from './element.ts';
import { Trait } from './types.ts';
import type { Observation, DecisionContext } from './types.ts';
import { budgetFor, mobStats } from './config.ts';
import type { Attacker, Opener, Commit, MobGroup } from './wave.ts';
import type { Sim } from './sim.ts';

/**
 * The action space the net decodes over: 7 elements × these 4 traits = 28. We use the
 * NON-bypass threat traits (body / swarm / tank / runner) so the leak surface is driven by
 * the ELEMENTAL matchup — "read the defense, attack the type it answers weakly" — the core
 * thesis, and a continuous, learnable signal. The binary-bypass traits (Flier/Shade) leak
 * ~fully whenever the sparse anti-air/detection counter is simply absent, which swamps the
 * elemental signal and makes the argmax near-constant; the search/L2 opponent still fields
 * them, they're just not what the tiny opener-picker distills.
 */
export const MODEL_TRAITS = [Trait.Grunt, Trait.Swarm, Trait.Tank, Trait.Runner] as const;
export const N_ACTIONS = N_ELEMENTS * MODEL_TRAITS.length; // 28

export function decodeAction(a: number): { element: Element; trait: Trait } {
  return { element: Math.floor(a / MODEL_TRAITS.length) as Element, trait: MODEL_TRAITS[a % MODEL_TRAITS.length] };
}
export function encodeAction(element: Element, trait: Trait): number {
  return element * MODEL_TRAITS.length + MODEL_TRAITS.indexOf(trait as (typeof MODEL_TRAITS)[number]);
}

export const N_FEATURES = 10;

/**
 * Pool the spatial observation into the 10-dim feature vector the net reads:
 *  - EFFECTIVE coverage per element E (7): how much of the player's fire actually lands on
 *    a mob of element E, after the type chart — i.e. sum_T dps[T]·typeMult(T,E). This is the
 *    signal that decides which element the player answers weakly, handed to the net directly.
 *  - anti-air, detection, control totals (3): the capability gaps (fliers/shades/slow).
 */
export function featurize(obs: Observation): number[] {
  const dps = new Array(N_ELEMENTS).fill(0);
  let antiAir = 0, detection = 0, control = 0;
  for (let i = 0; i < obs.cells.length; i++) {
    const f = obs.cells[i];
    for (let e = 0; e < N_ELEMENTS; e++) dps[e] += fxToFloat(f.dps[e]);
    antiAir += fxToFloat(f.antiAir);
    detection += fxToFloat(f.detection);
    control += fxToFloat(f.control);
  }
  const eff = new Array(N_ELEMENTS).fill(0);
  for (let E = 0; E < N_ELEMENTS; E++) {
    let s = 0;
    for (let T = 0; T < N_ELEMENTS; T++) s += dps[T] * fxToFloat(typeMult(T as Element, E as Element));
    eff[E] = s;
  }
  return [...eff, antiAir, detection, control];
}

export interface Weights {
  W1: number[][]; // [N_FEATURES][H]
  b1: number[]; //   [H]
  W2: number[][]; // [H][N_ACTIONS]
  b2: number[]; //   [N_ACTIONS]
  meta?: Record<string, unknown>;
}

/** The shipped inference: two matmuls + ReLU. Raw features in, 28 leak proxies out. */
export function forward(w: Weights, x: number[]): number[] {
  const H = w.b1.length;
  const a1 = new Array(H);
  for (let j = 0; j < H; j++) {
    let s = w.b1[j];
    for (let i = 0; i < x.length; i++) s += x[i] * w.W1[i][j];
    a1[j] = s > 0 ? s : 0; // ReLU
  }
  const out = new Array(w.b2.length);
  for (let k = 0; k < out.length; k++) {
    let s = w.b2[k];
    for (let j = 0; j < H; j++) s += a1[j] * w.W2[j][k];
    out[k] = s;
  }
  return out;
}

export function argmax(a: number[]): number {
  let b = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i;
  return b;
}

export interface ModelOptions {
  reserveFrac?: number; // held back and (for now) spent on repeats of the lead action
}

/**
 * ModelAttacker — runs the distilled net behind the same Attacker interface as the search.
 * It reads the board, picks the lead (element × trait) action, and builds an opener around
 * it, entering at the player's thinnest column. Open-loop for now (the reserve pours more
 * of the same lead); the reactive-commit distillation is future work — the search still
 * plays L2 when you want the stronger reactive opponent.
 */
export class ModelAttacker implements Attacker {
  private readonly reserveFrac: number;
  lastAction = 0;
  /** Reserve commits fired this wave (for the recap), reset at open(). */
  committed: Commit[][] = [];

  constructor(private readonly sim: Sim, private readonly weights: Weights, opts: ModelOptions = {}) {
    this.reserveFrac = opts.reserveFrac ?? 0.35;
  }

  open(obs: Observation): { opener: Opener; pool: number } {
    this.committed = [];
    const wave = obs.wave > 0 ? obs.wave : Math.max(1, this.sim.waveNumber());
    const budget = budgetFor(wave, obs.diff);
    const pool = Math.round(budget * this.reserveFrac);
    const openerBudget = budget - pool;

    const scores = forward(this.weights, featurize(obs));
    this.lastAction = argmax(scores);
    const { element, trait } = decodeAction(this.lastAction);
    const x = this.thinnestColumn(obs);

    const group = this.fill(element, trait, openerBudget);
    const opener: Opener = group ? [{ t: 0, x, group }] : [];
    return { opener, pool };
  }

  commit(ctx: DecisionContext): Commit[] {
    if (ctx.reserveLeft <= 0) { this.committed.push([]); return []; }
    const { element, trait } = decodeAction(this.lastAction);
    const x = this.thinnestColumn(ctx.obs);
    const group = this.fill(element, trait, ctx.reserveLeft);
    const commit: Commit[] = group ? [{ kind: 'spawn', x, group }] : [];
    this.committed.push(commit);
    return commit;
  }

  private fill(element: Element, trait: Trait, budget: number): MobGroup | null {
    const cost = mobStats(trait).cost;
    const count = Math.floor(budget / cost);
    if (count < 1) return null;
    return { element, trait, count };
  }

  private thinnestColumn(obs: Observation): number {
    let best = 0, bestDps = Infinity;
    for (let x = 0; x < obs.w; x++) {
      let d = 0;
      for (let y = 0; y < obs.h; y++) {
        const f = obs.cells[y * obs.w + x];
        for (let e = 0; e < N_ELEMENTS; e++) d += f.dps[e];
      }
      if (d < bestDps) { bestDps = d; best = x; }
    }
    return best;
  }
}
