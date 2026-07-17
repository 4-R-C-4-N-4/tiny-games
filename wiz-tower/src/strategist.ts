/**
 * StrategistAttacker — Phase 5 (L3): the opponent that feels like a mind. Where the search
 * (L2) plays each wave in isolation, the Strategist carries **memory** across waves, builds
 * a running **model of the player's habits**, and runs **cross-wave traps** — then steers
 * the L2 search with per-wave {@link WaveBias} rather than reinventing wave generation.
 *
 * What it learns and does:
 *  - **Chronic type gap.** An EMA of your effective coverage per element; it hammers the
 *    school you *persistently* answer weakest, not just this board's momentary thinness.
 *  - **Capability escalation.** If you never raise anti-air / detection, it sends more and
 *    more Drakes / Wraiths, escalating each wave the gap stays open.
 *  - **Flank feint.** It models where you concentrate your wards, telegraphs its opener at
 *    the flank you defend *most* (a decoy that keeps you committed there), and swings the
 *    hidden reserve to the flank you defend *least* — a bluff that plays out across waves.
 *  - **Economy denial while teching.** When it sees you spending on new attunements, it
 *    shifts its objective toward starving your bounty income to slow your expansion.
 *
 * It implements the same `Attacker` interface — the sim/game never know a mind is behind it.
 */
import { fxToFloat } from './fx.ts';
import { Element, N_ELEMENTS, ELEMENT_NAMES, typeMult } from './element.ts';
import { Trait } from './types.ts';
import type { Observation, DecisionContext } from './types.ts';
import { SearchAttacker, type SearchOptions, type WaveBias, type SearchWeights } from './search.ts';
import type { Attacker, Opener, Commit } from './wave.ts';
import type { Sim } from './sim.ts';

const BALANCED: SearchWeights = { leak: 1, econ: 0.3, tempo: 0.05 };
const DENY: SearchWeights = { leak: 0.7, econ: 1.2, tempo: 0.1 }; // starve bounty while teching
const ALPHA = 0.45; // EMA blend — recent waves matter, but memory persists

/** The Strategist's running model of the player, updated once per wave from the board. */
interface PlayerModel {
  effEma: number[]; //  effective coverage per element (higher = well answered)
  airEma: number; //    anti-air coverage
  detEma: number; //    detection coverage
  colEma: number[]; //  per-column ward density (where they defend)
  investment: number; // attunements + tree depth (breadth-vs-depth spend)
  lowAirStreak: number;
  lowDetStreak: number;
  waves: number;
}

export class StrategistAttacker implements Attacker {
  private readonly search: SearchAttacker;
  private model: PlayerModel | null = null;
  /** A short, legible statement of the current plan — surfaced in the telegraph (§4.6). */
  intent = '';

  constructor(sim: Sim, opts: SearchOptions = {}) {
    this.search = new SearchAttacker(sim, opts);
  }

  get committed(): Commit[][] {
    return this.search.committed;
  }

  open(obs: Observation): { opener: Opener; pool: number } {
    this.observe(obs);
    this.search.bias = this.openerBias(obs);
    return this.search.open(obs);
  }

  commit(ctx: DecisionContext): Commit[] {
    this.search.bias = this.commitBias(ctx.obs);
    return this.search.commit(ctx);
  }

  // ---- memory ---------------------------------------------------------------------

  private observe(obs: Observation): void {
    const r = read(obs);
    if (!this.model) {
      this.model = {
        effEma: r.effective.slice(), airEma: r.antiAir, detEma: r.detection, colEma: r.colDps.slice(),
        investment: r.investment, lowAirStreak: 0, lowDetStreak: 0, waves: 0,
      };
    } else {
      const m = this.model;
      for (let e = 0; e < N_ELEMENTS; e++) m.effEma[e] = lerp(m.effEma[e], r.effective[e], ALPHA);
      for (let x = 0; x < r.colDps.length; x++) m.colEma[x] = lerp(m.colEma[x] ?? 0, r.colDps[x], ALPHA);
      m.airEma = lerp(m.airEma, r.antiAir, ALPHA);
      m.detEma = lerp(m.detEma, r.detection, ALPHA);
      m.investment = r.investment;
    }
    const m = this.model;
    m.lowAirStreak = r.antiAir < 1.5 ? m.lowAirStreak + 1 : 0;
    m.lowDetStreak = r.detection < 1.5 ? m.lowDetStreak + 1 : 0;
    m.waves += 1;
    this.techingUp = r.investment > this.prevInvestment;
    this.prevInvestment = r.investment;
  }

  private prevInvestment = 0;
  private techingUp = false;

  // ---- planning: shared gap/trait bias, opener baits, reserve punishes -------------

  private chronicGap(): Element {
    const eff = this.model!.effEma;
    let best = 0;
    for (let e = 1; e < N_ELEMENTS; e++) if (eff[e] < eff[best]) best = e;
    return best as Element;
  }

  private thirds(): { strong: number; weak: number } {
    const col = this.model!.colEma, w = col.length;
    const band = [0, 0, 0];
    for (let x = 0; x < w; x++) band[third(x, w)] += col[x];
    let strong = 0, weak = 0;
    for (let i = 1; i < 3; i++) { if (band[i] > band[strong]) strong = i; if (band[i] < band[weak]) weak = i; }
    return { strong, weak };
  }

  private traitBoost(): WaveBias['traitBoost'] {
    const m = this.model!;
    const b: Partial<Record<Trait, number>> = {};
    if (m.lowAirStreak >= 2) b[Trait.Flier] = 2 + Math.min(4, m.lowAirStreak);
    if (m.lowDetStreak >= 2) b[Trait.Shade] = 2 + Math.min(4, m.lowDetStreak);
    return b;
  }

  private elemMul(gap: Element): number[] {
    const mul = new Array(N_ELEMENTS).fill(1);
    mul[gap] = 3.5; // relentlessly attack the school you never answer
    return mul;
  }

  private openerBias(obs: Observation): WaveBias {
    const gap = this.chronicGap();
    const { strong, weak } = this.thirds();
    const w = obs.w;
    // The telegraphed opener baits the flank you defend most (a decoy you keep guarding).
    this.setIntent(gap, strong, weak);
    return {
      elemMul: this.elemMul(gap),
      colWeightMul: bandMul(strong, w, 4),
      traitBoost: this.traitBoost(),
      weights: this.techingUp ? DENY : BALANCED,
    } as WaveBias;
  }

  private commitBias(obs: Observation): WaveBias {
    const gap = this.chronicGap();
    const { weak } = this.thirds();
    // The hidden reserve swings to the flank you defend least — the punish.
    return {
      elemMul: this.elemMul(gap),
      colWeightMul: bandMul(weak, obs.w, 4),
      traitBoost: this.traitBoost(),
      weights: this.techingUp ? DENY : BALANCED,
    } as WaveBias;
  }

  private setIntent(gap: Element, strong: number, weak: number): void {
    const m = this.model!;
    const where = ['left', 'centre', 'right'];
    const parts = [`probes your thin ${ELEMENT_NAMES[gap]} ward`];
    if (m.lowAirStreak >= 2) parts.push('massing Drakes over your open sky');
    else if (m.lowDetStreak >= 2) parts.push('slipping Wraiths past your blind spots');
    if (strong !== weak) parts.push(`feints ${where[strong]}, holds for your ${where[weak]}`);
    if (this.techingUp) parts.push('and starves your bounty as you tech');
    this.intent = 'The Adversary ' + parts.join(', ') + '.';
  }
}

// ---- helpers ----------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function third(x: number, w: number): number { return x < w / 3 ? 0 : x >= (2 * w) / 3 ? 2 : 1; }
function bandMul(band: number, w: number, value: number): number[] {
  return Array.from({ length: w }, (_, x) => (third(x, w) === band ? value : 1));
}

/** Read the aggregate signals the model tracks from one observation. */
function read(obs: Observation): { effective: number[]; colDps: number[]; antiAir: number; detection: number; investment: number } {
  const totalDps = new Array(N_ELEMENTS).fill(0);
  const colDps = new Array(obs.w).fill(0);
  let antiAir = 0, detection = 0;
  for (let y = 0; y < obs.h; y++) {
    for (let x = 0; x < obs.w; x++) {
      const f = obs.cells[y * obs.w + x];
      for (let e = 0; e < N_ELEMENTS; e++) { totalDps[e] += fxToFloat(f.dps[e]); colDps[x] += fxToFloat(f.dps[e]); }
      antiAir += fxToFloat(f.antiAir);
      detection += fxToFloat(f.detection);
    }
  }
  const effective = new Array(N_ELEMENTS).fill(0);
  for (let E = 0; E < N_ELEMENTS; E++) {
    let s = 0;
    for (let T = 0; T < N_ELEMENTS; T++) s += totalDps[T] * fxToFloat(typeMult(T as Element, E as Element));
    effective[E] = s;
  }
  const investment = obs.profile.attuned.filter(Boolean).length + obs.profile.depth.reduce((a, b) => a + b, 0);
  return { effective, colDps, antiAir, detection, investment };
}
