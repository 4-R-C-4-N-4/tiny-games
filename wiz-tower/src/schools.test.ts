import { describe, it, expect } from 'vitest';
import { Sim } from './sim.ts';
import { Element } from './element.ts';
import { Trait, Tier, NodeKind } from './types.ts';
import { fx } from './fx.ts';
import { DEFAULT_CONFIG, mobStats, bounty, harvestBonus } from './config.ts';

const cfg = { ...DEFAULT_CONFIG };

function runUntil(s: Sim, done: (s: Sim) => boolean, max = 2000): number {
  let n = 0;
  while (n < max && !done(s)) { s.step(); n++; }
  return n;
}

describe('Resonance (Sonic): disruption', () => {
  it('shatters a whole shield on the first hit; a plain ward only chips one at a time', () => {
    const start = mobStats(Trait.Shielded).shieldHits; // 3

    // Sonic (disrupt): first contact zeroes the ward and damage flows through the same tick.
    const son = Sim.create(cfg, Element.Sonic);
    son.buildTower({ x: 3, y: 5 }, Element.Sonic, Tier.T2, NodeKind.Turret);
    son.spawnGroup(3, Element.Light, Trait.Shielded, 1); // Light: neutral to both, isolates the shield rule
    runUntil(son, (s) => (s.liveMobs()[0]?.damageTaken ?? 0) > 0 || s.liveMobs().length === 0);
    const sm = son.liveMobs()[0];
    if (sm) { expect(sm.shieldHits).toBe(0); expect(sm.hp).toBeLessThan(sm.maxHp); }

    // Fire (no disrupt): the shield absorbs a whole hit; HP is untouched while any ward remains.
    const fir = Sim.create(cfg, Element.Fire);
    fir.buildTower({ x: 3, y: 5 }, Element.Fire, Tier.T2, NodeKind.Turret);
    fir.spawnGroup(3, Element.Light, Trait.Shielded, 1);
    runUntil(fir, (s) => (s.liveMobs()[0]?.shieldHits ?? start) < start || s.liveMobs().length === 0);
    const fm = fir.liveMobs()[0];
    if (fm) { expect(fm.shieldHits).toBe(start - 1); expect(fm.hp).toBe(fm.maxHp); }
  });

  it('hushes a Mender in its aura: the wounded ally is not healed', () => {
    // Control: no disrupt anywhere → the Mender heals its wounded ally.
    const ctl = Sim.create(cfg, Element.Fire);
    ctl.spawnGroup(3, Element.Fire, Trait.Shade, 1); // stealth, so no ward can damage it in either sim
    ctl.spawnGroup(3, Element.Fire, Trait.Mender, 1);
    ctl.step();
    const cShade = ctl.liveMobs().find((m) => m.trait === Trait.Shade)!;
    cShade.hp = fx(1); const cBefore = cShade.hp;
    ctl.step();
    expect(cShade.hp).toBeGreaterThan(cBefore); // healed

    // Disrupted: a Sonic ward covers the spawn → the Mender is silenced and the ally stays wounded.
    const dis = Sim.create(cfg, Element.Sonic);
    expect(dis.buildTower({ x: 3, y: 1 }, Element.Sonic, Tier.T2, NodeKind.Turret)).toBe(true);
    dis.spawnGroup(3, Element.Fire, Trait.Shade, 1); // stealth → the Sonic ward can't damage it (isolates the heal)
    dis.spawnGroup(3, Element.Fire, Trait.Mender, 1);
    dis.step();
    const dShade = dis.liveMobs().find((m) => m.trait === Trait.Shade)!;
    dShade.hp = fx(1); const dBefore = dShade.hp;
    dis.step();
    expect(dShade.hp).toBe(dBefore); // NOT healed — the Mender's channel is hushed
  });
});

describe('Umbra (Dark): harvest', () => {
  it("a Dark ward's kill pays a bonus bounty; other schools pay only the base", () => {
    const dark = Sim.create(cfg, Element.Dark);
    dark.buildTower({ x: 3, y: 5 }, Element.Dark, Tier.T2, NodeKind.Turret);
    const before = dark.player.currency;
    dark.spawnGroup(3, Element.Light, Trait.Grunt, 1); // Dark↔Light mutual (1.5×) — killed before it leaks
    runUntil(dark, (s) => s.liveMobs().length === 0);
    expect(dark.coreHp()).toBe(fx(100));
    expect(dark.player.currency).toBe(before + bounty(Trait.Grunt) + harvestBonus(Trait.Grunt));

    const fire = Sim.create(cfg, Element.Fire);
    fire.buildTower({ x: 3, y: 5 }, Element.Fire, Tier.T2, NodeKind.Turret);
    const before2 = fire.player.currency;
    fire.spawnGroup(3, Element.Light, Trait.Grunt, 1);
    runUntil(fire, (s) => s.liveMobs().length === 0);
    expect(fire.player.currency).toBe(before2 + bounty(Trait.Grunt)); // no harvest
  });
});
