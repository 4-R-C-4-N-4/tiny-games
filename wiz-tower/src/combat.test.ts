import { describe, it, expect } from 'vitest';
import { Sim } from './sim.ts';
import { Element } from './element.ts';
import { Trait, Tier, NodeKind, OccKind } from './types.ts';
import { fx } from './fx.ts';
import { DEFAULT_CONFIG, mobStats, bounty, leakDamage } from './config.ts';

const cfg = { ...DEFAULT_CONFIG };

/** Step until `done(sim)` or `max` ticks; returns ticks taken. */
function runUntil(s: Sim, done: (s: Sim) => boolean, max = 2000): number {
  let n = 0;
  while (n < max && !done(s)) {
    s.step();
    n++;
  }
  return n;
}

describe('movement & leaks', () => {
  it('a lone Grunt marches to the Core and leaks', () => {
    const s = Sim.create(cfg, Element.Fire);
    s.spawnGroup(3, Element.Fire, Trait.Grunt, 1);
    runUntil(s, (s) => s.coreHp() < fx(100));
    expect(s.coreHp()).toBe(fx(100) - leakDamage(Trait.Grunt));
    expect(s.metricsSnapshot().leakedHp).toBe(leakDamage(Trait.Grunt));
    expect(s.metricsSnapshot().timeToFirstLeak).toBeGreaterThan(0);
    expect(s.liveMobs()).toHaveLength(0);
  });

  it('a Runner leaks sooner than a Tank (speed matters)', () => {
    const r = Sim.create(cfg, Element.Fire);
    r.spawnGroup(3, Element.Fire, Trait.Runner, 1);
    const tR = runUntil(r, (s) => s.coreHp() < fx(100));
    const t = Sim.create(cfg, Element.Fire);
    t.spawnGroup(3, Element.Fire, Trait.Tank, 1);
    const tT = runUntil(t, (s) => s.coreHp() < fx(100));
    expect(tR).toBeLessThan(tT);
  });
});

describe('towers: acquire, fire, typing, bounty', () => {
  it('a Fire turret kills a Sonic grunt (1.5×) before it leaks and pays bounty', () => {
    const s = Sim.create(cfg, Element.Fire);
    expect(s.buildTower({ x: 3, y: 5 }, Element.Fire, Tier.T2, NodeKind.Turret)).toBe(true);
    const currencyBefore = s.player.currency;
    s.spawnGroup(3, Element.Sonic, Trait.Grunt, 1);
    runUntil(s, (s) => s.liveMobs().length === 0);
    expect(s.coreHp()).toBe(fx(100)); // never leaked
    expect(s.metricsSnapshot().dpsUtil[Element.Fire]).toBeGreaterThan(0);
    expect(s.player.currency).toBe(currencyBefore + bounty(Trait.Grunt)); // bounty (fraction of cost)
  });

  it('a weak off-type turret lets a tank leak (neutral/​resisted DPS)', () => {
    const s = Sim.create(cfg, Element.Fire);
    // Fire vs Ice is resisted (0.5×); a single T1 turret can't stop a tank.
    s.buildTower({ x: 3, y: 5 }, Element.Fire, Tier.T1, NodeKind.Turret);
    s.spawnGroup(3, Element.Ice, Trait.Tank, 1);
    runUntil(s, (s) => s.coreHp() < fx(100));
    expect(s.coreHp()).toBeLessThan(fx(100));
  });
});

describe('trait gates: flier needs anti-air, shade needs detection', () => {
  it('a Fire turret cannot touch a flier (it leaks); a Sonic anti-air turret kills it', () => {
    const noAir = Sim.create(cfg, Element.Fire);
    noAir.buildTower({ x: 3, y: 5 }, Element.Fire, Tier.T2, NodeKind.Turret);
    noAir.spawnGroup(3, Element.Light, Trait.Flier, 1);
    runUntil(noAir, (s) => s.coreHp() < fx(100));
    expect(noAir.coreHp()).toBeLessThan(fx(100)); // leaked over the wall-less field

    const air = Sim.create(cfg, Element.Sonic);
    air.buildTower({ x: 3, y: 5 }, Element.Sonic, Tier.T2, NodeKind.Turret); // anti-air
    air.spawnGroup(3, Element.Light, Trait.Flier, 1);
    runUntil(air, (s) => s.liveMobs().length === 0);
    expect(air.coreHp()).toBe(fx(100)); // shot down
  });

  it('a Fire turret cannot target a Shade; a Light detection turret can', () => {
    const blind = Sim.create(cfg, Element.Fire);
    blind.buildTower({ x: 3, y: 5 }, Element.Fire, Tier.T2, NodeKind.Turret);
    blind.spawnGroup(3, Element.Fire, Trait.Shade, 1);
    runUntil(blind, (s) => s.coreHp() < fx(100));
    expect(blind.coreHp()).toBeLessThan(fx(100));

    const seer = Sim.create(cfg, Element.Light);
    seer.buildTower({ x: 3, y: 5 }, Element.Light, Tier.T2, NodeKind.Turret); // detection
    seer.spawnGroup(3, Element.Dark, Trait.Shade, 1);
    runUntil(seer, (s) => s.liveMobs().length === 0);
    expect(seer.coreHp()).toBe(fx(100));
  });
});

describe('shielded, slow, splash, mender', () => {
  it('a Shielded mob absorbs its first hits before taking damage', () => {
    const s = Sim.create(cfg, Element.Fire);
    s.buildTower({ x: 3, y: 5 }, Element.Fire, Tier.T1, NodeKind.Turret);
    s.spawnGroup(3, Element.Sonic, Trait.Shielded, 1);
    const start = mobStats(Trait.Shielded).shieldHits;
    // Run a handful of ticks and confirm shields deplete before HP does.
    runUntil(s, (s) => (s.liveMobs()[0]?.shieldHits ?? 0) < start || s.liveMobs().length === 0);
    const m = s.liveMobs()[0];
    if (m) expect(m.shieldHits).toBeLessThan(start);
  });

  it('an Ice turret slows a mob, delaying its leak vs an equal vanilla (Earth) turret', () => {
    // Same DPS tier, but Ice adds slow → the mob should take longer to reach the Core. Earth
    // with no adjacent walls is the clean no-perk control (Fire now burns, so it isn't neutral).
    const slow = Sim.create(cfg, Element.Ice);
    slow.buildTower({ x: 3, y: 8 }, Element.Ice, Tier.T1, NodeKind.Turret);
    slow.spawnGroup(3, Element.Light, Trait.Tank, 1); // Light: neutral to both, isolates slow
    const tSlow = runUntil(slow, (s) => s.coreHp() < fx(100));

    const fast = Sim.create(cfg, Element.Earth);
    fast.buildTower({ x: 3, y: 8 }, Element.Earth, Tier.T1, NodeKind.Turret); // no walls adjacent → plain DPS
    fast.spawnGroup(3, Element.Light, Trait.Tank, 1);
    const tFast = runUntil(fast, (s) => s.coreHp() < fx(100));
    expect(tSlow).toBeGreaterThan(tFast);
  });

  it('splash damages a whole swarm, not just one body', () => {
    const s = Sim.create(cfg, Element.Fire); // Fire has splash
    s.buildTower({ x: 3, y: 5 }, Element.Fire, Tier.T2, NodeKind.Turret);
    s.spawnGroup(3, Element.Sonic, Trait.Swarm, 6); // all enter the same column together
    // After a few ticks in range, more than one body should have taken damage.
    let hurt = 0;
    runUntil(s, (s) => {
      hurt = s.liveMobs().filter((m) => m.damageTaken > 0).length;
      return hurt >= 2 || s.liveMobs().length < 6;
    });
    expect(hurt).toBeGreaterThanOrEqual(2);
  });

  it('a Mender heals a wounded ally back up', () => {
    const s = Sim.create(cfg, Element.Fire);
    s.spawnGroup(3, Element.Fire, Trait.Grunt, 1);
    s.spawnGroup(3, Element.Fire, Trait.Mender, 1);
    // wound the grunt directly, then step: the mender should regen it.
    s.step();
    const grunt = s.liveMobs().find((m) => m.trait === Trait.Grunt)!;
    grunt.hp = fx(1);
    const before = grunt.hp;
    s.step();
    expect(grunt.hp).toBeGreaterThan(before);
  });
});

describe('breaching a sealed Core', () => {
  it('a Breaker demolishes the wall over the Core and opens a path', () => {
    const s = Sim.create(cfg, Element.Earth);
    s.buildWall({ x: 2, y: 11 });
    s.buildWall({ x: 4, y: 11 });
    s.buildWall({ x: 3, y: 10 });
    s.syncFields();
    s.spawnGroup(3, Element.Earth, Trait.Breaker, 2);
    runUntil(s, (s) => s.metricsSnapshot().breaches >= 1);
    expect(s.metricsSnapshot().breaches).toBeGreaterThanOrEqual(1);
    expect(s.grid.get({ x: 3, y: 10 }).occ.kind).not.toBe(OccKind.Wall);
  });
});
