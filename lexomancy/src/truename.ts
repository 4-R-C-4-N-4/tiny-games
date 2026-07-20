import { dominantStat, type Stats } from './stats.ts';
import type { StatName } from './stats.ts';

// The True Name: seeded from the rite's chosen adjectives, deterministic.
// Enemies that survive long enough "learn" it — extremity has narrative cost.

const EPITHETS: Record<StatName, string> = {
  ferocity: 'the Fierce',
  guile: 'the Veiled',
  stone: 'the Unmoved',
  grace: 'the Gentle',
  resonance: 'the Learned',
};

/** First consonant-vowel cluster of a word: "savage" → "sa", "cunning" → "cu". */
function syllable(word: string, len: number): string {
  const m = word.match(/^[^aeiou]*[aeiou]+[^aeiou]?/);
  const s = (m ? m[0] : word).slice(0, len);
  return s;
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Deterministic name from the self-description: fragments of the first two
 * picks fused, the flaw's last letters as a scar, the dominant stat's epithet.
 */
export function makeTrueName(picks: string[], stats: Stats, flaw?: string): string {
  const a = syllable(picks[0] ?? 'nameless', 3);
  const b = syllable(picks[1] ?? 'one', 3);
  const scar = flaw ? flaw.slice(-2) : '';
  const core = cap(a + b + scar);
  return `${core}, ${EPITHETS[dominantStat(stats)]}`;
}
