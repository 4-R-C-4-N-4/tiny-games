import { describe, expect, it } from 'vitest';
import { NEUTRAL_STATS } from './stats.ts';
import { makeTrueName } from './truename.ts';

const fierce = { ...NEUTRAL_STATS, ferocity: 0.9 };

describe('makeTrueName', () => {
  it('is deterministic', () => {
    const picks = ['savage', 'cunning', 'steadfast', 'serene', 'arcane'];
    expect(makeTrueName(picks, fierce, 'clumsy')).toBe(makeTrueName(picks, fierce, 'clumsy'));
  });

  it('fuses fragments of the first picks and carries the dominant epithet', () => {
    const name = makeTrueName(['savage', 'cunning', 'steadfast'], fierce);
    expect(name).toMatch(/^Sa.*, the Fierce$/);
  });

  it('the flaw scars the name', () => {
    const picks = ['savage', 'cunning'];
    expect(makeTrueName(picks, fierce, 'reckless')).not.toBe(makeTrueName(picks, fierce));
  });
});
