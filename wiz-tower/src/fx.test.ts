import { describe, it, expect } from 'vitest';
import { fx, fxRatio, fxMul, fxDiv, fxToInt, fxToFloat, FX_ONE, Rng } from './fx.ts';

describe('Fx fixed-point', () => {
  it('encodes integers', () => {
    expect(fx(1)).toBe(FX_ONE);
    expect(fx(0)).toBe(0);
    expect(fx(-3)).toBe(-3 * FX_ONE);
  });

  it('round-trips through fxToInt/fxToFloat', () => {
    expect(fxToInt(fx(7))).toBe(7);
    expect(fxToInt(fx(-7))).toBe(-7);
    expect(fxToFloat(fxRatio(1, 2))).toBeCloseTo(0.5, 6);
  });

  it('fxMul: 1.5 * 2 = 3', () => {
    const oneHalf = fxRatio(3, 2);
    expect(fxMul(oneHalf, fx(2))).toBe(fx(3));
  });

  it('fxMul stays exact for large i32-range operands (beyond 2^53 product)', () => {
    // a*b here is ~1.7e9 * 1.7e9 ≈ 2.9e18, far past Number.MAX_SAFE_INTEGER.
    const a = 1_700_000_000;
    const b = 1_700_000_000;
    // reference via BigInt
    const ref = Number((BigInt(a) * BigInt(b)) >> 10n) | 0;
    expect(fxMul(a, b)).toBe(ref);
  });

  it('fxDiv truncates toward zero like Rust i64 /', () => {
    expect(fxDiv(fx(7), fx(2))).toBe(fxRatio(7, 2)); // 3.5
    expect(fxToInt(fxDiv(fx(-7), fx(2)))).toBe(-3); // -3.5 truncates toward 0
  });

  it('fxMul is deterministic and commutative', () => {
    const a = fxRatio(123, 7);
    const b = fxRatio(-45, 11);
    expect(fxMul(a, b)).toBe(fxMul(b, a));
  });
});

describe('Rng xorshift64', () => {
  it('is reproducible for a fixed seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 8 }, () => a.nextU64());
    const seqB = Array.from({ length: 8 }, () => b.nextU64());
    expect(seqA).toEqual(seqB);
  });

  it('below(n) stays in range and differs across seeds', () => {
    const r = new Rng(1);
    for (let i = 0; i < 100; i++) {
      const v = r.below(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
    const x = new Rng(1).below(1000);
    const y = new Rng(2).below(1000);
    expect(x).not.toBe(y);
  });
});
