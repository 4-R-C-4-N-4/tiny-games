import { describe, it, expect } from 'vitest';
import { Element, typeMult, STRONG, WEAK, NEUTRAL, N_ELEMENTS } from './element.ts';

const { Fire, Ice, Earth, Sonic, Zap, Light, Dark } = Element;

describe('typeMult — §3.1 wheel + Light/Dark', () => {
  // Wheel: Sonic > Earth > Zap > Ice > Fire > Sonic
  const wheelEdges: [Element, Element][] = [
    [Sonic, Earth],
    [Earth, Zap],
    [Zap, Ice],
    [Ice, Fire],
    [Fire, Sonic],
  ];

  it('strong edges are 1.5×', () => {
    for (const [a, d] of wheelEdges) expect(typeMult(a, d)).toBe(STRONG);
  });

  it('the reverse of every strong edge is weak 0.5×', () => {
    for (const [a, d] of wheelEdges) expect(typeMult(d, a)).toBe(WEAK);
  });

  it('Light ⇄ Dark are mutually strong', () => {
    expect(typeMult(Light, Dark)).toBe(STRONG);
    expect(typeMult(Dark, Light)).toBe(STRONG);
  });

  it('Light/Dark are neutral vs the whole wheel', () => {
    for (const e of [Fire, Ice, Earth, Sonic, Zap]) {
      expect(typeMult(Light, e)).toBe(NEUTRAL);
      expect(typeMult(e, Light)).toBe(NEUTRAL);
      expect(typeMult(Dark, e)).toBe(NEUTRAL);
      expect(typeMult(e, Dark)).toBe(NEUTRAL);
    }
  });

  it('same-element mirror is neutral (incl. Light/Dark self)', () => {
    for (let e = 0; e < N_ELEMENTS; e++) expect(typeMult(e, e)).toBe(NEUTRAL);
  });

  it('matches the full §3.1 table', () => {
    // Rows = attacker, cols = defender, in index order Fire,Ice,Earth,Sonic,Zap,Light,Dark.
    const S = STRONG, W = WEAK, N = NEUTRAL;
    const table = [
      [N, W, N, S, N, N, N], // Fire
      [S, N, N, N, W, N, N], // Ice
      [N, N, N, W, S, N, N], // Earth
      [W, N, S, N, N, N, N], // Sonic
      [N, S, W, N, N, N, N], // Zap
      [N, N, N, N, N, N, S], // Light
      [N, N, N, N, N, S, N], // Dark
    ];
    for (let a = 0; a < N_ELEMENTS; a++)
      for (let d = 0; d < N_ELEMENTS; d++)
        expect([a, d, typeMult(a, d)]).toEqual([a, d, table[a][d]]);
  });

  it('exactly one strong and one weak per wheel attacker; none for Light/Dark vs wheel', () => {
    for (const a of [Fire, Ice, Earth, Sonic, Zap]) {
      let strong = 0, weak = 0;
      for (let d = 0; d < N_ELEMENTS; d++) {
        if (typeMult(a, d) === STRONG) strong++;
        if (typeMult(a, d) === WEAK) weak++;
      }
      expect([a, strong, weak]).toEqual([a, 1, 1]);
    }
  });
});
