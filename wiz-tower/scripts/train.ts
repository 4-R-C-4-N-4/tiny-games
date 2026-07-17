/**
 * Distillation trainer (Phase 2) — sim-as-teacher → tiny student → weights.json.
 *
 * 1. Sample many random player boards.
 * 2. TEACHER: for each, the leak surface over all 28 (element × trait) lead actions,
 *    measured by simulating each wave on the real sim (soft targets).
 * 3. STUDENT: a 10→64→28 MLP distilled from the surface (numpy-style, in plain JS).
 * 4. Fold input standardization into the weights and export weights.json (raw features in).
 *
 * Run: `npm run train`.  Mirrors the POC recipe, now on the spatial sim.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Rng } from '../src/fx.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { featurize, N_FEATURES, N_ACTIONS, argmax, forward, type Weights } from '../src/model.ts';
import { leakSurface, sampleBoard, sampleInducedBoard } from '../src/teacher.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const N_TRAIN = 1600;
const N_TEST = 350;
const H = 64;
const EPOCHS = 80;
const BATCH = 256;
const LR = 2e-3;

const rng = new Rng(20260716n);

// DAgger: if a previous model exists, draw a fraction of boards from the distribution IT
// induces (defenses that counter its favored leads), re-search them, and retrain — one
// iteration of §4.4 step 5. First run (no weights yet) bootstraps on random boards only.
const WEIGHTS_PATH = join(HERE, '..', 'src', 'weights.json');
const DAGGER_FRAC = 0.4;
let prior: Weights | null = null;
if (existsSync(WEIGHTS_PATH)) {
  try { prior = JSON.parse(readFileSync(WEIGHTS_PATH, 'utf8')) as Weights; } catch { prior = null; }
}
console.log(prior ? `DAgger round: mixing ${Math.round(DAGGER_FRAC * 100)}% model-induced boards.` : 'Bootstrap round: random boards only.');

// ---- Gaussian init via Box–Muller on the seeded RNG (deterministic training) --------
function uniform(): number { return (rng.below(1_000_000) + 0.5) / 1_000_000; }
function randn(): number {
  const u1 = uniform(), u2 = uniform();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function mat(r: number, c: number, scale: number): number[][] {
  return Array.from({ length: r }, () => Array.from({ length: c }, () => randn() * scale));
}
function zeros(n: number): number[] { return new Array(n).fill(0); }
function zerosMat(r: number, c: number): number[][] { return Array.from({ length: r }, () => zeros(c)); }

// ---- data ---------------------------------------------------------------------------
function makeData(n: number, useDagger: boolean): { X: number[][]; Y: number[][] } {
  const X: number[][] = [], Y: number[][] = [];
  for (let i = 0; i < n; i++) {
    const induced = useDagger && prior && rng.below(1000) / 1000 < DAGGER_FRAC;
    const sim = induced ? sampleInducedBoard(rng, DEFAULT_CONFIG, prior!) : sampleBoard(rng, DEFAULT_CONFIG);
    X.push(featurize(sim.observe()));
    Y.push(leakSurface(sim));
    if ((i + 1) % 200 === 0) process.stdout.write(`  generated ${i + 1}/${n} boards\n`);
  }
  return { X, Y };
}

console.log(`Generating ${N_TRAIN + N_TEST} boards (teacher = search over the real sim)…`);
const { X: Xtr, Y: Ytr } = makeData(N_TRAIN, true); //  train: mix in induced boards (DAgger)
const { X: Xte, Y: Yte } = makeData(N_TEST, false); // test: fixed random distribution

// standardize inputs; scale targets to ~unit (argmax-invariant), like the POC
const mu = zeros(N_FEATURES), sd = zeros(N_FEATURES);
for (let j = 0; j < N_FEATURES; j++) {
  let m = 0; for (const x of Xtr) m += x[j]; m /= Xtr.length;
  let v = 0; for (const x of Xtr) v += (x[j] - m) ** 2; v = Math.sqrt(v / Xtr.length) + 1e-6;
  mu[j] = m; sd[j] = v;
}
let yscale = 0; for (const y of Ytr) for (const v of y) if (v > yscale) yscale = v;
yscale = yscale || 1;
const std = (X: number[][]) => X.map((x) => x.map((v, j) => (v - mu[j]) / sd[j]));
const XtrN = std(Xtr);
const YtrS = Ytr.map((y) => y.map((v) => v / yscale));

// ---- model + Adam -------------------------------------------------------------------
const W1 = mat(N_FEATURES, H, Math.sqrt(2 / N_FEATURES)), b1 = zeros(H);
const W2 = mat(H, N_ACTIONS, Math.sqrt(2 / H)), b2 = zeros(N_ACTIONS);
const mW1 = zerosMat(N_FEATURES, H), vW1 = zerosMat(N_FEATURES, H), mb1 = zeros(H), vb1 = zeros(H);
const mW2 = zerosMat(H, N_ACTIONS), vW2 = zerosMat(H, N_ACTIONS), mb2 = zeros(N_ACTIONS), vb2 = zeros(N_ACTIONS);
const B1 = 0.9, B2 = 0.999, EPS = 1e-8;
let tStep = 0;

function trainBatch(idx: number[]): void {
  const n = idx.length;
  const gW1 = zerosMat(N_FEATURES, H), gb1 = zeros(H), gW2 = zerosMat(H, N_ACTIONS), gb2 = zeros(N_ACTIONS);
  for (const s of idx) {
    const x = XtrN[s], y = YtrS[s];
    const z1 = zeros(H), a1 = zeros(H);
    for (let j = 0; j < H; j++) { let v = b1[j]; for (let i = 0; i < N_FEATURES; i++) v += x[i] * W1[i][j]; z1[j] = v; a1[j] = v > 0 ? v : 0; }
    const pred = zeros(N_ACTIONS);
    for (let k = 0; k < N_ACTIONS; k++) { let v = b2[k]; for (let j = 0; j < H; j++) v += a1[j] * W2[j][k]; pred[k] = v; }
    // MSE grad
    const d = zeros(N_ACTIONS);
    for (let k = 0; k < N_ACTIONS; k++) d[k] = (pred[k] - y[k]) * (2 / n);
    for (let j = 0; j < H; j++) { for (let k = 0; k < N_ACTIONS; k++) gW2[j][k] += a1[j] * d[k]; }
    for (let k = 0; k < N_ACTIONS; k++) gb2[k] += d[k];
    const da1 = zeros(H);
    for (let j = 0; j < H; j++) { if (z1[j] <= 0) continue; let v = 0; for (let k = 0; k < N_ACTIONS; k++) v += d[k] * W2[j][k]; da1[j] = v; }
    for (let i = 0; i < N_FEATURES; i++) { for (let j = 0; j < H; j++) gW1[i][j] += x[i] * da1[j]; }
    for (let j = 0; j < H; j++) gb1[j] += da1[j];
  }
  tStep++;
  const upd = (P: number[][], g: number[][], m: number[][], v: number[][]) => {
    for (let i = 0; i < P.length; i++) for (let j = 0; j < P[0].length; j++) {
      m[i][j] = B1 * m[i][j] + (1 - B1) * g[i][j];
      v[i][j] = B2 * v[i][j] + (1 - B2) * g[i][j] * g[i][j];
      const mh = m[i][j] / (1 - B1 ** tStep), vh = v[i][j] / (1 - B2 ** tStep);
      P[i][j] -= (LR * mh) / (Math.sqrt(vh) + EPS);
    }
  };
  const updV = (P: number[], g: number[], m: number[], v: number[]) => {
    for (let i = 0; i < P.length; i++) {
      m[i] = B1 * m[i] + (1 - B1) * g[i]; v[i] = B2 * v[i] + (1 - B2) * g[i] * g[i];
      const mh = m[i] / (1 - B1 ** tStep), vh = v[i] / (1 - B2 ** tStep);
      P[i] -= (LR * mh) / (Math.sqrt(vh) + EPS);
    }
  };
  upd(W1, gW1, mW1, vW1); updV(b1, gb1, mb1, vb1);
  upd(W2, gW2, mW2, vW2); updV(b2, gb2, mb2, vb2);
}

console.log(`Distilling ${N_FEATURES}→${H}→${N_ACTIONS} MLP (${EPOCHS} epochs)…`);
const nTr = XtrN.length;
for (let epoch = 0; epoch < EPOCHS; epoch++) {
  const perm = Array.from({ length: nTr }, (_, i) => i);
  for (let i = nTr - 1; i > 0; i--) { const j = rng.below(i + 1); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let s = 0; s < nTr; s += BATCH) trainBatch(perm.slice(s, s + BATCH));
}

// ---- fold standardization into the weights, then evaluate on RAW features -----------
const r5 = (x: number) => Number(x.toPrecision(5)); // trim float text; argmax margins are large
const W1f = W1.map((row, i) => row.map((w) => r5(w / sd[i])));
const b1f = b1.map((b, j) => r5(b - W1.reduce((acc, row, i) => acc + row[j] * (mu[i] / sd[i]), 0)));
const weights: Weights = {
  W1: W1f, b1: b1f, W2: W2.map((row) => row.map(r5)), b2: b2.map(r5),
  meta: { arch: `${N_FEATURES}-${H}-${N_ACTIONS}`, params: N_FEATURES * H + H + H * N_ACTIONS + N_ACTIONS, trained: N_TRAIN },
};

let top1 = 0, regret = 0, oracleLeak = 0;
const blindMean = zeros(N_ACTIONS);
for (const y of Ytr) for (let k = 0; k < N_ACTIONS; k++) blindMean[k] += y[k] / Ytr.length;
const blind = argmax(blindMean);
let blindAcc = 0;
for (let i = 0; i < Xte.length; i++) {
  const stu = argmax(forward(weights, Xte[i]));
  const ora = argmax(Yte[i]);
  if (stu === ora) top1++;
  if (ora === blind) blindAcc++;
  regret += Yte[i][ora] - Yte[i][stu];
  oracleLeak += Yte[i][ora];
}
const pct = (x: number) => (100 * x).toFixed(1);
console.log(`\nstudent top-1 agreement w/ search : ${pct(top1 / Xte.length)}%`);
console.log(`defense-blind baseline           : ${pct(blindAcc / Xte.length)}%   (random = ${(100 / N_ACTIONS).toFixed(1)}%)`);
console.log(`mean leak regret vs oracle       : ${(regret / Xte.length).toFixed(2)}  (${pct(regret / oracleLeak)}% of ${(oracleLeak / Xte.length).toFixed(1)})`);
console.log(`params: ${weights.meta!.params}`);

const outPath = join(HERE, '..', 'src', 'weights.json');
writeFileSync(outPath, JSON.stringify(weights));
console.log(`\nsaved ${outPath} (${(JSON.stringify(weights).length / 1024).toFixed(1)} KB)`);
