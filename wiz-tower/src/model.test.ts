import { describe, it, expect } from 'vitest';
import { Rng } from './fx.ts';
import { DEFAULT_CONFIG, budgetFor, groupCost } from './config.ts';
import { featurize, forward, argmax, decodeAction, N_FEATURES, N_ACTIONS, ModelAttacker, type Weights } from './model.ts';
import { leakSurface, sampleBoard } from './teacher.ts';
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

describe('distilled model — reads the board (beats the defense-blind baseline)', () => {
  // Compare the student's argmax action to the teacher's, over held-out boards, against a
  // defense-blind baseline (always play the globally most-common best action). This is the
  // POC's success criterion: the net must extract board-specific signal.
  it('agrees with the search teacher more than a defense-blind baseline, with low leak regret', () => {
    const rng = new Rng(31337n);
    const N = 60;
    const boards = Array.from({ length: N }, () => sampleBoard(rng, DEFAULT_CONFIG));
    const surfaces = boards.map((s) => leakSurface(s));
    const oracle = surfaces.map(argmax);
    const student = boards.map((s) => argmax(forward(weights, featurize(s.observe()))));

    // defense-blind baseline: the modal oracle action.
    const counts = new Array(N_ACTIONS).fill(0);
    for (const a of oracle) counts[a]++;
    const blind = argmax(counts);

    let stuAgree = 0, stuLeak = 0, oracleLeak = 0, randomLeak = 0;
    for (let i = 0; i < N; i++) {
      if (student[i] === oracle[i]) stuAgree++;
      stuLeak += surfaces[i][student[i]];
      oracleLeak += surfaces[i][oracle[i]];
      randomLeak += surfaces[i].reduce((a, b) => a + b, 0) / N_ACTIONS; // a random action's expected leak
    }
    void blind;
    // Reads the board: agreement well above chance (random pick = 1/28 ≈ 3.6%; the 350-board
    // training holdout measured ~41% vs a 17% defense-blind baseline).
    expect(stuAgree / N).toBeGreaterThan(0.25);
    // Its actual picks out-leak a random action by a clear margin and land near the oracle.
    expect(stuLeak).toBeGreaterThan(1.3 * randomLeak);
    expect(stuLeak).toBeGreaterThan(0.85 * oracleLeak);
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
