import { describe, expect, it } from 'vitest';
import { StubScorer } from './stub-scorer.ts';
import { CHANNELS } from './types.ts';

const scorer = new StubScorer();

describe('StubScorer', () => {
  it('is deterministic: same word, same profile', () => {
    const a = scorer.score('gloaming');
    const b = scorer.score('gloaming');
    expect(a).toEqual(b);
  });

  it('normalizes case and whitespace', () => {
    expect(scorer.score('  Inferno ')).toEqual(scorer.score('inferno'));
  });

  it('mix sums to 1 for any word', () => {
    for (const w of ['kill', 'mirror', 'zyzzyva', 'qat']) {
      const sum = CHANNELS.reduce((acc, c) => acc + scorer.score(w).mix[c], 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it('seed words read correctly on their dominant channel', () => {
    expect(scorer.score('conflagration').dominant).toBe('damage');
    expect(scorer.score('malediction').dominant).toBe('hex');
    expect(scorer.score('mirror').dominant).toBe('ward');
    expect(scorer.score('panacea').dominant).toBe('heal');
  });

  it('rarity is the power knob: kill < immolate < conflagration', () => {
    const kill = scorer.score('kill');
    const immolate = scorer.score('immolate');
    const conflagration = scorer.score('conflagration');
    expect(kill.power).toBeLessThan(immolate.power);
    expect(immolate.power).toBeLessThan(conflagration.power);
  });

  it('pure words cost more per point of power than hybrids', () => {
    const pure = scorer.score('bulwark'); // near-pure ward
    const hybrid = scorer.score('winter'); // spread profile
    expect(pure.cost / pure.power).toBeGreaterThan(hybrid.cost / hybrid.power);
  });

  it('rejects non-word input', () => {
    expect(scorer.knows('a')).toBe(false);
    expect(scorer.knows('word salad')).toBe(false);
    expect(scorer.knows('42')).toBe(false);
    expect(scorer.knows('inferno')).toBe(true);
  });
});
