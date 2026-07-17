/**
 * The teacher (Phase 2 distillation): the sim IS the oracle. For a given board it scores
 * every (element × trait) lead action by actually simulating that wave and measuring the
 * leak — the "leak surface" the tiny student is distilled to reproduce (soft targets).
 * Same recipe as the POC's `leak_vector`, but over the REAL spatial sim.
 */
import { Rng, fxToFloat } from './fx.ts';
import { Element, N_ELEMENTS, typeMult, STRONG } from './element.ts';
import { Tier, NodeKind, OccKind, type Cell } from './types.ts';
import { type Config } from './config.ts';
import { Sim } from './sim.ts';
import { PlanAttacker, type Wave } from './wave.ts';
import { playWave } from './driver.ts';
import { N_ACTIONS, decodeAction, featurize, forward, argmax, type Weights } from './model.ts';

/** Bodies of the probed action sent down EACH spawn column (front-wide). Kept small so the
 *  defense can meaningfully answer it — a saturated probe (everything leaks) is degenerate,
 *  its argmax constant across boards, and nothing to distill. */
export const PROBE_PER_COLUMN = 2;

/**
 * The teacher's leak surface for `sim`'s current board: leak (Core damage) from a
 * standardized FRONT-WIDE wave of each of the 28 lead actions — `countPerColumn` bodies of
 * the action pushed down every spawn column at once. Front-wide washes out single-column
 * geometry so the leak is a (near-)function of the aggregate coverage the features encode;
 * a small body count keeps it in the discriminative regime (a good defense stops the
 * countered actions, leaks on the gaps).
 */
export function leakSurface(sim: Sim, countPerColumn = PROBE_PER_COLUMN): number[] {
  const w = sim.grid.w;
  const surface = new Array(N_ACTIONS);
  for (let a = 0; a < N_ACTIONS; a++) {
    const { element, trait } = decodeAction(a);
    const opener = [];
    for (let x = 0; x < w; x++) opener.push({ t: 0, x, group: { element, trait, count: countPerColumn } });
    const wave: Wave = { budget: countPerColumn * w * 10, diff: 1, opener, reserve: { pool: 0, points: [] } };
    const fork = sim.clone();
    const m = playWave(fork, new PlanAttacker(wave), 1, 1);
    surface[a] = fxToFloat(m.leakedHp);
  }
  return surface;
}

export interface SampleBoardOptions {
  minTowers?: number;
  maxTowers?: number;
  wallChance?: number; // per extra build, chance to place a wall instead of a tower
}

/**
 * Generate a random but *plausible* player defense — the key to a distillable target is that
 * the best attack VARIES across boards, so we sample the way real players build:
 *  - specialize in 1–3 elements (creates clear elemental gaps: the elements those don't
 *    counter are the ones to attack), and
 *  - cover anti-air / detection only SOMETIMES (~half each), so fliers/shades are the best
 *    answer on some boards and not others.
 * Without this variety the surface is dominated by one action (send shades at the usual
 * detection-less board) and there is nothing to learn.
 */
export function sampleBoard(rng: Rng, cfg: Config, opts: SampleBoardOptions = {}): Sim {
  const minT = opts.minTowers ?? 3;
  const maxT = opts.maxTowers ?? 9;
  const wallChance = opts.wallChance ?? 0.15;
  const chance = (p: number) => rng.below(1000) / 1000 < p;

  const starting = rng.below(N_ELEMENTS) as Element;
  const sim = Sim.create({ ...cfg, startCurrency: 500 + rng.below(600) }, starting);

  // The player's specialization: 1–3 elements they build within.
  const setSize = 1 + rng.below(3);
  const set = new Set<Element>([starting]);
  while (set.size < setSize) set.add(rng.below(N_ELEMENTS) as Element);
  const kit = [...set];

  const place = (e: Element, tier: Tier): void => {
    const cell = randomBuildableEmpty(sim, rng);
    if (!cell) return;
    if (!sim.player.attuned[e]) sim.attune(e);
    if (!sim.player.attuned[e]) return;
    sim.buildTower(cell, e, tier, NodeKind.Turret);
  };

  const nBuilds = minT + rng.below(Math.max(1, maxT - minT + 1));
  for (let i = 0; i < nBuilds; i++) {
    if (chance(wallChance)) {
      const cell = randomBuildableEmpty(sim, rng);
      if (cell) sim.buildWall(cell);
      continue;
    }
    const e = kit[rng.below(kit.length)];
    place(e, rng.below(3) === 0 ? Tier.T2 : Tier.T1);
  }

  // Capability injections — present on ~half of boards each, so the gaps genuinely vary.
  if (chance(0.5)) place(chance(0.5) ? Element.Sonic : Element.Zap, Tier.T1); // anti-air
  if (chance(0.5)) place(Element.Light, Tier.T1); // detection
  if (chance(0.35)) place(Element.Ice, Tier.T1); // control/slow

  sim.syncFields();
  return sim;
}

/** The element that counters `e` (1.5×): its wheel predator, or the Light/Dark opposite. */
function counterElement(e: Element): Element {
  for (let c = 0; c < N_ELEMENTS; c++) if (typeMult(c as Element, e) === STRONG) return c as Element;
  return e;
}

/**
 * A DAgger board (§4.4 step 5): the boards the DEPLOYED model actually induces. We take a
 * random defense, let the current model pick its lead element, then have a naive player
 * COUNTER-build the element that beats it — the state the model's own play walks into. Re-
 * searching these and retraining teaches it to pivot instead of repeating a countered lead.
 */
export function sampleInducedBoard(rng: Rng, cfg: Config, weights: Weights): Sim {
  const sim = sampleBoard(rng, cfg);
  const lead = decodeAction(argmax(forward(weights, featurize(sim.observe()))));
  const counter = counterElement(lead.element);
  for (let i = 0; i < 2; i++) {
    const cell = randomBuildableEmpty(sim, rng);
    if (!cell) break;
    if (!sim.player.attuned[counter]) sim.attune(counter);
    if (sim.player.attuned[counter]) sim.buildTower(cell, counter, Tier.T1, NodeKind.Turret);
  }
  sim.syncFields();
  return sim;
}

function randomBuildableEmpty(sim: Sim, rng: Rng): Cell | null {
  const g = sim.grid;
  for (let tries = 0; tries < 30; tries++) {
    const c = { x: rng.below(g.w), y: rng.below(g.h) };
    const info = g.get(c);
    if (info.buildable && info.occ.kind === OccKind.Empty) return c;
  }
  return null;
}
