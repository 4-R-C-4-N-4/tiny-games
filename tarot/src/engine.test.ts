import { describe, expect, it } from 'vitest';
import { DeterministicRandom, getSpread, seedFromString, SPREAD_POSITIONS } from './engine';
import { MAJOR_ARCANA } from './data';

describe('seedFromString', () => {
  it('is deterministic', () => {
    expect(seedFromString('2026-07-21::three-card::')).toBe(seedFromString('2026-07-21::three-card::'));
  });

  it('differs for different inputs', () => {
    expect(seedFromString('2026-07-21::a')).not.toBe(seedFromString('2026-07-21::b'));
  });

  it('is never negative', () => {
    for (let i = 0; i < 200; i++) {
      expect(seedFromString(`probe-${i}-${'x'.repeat(i)}`)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('DeterministicRandom', () => {
  it('yields the same sequence for the same seed', () => {
    const a = new DeterministicRandom(42);
    const b = new DeterministicRandom(42);
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
  });

  it('nextInt stays in bounds', () => {
    const rng = new DeterministicRandom(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(0, 21);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(21);
    }
  });
});

describe('getSpread', () => {
  it('never deals the same card twice in one spread', () => {
    for (let seed = 0; seed < 100; seed++) {
      const spread = getSpread(MAJOR_ARCANA, 'celtic-cross', seed);
      const ids = spread.cards.map((c) => c.card.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('fills every position in order', () => {
    const spread = getSpread(MAJOR_ARCANA, 'celtic-cross', 123);
    expect(spread.cards.map((c) => c.position)).toEqual(SPREAD_POSITIONS['celtic-cross']);
    expect(getSpread(MAJOR_ARCANA, 'three-card', 123).cards.map((c) => c.position))
      .toEqual(SPREAD_POSITIONS['three-card']);
  });

  it('is deterministic for a given seed', () => {
    const a = getSpread(MAJOR_ARCANA, 'three-card', 999);
    const b = getSpread(MAJOR_ARCANA, 'three-card', 999);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('varies across seeds', () => {
    const a = getSpread(MAJOR_ARCANA, 'celtic-cross', 1);
    const b = getSpread(MAJOR_ARCANA, 'celtic-cross', 2);
    expect(JSON.stringify(a.cards)).not.toBe(JSON.stringify(b.cards));
  });

  it('deals everything upright when reversals are disabled', () => {
    for (let seed = 0; seed < 50; seed++) {
      const spread = getSpread(MAJOR_ARCANA, 'celtic-cross', seed, false);
      expect(spread.reversalsAllowed).toBe(false);
      expect(spread.cards.every((c) => !c.isReversed)).toBe(true);
    }
  });

  it('draws the same cards whether or not reversals are enabled', () => {
    for (let seed = 0; seed < 50; seed++) {
      const withRev = getSpread(MAJOR_ARCANA, 'celtic-cross', seed, true);
      const without = getSpread(MAJOR_ARCANA, 'celtic-cross', seed, false);
      expect(without.cards.map((c) => c.card.id)).toEqual(withRev.cards.map((c) => c.card.id));
    }
  });

  it('deals both orientations over many seeds', () => {
    let upright = 0;
    let reversed = 0;
    for (let seed = 0; seed < 50; seed++) {
      for (const c of getSpread(MAJOR_ARCANA, 'three-card', seed).cards) {
        if (c.isReversed) reversed++;
        else upright++;
      }
    }
    expect(upright).toBeGreaterThan(20);
    expect(reversed).toBeGreaterThan(20);
  });
});
