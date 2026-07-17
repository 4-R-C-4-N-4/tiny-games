/**
 * StrategistAttacker — Phase 5 (L3): the opponent that feels like a mind. Where the search
 * (L2) plays each wave in isolation, the Strategist carries **memory** across waves, builds
 * a running **model of the player's habits**, and runs **cross-wave traps** — then steers
 * the L2 search with per-wave {@link WaveBias} rather than reinventing wave generation.
 *
 * What it learns and does:
 *  - **Chronic type gap.** An EMA of your effective coverage per element; it hammers the
 *    school you *persistently* answer weakest, not just this board's momentary thinness.
 *  - **Reads your go-to build.** It tracks your dominant ward school and pre-counters it —
 *    persistently favouring the element your main towers are weakest into, so your biggest
 *    investment does the least work. Named in the telegraph ("your Fire-heavy wards").
 *  - **Capability escalation.** If you never raise anti-air / detection, it sends more and
 *    more Drakes / Wraiths, escalating each wave the gap stays open.
 *  - **Multi-wave feint (the gambit).** It telegraphs at the flank you defend most (a decoy),
 *    watches whether you *reinforce* it in response, and if you take the bait it swings an
 *    amplified reserve strike into the flank you thinned — a trap that pays off a wave later.
 *  - **Skill-read pacing (the director).** It tracks how comfortable you are (Core health over
 *    time) and, when you're cruising, presses harder — concentrating force and escalating the
 *    gap — then eases when you're on the ropes. Challenge tuned to you, not a fixed curve.
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
  totalEma: number[]; // raw DPS per element (which school they actually build → their "main")
  airEma: number; //    anti-air coverage
  detEma: number; //    detection coverage
  colEma: number[]; //  per-column ward density (where they defend)
  investment: number; // attunements + tree depth (breadth-vs-depth spend)
  comfort: number; //   EMA of Core-health fraction — the director's read on how you're faring
  lowAirStreak: number;
  lowDetStreak: number;
  waves: number;
  // gambit (multi-wave feint) state
  feintBand: number; //     flank band the last opener feinted (-1 = none yet)
  feintColSnap: number[]; // colEma snapshot when that feint was laid, to detect a reinforce
  strikePending: boolean; //whether last wave's feint was taken → strike the thinned flank now
}

/** The shared read that both the opener bait and the reserve punish derive from each wave. */
interface Plan {
  gap: Element; //     chronic weakest-answered school
  main: Element; //    dominant ward school (their go-to)
  counterMain: Element; // element their main towers are weakest into (pre-counter)
  strong: number; //   flank band they defend most
  weak: number; //     flank band they defend least
  press: number; //    director aggression, ~0.4 (on the ropes) … ~1.6 (cruising)
}

export class StrategistAttacker implements Attacker {
  private readonly search: SearchAttacker;
  private readonly sim: Sim;
  private model: PlayerModel | null = null;
  /** A short, legible statement of the current plan — surfaced in the telegraph (§4.6). */
  intent = '';
  /** Last biases handed to the search — exposed for tests/telemetry. */
  lastOpenerBias: WaveBias | null = null;
  lastCommitBias: WaveBias | null = null;

  constructor(sim: Sim, opts: SearchOptions = {}) {
    this.sim = sim;
    this.search = new SearchAttacker(sim, opts);
  }

  get committed(): Commit[][] {
    return this.search.committed;
  }

  open(obs: Observation): { opener: Opener; pool: number } {
    this.observe(obs);
    const plan = this.plan(obs);
    this.setIntent(plan);
    // The telegraphed opener baits the flank you defend most (a decoy you keep guarding).
    const bias = this.bias(plan, plan.strong, plan.press);
    this.lastOpenerBias = bias;
    this.search.bias = bias;
    // Arm the gambit: remember which flank we baited, and the coverage we baited it against.
    this.model!.feintBand = plan.strong;
    this.model!.feintColSnap = this.model!.colEma.slice();
    return this.search.open(obs);
  }

  commit(ctx: DecisionContext): Commit[] {
    const plan = this.plan(ctx.obs);
    // The hidden reserve swings to the flank you defend least — the punish. If last wave's
    // feint was taken, this is the STRIKE: concentrate even harder on the flank you thinned.
    const concentration = this.model!.strikePending ? plan.press + 0.8 : plan.press;
    const bias = this.bias(plan, plan.weak, concentration);
    this.lastCommitBias = bias;
    this.search.bias = bias;
    return this.search.commit(ctx);
  }

  // ---- memory ---------------------------------------------------------------------

  private observe(obs: Observation): void {
    const r = read(obs);
    const coreFrac = clamp01(fxToFloat(this.sim.coreHp()) / fxToFloat(this.sim.cfg.coreHp));
    if (!this.model) {
      this.model = {
        effEma: r.effective.slice(), totalEma: r.totalDps.slice(),
        airEma: r.antiAir, detEma: r.detection, colEma: r.colDps.slice(),
        investment: r.investment, comfort: 0.55, // start neutral; rises as it sees you cope
        lowAirStreak: 0, lowDetStreak: 0, waves: 0,
        feintBand: -1, feintColSnap: r.colDps.slice(), strikePending: false,
      };
    } else {
      const m = this.model;
      // Did the player reinforce the flank we feinted last wave? If so, the bait was taken.
      m.strikePending = m.feintBand >= 0 && bandSum(r.colDps, m.feintBand) > bandSum(m.feintColSnap, m.feintBand) * 1.1;
      for (let e = 0; e < N_ELEMENTS; e++) {
        m.effEma[e] = lerp(m.effEma[e], r.effective[e], ALPHA);
        m.totalEma[e] = lerp(m.totalEma[e], r.totalDps[e], ALPHA);
      }
      for (let x = 0; x < r.colDps.length; x++) m.colEma[x] = lerp(m.colEma[x] ?? 0, r.colDps[x], ALPHA);
      m.airEma = lerp(m.airEma, r.antiAir, ALPHA);
      m.detEma = lerp(m.detEma, r.detection, ALPHA);
      m.comfort = lerp(m.comfort, coreFrac, ALPHA);
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

  // ---- planning -------------------------------------------------------------------

  private plan(obs: Observation): Plan {
    const m = this.model!;
    // Chronic gap: the school your coverage answers weakest, remembered across waves.
    let gap = 0;
    for (let e = 1; e < N_ELEMENTS; e++) if (m.effEma[e] < m.effEma[gap]) gap = e;
    // Your go-to: the school you pour the most DPS into — and the element it's weakest into.
    let main = 0;
    for (let e = 1; e < N_ELEMENTS; e++) if (m.totalEma[e] > m.totalEma[main]) main = e;
    let counterMain = 0;
    for (let e = 1; e < N_ELEMENTS; e++) {
      if (typeMult(main as Element, e as Element) < typeMult(main as Element, counterMain as Element)) counterMain = e;
    }
    const { strong, weak } = this.thirds(obs.w);
    // Director: when you're comfortable (Core healthy over time), press harder.
    const press = clamp(0.4 + m.comfort, 0.4, 1.6);
    return { gap: gap as Element, main: main as Element, counterMain: counterMain as Element, strong, weak, press };
  }

  private thirds(w: number): { strong: number; weak: number } {
    const col = this.model!.colEma;
    const band = [0, 0, 0];
    for (let x = 0; x < w; x++) band[third(x, w)] += col[x] ?? 0;
    let strong = 0, weak = 0;
    for (let i = 1; i < 3; i++) { if (band[i] > band[strong]) strong = i; if (band[i] < band[weak]) weak = i; }
    return { strong, weak };
  }

  /** Build the WaveBias for a given target flank band and director pressure. */
  private bias(plan: Plan, flankBand: number, press: number): WaveBias {
    const m = this.model!;
    // Elemental pressure: relentlessly attack the chronic gap, and lean on the pre-counter to
    // your main school — both scaled by how hard the director wants to press.
    const elem = new Array(N_ELEMENTS).fill(1);
    elem[plan.gap] = 1.5 + 2 * press; //                  2.3 … 4.7
    elem[plan.counterMain] *= 1 + 0.6 * press; //          fold in "waste their best towers"
    // Capability escalation, amplified when pressing.
    const traitBoost: WaveBias['traitBoost'] = {};
    if (m.lowAirStreak >= 2) traitBoost[Trait.Flier] = (2 + Math.min(4, m.lowAirStreak)) * (0.7 + 0.6 * press);
    if (m.lowDetStreak >= 2) traitBoost[Trait.Shade] = (2 + Math.min(4, m.lowDetStreak)) * (0.7 + 0.6 * press);
    return {
      elemWeightMul: elem,
      colWeightMul: bandMul(flankBand, this.model!.colEma.length, 2 + 3 * press),
      traitBoost,
      weights: this.techingUp ? DENY : BALANCED,
    };
  }

  private setIntent(plan: Plan): void {
    const m = this.model!;
    const where = ['left', 'centre', 'right'];
    const parts = [`probes your thin ${ELEMENT_NAMES[plan.gap]} ward`];
    if (m.totalEma[plan.main] > 0.5) parts.push(`pre-counters your ${ELEMENT_NAMES[plan.main]}-heavy wards`);
    if (m.lowAirStreak >= 2) parts.push('massing Drakes over your open sky');
    else if (m.lowDetStreak >= 2) parts.push('slipping Wraiths past your blind spots');
    if (m.strikePending) parts.push(`you reinforced ${where[m.feintBand]} as baited — now strikes your ${where[plan.weak]}`);
    else if (plan.strong !== plan.weak) parts.push(`feints ${where[plan.strong]}, holds for your ${where[plan.weak]}`);
    if (m.comfort > 0.85) parts.push('and presses, sensing you at ease');
    else if (m.comfort < 0.4) parts.push('and circles for the kill');
    if (this.techingUp) parts.push('starving your bounty as you tech');
    this.intent = 'The Adversary ' + parts.join(', ') + '.';
  }
}

// ---- helpers ----------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function clamp01(v: number): number { return clamp(v, 0, 1); }
function third(x: number, w: number): number { return x < w / 3 ? 0 : x >= (2 * w) / 3 ? 2 : 1; }
function bandSum(col: number[], band: number): number {
  const w = col.length;
  let s = 0;
  for (let x = 0; x < w; x++) if (third(x, w) === band) s += col[x] ?? 0;
  return s;
}
function bandMul(band: number, w: number, value: number): number[] {
  return Array.from({ length: w }, (_, x) => (third(x, w) === band ? value : 1));
}

/** Read the aggregate signals the model tracks from one observation. */
function read(obs: Observation): { effective: number[]; totalDps: number[]; colDps: number[]; antiAir: number; detection: number; investment: number } {
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
  return { effective, totalDps, colDps, antiAir, detection, investment };
}
