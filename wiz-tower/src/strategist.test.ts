import { describe, it, expect } from 'vitest';
import { Game } from './game.ts';
import { Element } from './element.ts';
import { Tier, NodeKind, Trait } from './types.ts';
import { fxToFloat } from './fx.ts';
import { DEFAULT_CONFIG } from './config.ts';

const cfg = { ...DEFAULT_CONFIG, startCurrency: 800 };

/** Play `waves` waves against a Fire-only defense (no anti-air, no detection), recording
 *  the Strategist's stated intent and how many Drakes (fliers) it summoned each wave. */
function playMind(seed: bigint, waves: number) {
  const g = new Game({ starting: Element.Fire, difficulty: 3, seed, opponent: 'strategist', config: cfg });
  const intents: string[] = [];
  const fliers: number[] = [];
  for (let w = 0; w < waves && g.state !== 'gameover'; w++) {
    // Reinforce a pure-Fire defense on the LEFT — never any anti-air/detection.
    g.buildTower({ x: 1, y: 5 + w }, Element.Fire, Tier.T1, NodeKind.Turret);
    g.buildTower({ x: 2, y: 6 }, Element.Fire, Tier.T1, NodeKind.Turret);
    g.startWave();
    intents.push(g.attackerIntent);
    let guard = 0;
    while (g.state === 'wave' && guard++ < 300) g.update(5000);
    const rc = g.lastRecap;
    let f = 0;
    if (rc) {
      for (const s of rc.telegraph) if (s.group.trait === Trait.Flier) f += s.group.count;
      for (const cs of rc.committed) for (const c of cs) if (c.group.trait === Trait.Flier) f += c.group.count;
    }
    fliers.push(f);
  }
  return { intents, fliers, wave: g.wave, coreHp: fxToFloat(g.coreHp()), currency: g.currency, state: g.state };
}

describe('StrategistAttacker (L3 cross-wave mind)', () => {
  it('names the chronic type gap it reads (Fire defense answers Ice weakly)', () => {
    const r = playMind(1n, 3);
    // effective coverage vs Ice is lowest for a Fire-only defense (Fire is weak into Ice),
    // so the mind should call out the thin Ice ward from the very first wave.
    expect(r.intents[0]).toMatch(/Ice ward/);
    expect(r.intents[0]).toMatch(/^The Adversary /);
  });

  it('escalates air pressure across waves when anti-air never appears', () => {
    const r = playMind(2n, 4);
    // By the 2nd+ consecutive open-sky wave it should be massing Drakes…
    expect(r.intents.slice(1).some((s) => /Drakes/.test(s))).toBe(true);
    // …and it should actually field air (some fliers summoned over the run).
    expect(r.fliers.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('is fully deterministic for a fixed seed + scripted play', () => {
    const a = playMind(7n, 3);
    const b = playMind(7n, 3);
    expect(b).toEqual(a);
  });

  it('different seeds diverge', () => {
    const a = playMind(1n, 3);
    const b = playMind(9n, 3);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
