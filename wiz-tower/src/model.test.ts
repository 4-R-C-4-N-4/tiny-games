import { describe, it, expect } from 'vitest';
import { Rng } from './fx.ts';
import { DEFAULT_CONFIG, budgetFor, groupCost } from './config.ts';
import { featurize, forward, argmax, topActions, decodeAction, N_FEATURES, N_ACTIONS, ModelAttacker, type Weights } from './model.ts';
import { adaptiveLeakSurface, sampleBoard } from './teacher.ts';
import weightsJson from './weights.json';

const weights = weightsJson as unknown as Weights;

describe('distilled model — shapes & forward pass', () => {
  it('featurize is N_FEATURES long; forward is N_ACTIONS long', () => {
    const s = sampleBoard(new Rng(1n), DEFAULT_CONFIG);
    const x = featurize(s.observe());
    expect(x).toHaveLength(N_FEATURES);
    expect(forward(weights, x)).toHaveLength(N_ACTIONS);
  });

  it('ships a tiny net (~2.5k params)', () => {
    const p = N_FEATURES * weights.b1.length + weights.b1.length + weights.b1.length * N_ACTIONS + N_ACTIONS;
    expect(p).toBeLessThan(4000);
  });
});

describe('distilled model — reads the board and fields near-optimal exploits', () => {
  // The net is a COMPOSITION attacker over 49 actions (7 elements × 7 traits), trained on the
  // adaptive-probe teacher. Exact top-1 match is a poor metric (Sonic-Shade vs Zap-Shade read
  // as a "miss" though the decision is identical), so we score what matters: does its CHOSEN
  // attack leak near the oracle's, does it pick the right THREAT TYPE, and does its top-3
  // composition usually contain the oracle's best — all on the adaptive surface it learned.
  it('its chosen attacks leak near the oracle and read the right threat type', () => {
    const rng = new Rng(31337n);
    const N = 40;
    const boards = Array.from({ length: N }, () => sampleBoard(rng, DEFAULT_CONFIG));
    const surfaces = boards.map((s) => adaptiveLeakSurface(s).surface);
    const oracle = surfaces.map(argmax);
    const scores = boards.map((s) => forward(weights, featurize(s.observe())));
    const student = scores.map(argmax);
    const top3 = scores.map((s) => topActions(s, 3));

    let top3hit = 0, traitMatch = 0, stuLeak = 0, oracleLeak = 0, randomLeak = 0;
    for (let i = 0; i < N; i++) {
      if (top3[i].includes(oracle[i])) top3hit++;
      if (decodeAction(student[i]).trait === decodeAction(oracle[i]).trait) traitMatch++;
      stuLeak += surfaces[i][student[i]];
      oracleLeak += surfaces[i][oracle[i]];
      randomLeak += surfaces[i].reduce((a, b) => a + b, 0) / N_ACTIONS;
    }
    // Its picks land near the oracle and far above a random action — the core quality bar.
    expect(stuLeak).toBeGreaterThan(1.5 * randomLeak);
    expect(stuLeak).toBeGreaterThan(0.75 * oracleLeak);
    // It reads roughly the right threat type, and its composition usually covers the oracle's
    // best. (Trait-match is secondary — with relative-gap features the net favours a correct
    // BYPASS read over an exact-trait match, so it may pick a different-but-near-optimal trait;
    // stuLeak-vs-oracle above is what proves the picks are good.)
    expect(traitMatch / N).toBeGreaterThan(0.33);
    expect(top3hit / N).toBeGreaterThan(0.3);
  }, 60_000);
});

describe('ModelAttacker — runtime behaviour', () => {
  it('produces a within-budget opener and a hidden reserve, deterministically', () => {
    const s = sampleBoard(new Rng(9n), DEFAULT_CONFIG);
    s.prepareWave(3, 3);
    const a = new ModelAttacker(s, weights);
    const r1 = a.open(s.observe());
    const s2 = sampleBoard(new Rng(9n), DEFAULT_CONFIG); // same seed → same board
    s2.prepareWave(3, 3);
    const r2 = new ModelAttacker(s2, weights).open(s2.observe());
    expect(r1).toEqual(r2);
    expect(r1.pool).toBeGreaterThan(0);
    const cost = r1.opener.reduce((n, sp) => n + groupCost(sp.group.trait, sp.group.count), 0);
    expect(cost).toBeLessThanOrEqual(budgetFor(3) - r1.pool);
    // the lead action decodes to a valid element × trait
    const { element, trait } = decodeAction(a.lastAction);
    expect(element).toBeGreaterThanOrEqual(0);
    expect(trait).toBeGreaterThanOrEqual(0);
  });
});
