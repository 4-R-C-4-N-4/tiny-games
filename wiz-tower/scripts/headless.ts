/**
 * Headless scorecard — Phase 0's playable-free proof of life. Plays the fixed scenario
 * TWICE and prints the scorecard; the two runs must be byte-identical (the determinism
 * contract). Run: `npm run headless`.
 */
import { playGolden, formatScorecard, scorecardKey, GOLDEN_WAVE } from '../src/scenario.ts';

console.log('wiz-tower — Phase 0 headless sim\n');
console.log('Scripted wave:');
console.log(GOLDEN_WAVE.split('\n').map((l) => '  ' + l).join('\n'));

const runA = playGolden();
const runB = playGolden();

console.log('\nScorecard (run A):');
console.log(formatScorecard(runA));

const identical = scorecardKey(runA) === scorecardKey(runB);
console.log(`\nDeterminism check: run A ${identical ? '==' : '!='} run B  →  ${identical ? 'PASS ✓' : 'FAIL ✗'}`);

process.exit(identical ? 0 : 1);
