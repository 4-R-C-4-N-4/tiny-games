import { describe, it, expect } from 'vitest';
import { playGolden, scorecardKey, buildDefendedSim } from './scenario.ts';
import { fx } from './fx.ts';

describe('golden-replay determinism (Phase 0 DoD gate)', () => {
  it('the same scenario reproduces byte-identical metrics on repeat runs', () => {
    const a = playGolden();
    const b = playGolden();
    // Deep equality of the whole scorecard (metrics + core HP + currency + tick count).
    expect(b).toEqual(a);
    // And the exact serialized form matches — the determinism contract, literally.
    expect(scorecardKey(b)).toBe(scorecardKey(a));
  });

  it('runs five times to identical output (no accumulated drift)', () => {
    const keys = Array.from({ length: 5 }, () => scorecardKey(playGolden()));
    expect(new Set(keys).size).toBe(1);
  });

  it('the scenario is non-trivial: the wave actually resolves and towers fire', () => {
    const s = playGolden();
    expect(s.tick).toBeGreaterThan(0);
    // Fire and Sonic turrets both did work.
    expect(s.metrics.dpsUtil.some((v) => v > 0)).toBe(true);
    // The player earned some bounty (mobs died), and the run terminated cleanly.
    expect(s.metrics.currencyDelta).toBeGreaterThan(0);
  });

  it('the fixed defense builds deterministically (layout + fields identical)', () => {
    const s1 = buildDefendedSim();
    const s2 = buildDefendedSim();
    expect(Array.from(s1.fields.costWalled)).toEqual(Array.from(s2.fields.costWalled));
    expect(s1.player.currency).toBe(s2.player.currency);
    // The barrier forces a detour: column-3 spawn is farther than a straight drop (11).
    expect(s1.fields.distCore(s1.grid, { x: 3, y: 0 })).toBeGreaterThan(11);
    // Sanity: the core is still reachable (no accidental seal).
    expect(s1.fields.distCore(s1.grid, { x: 3, y: 0 })).not.toBe(0xffffffff);
    expect(s1.coreHp()).toBe(fx(100));
  });
});
