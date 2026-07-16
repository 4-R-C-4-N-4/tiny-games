/**
 * Minimal browser entry — NOT the renderer (that's Phase 1). It exists to prove the
 * determinism contract's "one engine, two consumers" claim: the very same `sim.ts`
 * that the Node trainer imports also bundles and runs in the browser. It plays the
 * shared scenario twice and shows the scorecard + determinism check.
 */
import { playGolden, formatScorecard, scorecardKey, GOLDEN_WAVE } from '../src/scenario.ts';

const out = document.getElementById('out')!;

const a = playGolden();
const b = playGolden();
const identical = scorecardKey(a) === scorecardKey(b);

out.textContent =
  'Scripted wave:\n' +
  GOLDEN_WAVE.replace(/\n$/, '') + '\n\n' +
  'Scorecard:\n' + formatScorecard(a) + '\n\n' +
  `Determinism: run A ${identical ? '==' : '!='} run B → ${identical ? 'PASS ✓' : 'FAIL ✗'}`;
out.className = identical ? 'ok' : 'bad';
