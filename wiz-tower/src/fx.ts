/**
 * Q22.10 fixed-point scalar, mirrored from `lib.rs`'s `Fx`.
 *
 * All sim state that must be deterministic — positions, HP, damage, timers,
 * accumulators — is represented as an integer number of 1/1024 units packed into a
 * 32-bit signed range. This is the determinism contract's guard against float
 * accumulation order (PHASE0.md §1): the browser (live play) and Node (training
 * search) are both V8, and integer math is bit-identical across them, and would stay
 * bit-identical against an optional offline Rust/WASM search helper.
 *
 * The value is a JS `number` but ALWAYS holds an integer. Multiplication of two Fx
 * values needs a `>> FX_SHIFT` renormalize; we route it through {@link fxMul} so the
 * intermediate product is computed in 64-bit via BigInt to avoid the 53-bit mantissa
 * ever mattering (products of two i32s can exceed 2^53).
 */
export type Fx = number;

export const FX_SHIFT = 10;
export const FX_ONE: Fx = 1 << FX_SHIFT; // 1024
export const FX_HALF: Fx = FX_ONE >> 1; // 512

/** Integer `n` → Fx. */
export function fx(n: number): Fx {
  return (n | 0) << FX_SHIFT;
}

/**
 * Rational `num/den` → Fx, rounded toward zero. Handy for constants like fxRatio(1, 30)
 * for a 30 Hz timestep. `den` must be non-zero.
 */
export function fxRatio(num: number, den: number): Fx {
  return Math.trunc((num * FX_ONE) / den);
}

/** Fx → nearest integer (rounds toward zero on the fractional part). */
export function fxToInt(a: Fx): number {
  return a >= 0 ? a >> FX_SHIFT : -((-a) >> FX_SHIFT);
}

/** Fx → float, for rendering / logging only — NEVER feed back into sim state. */
export function fxToFloat(a: Fx): number {
  return a / FX_ONE;
}

/**
 * Fixed-point multiply: (a * b) >> FX_SHIFT, computed in 64-bit to stay exact.
 * Two i32-range Fx values multiplied can overflow the f64 integer-safe range
 * (|a*b| up to ~2^62), so we use BigInt for the intermediate, matching lib.rs's
 * `(a as i64 * b as i64) >> FX_SHIFT`. Result is truncated toward negative infinity
 * by the arithmetic shift, exactly as Rust's `>>` on i64.
 */
export function fxMul(a: Fx, b: Fx): Fx {
  const p = BigInt(a) * BigInt(b);
  return Number(p >> BigInt(FX_SHIFT)) | 0;
}

/** Fixed-point divide: (a << FX_SHIFT) / b, truncated toward zero (matches Rust i64 /). */
export function fxDiv(a: Fx, b: Fx): Fx {
  const q = (BigInt(a) << BigInt(FX_SHIFT)) / BigInt(b);
  return Number(q) | 0;
}

/** Clamp helper on Fx (integers), inclusive. */
export function fxClamp(a: Fx, lo: Fx, hi: Fx): Fx {
  return a < lo ? lo : a > hi ? hi : a;
}

/**
 * Deterministic PRNG (xorshift64), mirrored from `lib.rs`'s `Rng`. Used sparingly —
 * the sim is deterministic by construction; RNG only drives reproducible tie-breaks
 * and jitter. State is a BigInt so the 64-bit shifts are exact (JS `number` bitwise
 * ops are 32-bit only).
 */
const MASK64 = (1n << 64n) - 1n;

export class Rng {
  private state: bigint;

  constructor(seed: bigint | number) {
    // `| 1` avoids the all-zero fixed point of xorshift.
    this.state = (BigInt(seed) & MASK64) | 1n;
  }

  /** Next 64-bit value as a BigInt in [0, 2^64). */
  nextU64(): bigint {
    let x = this.state;
    x ^= (x << 13n) & MASK64;
    x ^= x >> 7n;
    x ^= (x << 17n) & MASK64;
    x &= MASK64;
    this.state = x;
    return x;
  }

  /** Uniform integer in [0, n). n must be a positive 32-bit-ish integer. */
  below(n: number): number {
    return Number(this.nextU64() % BigInt(n));
  }
}
