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
import { budgetFor, mobStats, traitUnlocked } from './config.ts';
import type { Attacker, Opener, Commit, MobGroup } from './wave.ts';
import type { Sim } from './sim.ts';

/**
 * The action space the net decodes over: 7 elements × these 7 traits = 49. The elemental
 * (non-bypass) traits give the continuous "attack the type it answers weakly" signal; the
 * gating traits (Flier / Shade / Breaker) let the net field the WHOLE roster — it learns to
 * send fliers when the sky is open, shades when detection is absent, breakers at a maze, from
 * the anti-air / detection / wall features. (This was viable once the meta-diverse boards
 * stopped the bypass traits from swamping the signal — their leak now genuinely varies with
 * the board's coverage.)
 */
export const MODEL_TRAITS = [Trait.Grunt, Trait.Swarm, Trait.Tank, Trait.Runner, Trait.Flier, Trait.Shade, Trait.Breaker] as const;
export const N_ACTIONS = N_ELEMENTS * MODEL_TRAITS.length; // 49

export function decodeAction(a: number): { element: Element; trait: Trait } {
  return { element: Math.floor(a / MODEL_TRAITS.length) as Element, trait: MODEL_TRAITS[a % MODEL_TRAITS.length] };
}
export function encodeAction(element: Element, trait: Trait): number {
  return element * MODEL_TRAITS.length + MODEL_TRAITS.indexOf(trait as (typeof MODEL_TRAITS)[number]);
}

export const N_FEATURES = 11;

/**
 * Pool the spatial observation into the 11-dim feature vector the net reads:
 *  - EFFECTIVE coverage per element E (7): how much of the player's fire actually lands on
 *    a mob of element E, after the type chart — i.e. sum_T dps[T]·typeMult(T,E). This is the
 *    signal that decides which element the player answers weakly, handed to the net directly.
 *  - anti-air, detection, control totals (3): the capability gaps (fliers/shades/slow).
 *  - wall coverage (1): total wall HP on the board → drives the Breaker decision.
 */
export function featurize(obs: Observation): number[] {
  const dps = new Array(N_ELEMENTS).fill(0);
  let antiAir = 0, detection = 0, control = 0, walls = 0;
  for (let i = 0; i < obs.cells.length; i++) {
    const f = obs.cells[i];
    for (let e = 0; e < N_ELEMENTS; e++) dps[e] += fxToFloat(f.dps[e]);
    antiAir += fxToFloat(f.antiAir);
    detection += fxToFloat(f.detection);
    control += fxToFloat(f.control);
    walls += fxToFloat(f.wallHp);
  }
  const eff = new Array(N_ELEMENTS).fill(0);
  for (let E = 0; E < N_ELEMENTS; E++) {
    let s = 0;
    for (let T = 0; T < N_ELEMENTS; T++) s += dps[T] * fxToFloat(typeMult(T as Element, E as Element));
    eff[E] = s;
  }
  return [...eff, antiAir, detection, control, walls];
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

/** Indices of the `k` highest-scoring actions, best first (deterministic; ties by index). */
export function topActions(a: number[], k: number): number[] {
  return a.map((_, i) => i).sort((p, q) => (a[q] - a[p]) || (p - q)).slice(0, k);
}

/** Fx seconds for a tenths-of-a-second value (clean spawn timings). */
function tenths(t: number): number { return Math.round((t / 10) * 1024); }

export interface ModelOptions {
  reserveFrac?: number; // fraction of budget held back as reserve
  topK?: number; //       how many top exploits to field as a composition (default 3)
}

/**
 * ModelAttacker — runs the distilled net behind the same Attacker interface as the search.
 * It reads the board, and fields a COMPOSITION of its top predicted-leak attacks (element ×
 * trait) — so a wave is "your worst weaknesses, all at once": fliers surface when your sky is
 * open, shades when you're blind, breakers at your maze, the right element against your thin
 * matchup. Groups spread across your thinnest columns; the reserve reinforces the top read.
 */
export class ModelAttacker implements Attacker {
  private readonly reserveFrac: number;
  private readonly topK: number;
  lastAction = 0;
  /** Reserve commits fired this wave (for the recap), reset at open(). */
  committed: Commit[][] = [];

  constructor(private readonly sim: Sim, private readonly weights: Weights, opts: ModelOptions = {}) {
    this.reserveFrac = opts.reserveFrac ?? 0.35;
    this.topK = opts.topK ?? 3;
  }

  open(obs: Observation): { opener: Opener; pool: number } {
    this.committed = [];
    const wave = obs.wave > 0 ? obs.wave : Math.max(1, this.sim.waveNumber());
    const budget = budgetFor(wave, obs.diff);
    const pool = Math.round(budget * this.reserveFrac);
    const openerBudget = budget - pool;

    const scores = forward(this.weights, featurize(obs));
    // Respect the roster schedule — never field a trait before its unlock wave (the net's
    // vocabulary spans the whole roster, but the game reveals it gradually).
    for (let a = 0; a < scores.length; a++) if (!traitUnlocked(decodeAction(a).trait, wave, obs.diff)) scores[a] = -Infinity;
    this.lastAction = argmax(scores);
    // Field the top-K unlocked exploits as a mixed wave, budget split by their predicted leak.
    const top = topActions(scores, this.topK).filter((a) => Number.isFinite(scores[a]));
    const cols = this.thinColumns(obs, top.length);
    const weight = top.map((a) => Math.max(0.05, scores[a]));
    const wsum = weight.reduce((s, w) => s + w, 0) || 1;
    const opener: Opener = [];
    top.forEach((a, n) => {
      const { element, trait } = decodeAction(a);
      const group = this.fill(element, trait, Math.round((openerBudget * weight[n]) / wsum));
      if (group) opener.push({ t: tenths(n * 3), x: cols[n], group });
    });
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

  /** The `k` thinnest columns (least coverage), to spread the composition across the board. */
  private thinColumns(obs: Observation, k: number): number[] {
    const cols: { x: number; d: number }[] = [];
    for (let x = 0; x < obs.w; x++) {
      let d = 0;
      for (let y = 0; y < obs.h; y++) { const f = obs.cells[y * obs.w + x]; for (let e = 0; e < N_ELEMENTS; e++) d += fxToFloat(f.dps[e]); }
      cols.push({ x, d });
    }
    cols.sort((a, b) => a.d - b.d);
    return Array.from({ length: k }, (_, i) => cols[Math.min(i, cols.length - 1)].x);
  }
}
