/**
 * Probe calibration for the distillation teacher. The leak surface is only distillable if
 * the best action VARIES with the board — a saturated probe makes it constant (defense-blind
 * baseline high, nothing to learn). This samples boards and, for several probe strengths,
 * reports mean leak, the defense-blind baseline accuracy (lower = more board-dependent =
 * better), and how spread the best-action distribution is. Run: `npm run calibrate`.
 */
import { Rng } from '../src/fx.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { N_ACTIONS, argmax } from '../src/model.ts';
import { leakSurface, sampleBoard } from '../src/teacher.ts';

const N = 150;
const SETTINGS = [1, 2, 3, 4, 6];

const rng = new Rng(777n);
const boards = Array.from({ length: N }, () => sampleBoard(rng, DEFAULT_CONFIG));

console.log(`probe | meanLeak | blindBaseline | distinctBest | top1-top2`);
for (const cpc of SETTINGS) {
  const surfaces = boards.map((s) => leakSurface(s, cpc));
  const argmaxes = surfaces.map(argmax);
  const counts = new Array(N_ACTIONS).fill(0);
  for (const a of argmaxes) counts[a]++;
  const modal = argmax(counts);
  const blindAcc = argmaxes.filter((a) => a === modal).length / N;
  const distinctBest = new Set(argmaxes).size;
  let meanLeak = 0, margin = 0;
  for (const surf of surfaces) {
    meanLeak += surf.reduce((a, b) => a + b, 0) / surf.length / N;
    const sorted = [...surf].sort((a, b) => b - a);
    margin += (sorted[0] - sorted[1]) / N;
  }
  console.log(
    `  ${cpc}   |  ${meanLeak.toFixed(1).padStart(5)}  |     ${(blindAcc * 100).toFixed(0).padStart(3)}%      |   ${String(distinctBest).padStart(2)}/${N_ACTIONS}      |  ${margin.toFixed(2)}`,
  );
}
console.log('\nWant: blindBaseline low (best action varies), meanLeak mid-range, distinctBest high.');
