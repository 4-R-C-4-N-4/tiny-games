import { describe, it, expect } from 'vitest';
import { Game } from './game.ts';
import { Element } from './element.ts';
import { Tier, NodeKind } from './types.ts';
import { fxToFloat } from './fx.ts';
import { DEFAULT_CONFIG } from './config.ts';

const cfg = { ...DEFAULT_CONFIG, startCurrency: 400 };

/** Play up to `waves` waves with a fixed scripted defense; return a run summary. */
function playScripted(seed: bigint, waves = 5) {
  const g = new Game({ starting: Element.Fire, difficulty: 3, seed, config: cfg });

  // Initial build (build phase only).
  g.attune(Element.Sonic);
  for (const [x, y] of [[2, 6], [4, 6], [3, 8]] as const) {
    g.buildTower({ x, y }, Element.Fire, Tier.T2, NodeKind.Turret);
  }
  g.buildTower({ x: 3, y: 4 }, Element.Sonic, Tier.T1, NodeKind.Turret); // anti-air

  const wavesPlayed: number[] = [];
  for (let w = 0; w < waves && g.state !== 'gameover'; w++) {
    // Between waves: spend spare currency on another Fire turret if there's room.
    const spot = { x: 1 + (w % 4), y: 7 };
    g.buildTower(spot, Element.Fire, Tier.T1, NodeKind.Turret);

    g.startWave();
    expect(g.state).toBe('wave');
    let guard = 0;
    while (g.state === 'wave' && guard++ < 100) g.update(5000);
    wavesPlayed.push(g.wave);
  }
  return {
    state: g.state,
    wave: g.wave,
    highestWave: g.highestWave,
    coreHp: fxToFloat(g.coreHp()),
    currency: g.currency,
    wavesPlayed,
  };
}

describe('Game controller', () => {
  it('runs the build↔wave loop and makes progress', () => {
    const r = playScripted(1n, 5);
    // Either it survived multiple waves or the Core fell — both are legitimate outcomes,
    // but it must have advanced past wave 1 and terminated each wave cleanly.
    expect(r.highestWave).toBeGreaterThan(1);
    expect(['build', 'gameover']).toContain(r.state);
  });

  it('gates build actions to the build phase', () => {
    const g = new Game({ seed: 2n, config: cfg });
    g.buildTower({ x: 3, y: 6 }, Element.Fire, Tier.T1, NodeKind.Turret);
    g.startWave();
    expect(g.state).toBe('wave');
    const before = g.currency;
    // A build during the wave is refused (no currency spent).
    expect(g.buildWall({ x: 1, y: 3 })).toBe(false);
    expect(g.currency).toBe(before);
  });

  it('carries economy across waves (stipend + bounties)', () => {
    const g = new Game({ seed: 3n, config: cfg });
    g.buildTower({ x: 3, y: 6 }, Element.Fire, Tier.T2, NodeKind.Turret);
    const startCurrency = g.currency;
    g.startWave();
    let guard = 0;
    while (g.state === 'wave' && guard++ < 100) g.update(5000);
    if (g.state === 'build') {
      // Survived wave 1 → got at least the wave stipend on top of any bounties.
      expect(g.currency).toBeGreaterThanOrEqual(startCurrency - /*built T2*/ 45 + cfg.waveStipend);
      expect(g.wave).toBe(2);
    }
  });

  it('is fully deterministic for a fixed seed + scripted play', () => {
    const a = playScripted(99n, 5);
    const b = playScripted(99n, 5);
    expect(b).toEqual(a);
  });

  it('different seeds diverge (the attacker actually varies)', () => {
    const a = playScripted(1n, 4);
    const b = playScripted(2n, 4);
    // At difficulty 3 the top-K pick differs by seed, so runs should not be identical.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('personality changes how the search plays (same seed, different objective)', () => {
    const play = (personality: 'aggressive' | 'economic') => {
      const g = new Game({ starting: Element.Fire, difficulty: 3, seed: 77n, personality, config: cfg });
      g.buildTower({ x: 3, y: 6 }, Element.Fire, Tier.T2, NodeKind.Turret);
      g.startWave();
      let guard = 0;
      while (g.state === 'wave' && guard++ < 100) g.update(5000);
      return g.lastMetrics!;
    };
    const aggro = play('aggressive');
    const econ = play('economic');
    // Different objective weightings → the search commits different waves → different metrics.
    expect(JSON.stringify(aggro)).not.toBe(JSON.stringify(econ));
  });
});
