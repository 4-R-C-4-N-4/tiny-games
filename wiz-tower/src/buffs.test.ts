import { describe, it, expect } from 'vitest';
import { Sim } from './sim.ts';
import { Element } from './element.ts';
import { Trait, Tier, NodeKind } from './types.ts';
import { fx } from './fx.ts';
import { DEFAULT_CONFIG } from './config.ts';

const cfg = { ...DEFAULT_CONFIG };
const hpOf = (s: Sim, trait: Trait) => { const m = s.liveMobs().find((x) => x.trait === trait); return m ? m.hp : 0; };
const stepN = (s: Sim, n: number) => { for (let i = 0; i < n; i++) s.step(); };
const runUntil = (s: Sim, done: (s: Sim) => boolean, max = 2000) => { let n = 0; while (n < max && !done(s)) { s.step(); n++; } return n; };

describe('Fire (Pyromancy) — burning DoT', () => {
  it('burns for more total damage than an equal non-burn (Earth) ward', () => {
    const fire = Sim.create(cfg, Element.Fire);
    fire.buildTower({ x: 3, y: 1 }, Element.Fire, Tier.T2, NodeKind.Turret);
    fire.spawnGroup(3, Element.Light, Trait.Tank, 1); // Light: neutral to both Fire and Earth

    const earth = Sim.create(cfg, Element.Earth);
    earth.buildTower({ x: 3, y: 1 }, Element.Earth, Tier.T2, NodeKind.Turret); // no adjacent walls → vanilla
    earth.spawnGroup(3, Element.Light, Trait.Tank, 1);

    stepN(fire, 70); stepN(earth, 70);
    expect(hpOf(fire, Trait.Tank)).toBeLessThan(hpOf(earth, Trait.Tank));
  });

  it('keeps burning after the ward is gone', () => {
    const s = Sim.create(cfg, Element.Fire);
    s.buildTower({ x: 3, y: 1 }, Element.Fire, Tier.T2, NodeKind.Turret);
    s.spawnGroup(3, Element.Light, Trait.Tank, 1);
    stepN(s, 6); // hit + ignited
    const m = s.liveMobs()[0];
    expect(m.burnTicks).toBeGreaterThan(0);
    s.sell({ x: 3, y: 1 }); // remove the only tower — no direct damage can occur now
    const before = m.hp;
    s.step();
    expect(m.hp).toBeLessThan(before); // the burn ticked anyway
  });
});

describe('Earth (Geomancy) — wall channeling', () => {
  it('an Earth ward hits harder with adjacent walls', () => {
    const walled = Sim.create(cfg, Element.Earth);
    walled.buildTower({ x: 3, y: 1 }, Element.Earth, Tier.T2, NodeKind.Turret);
    walled.buildWall({ x: 2, y: 1 }); walled.buildWall({ x: 4, y: 1 }); // 2 adjacent walls, OFF the column-3 path
    walled.syncFields();
    walled.spawnGroup(3, Element.Light, Trait.Tank, 1);

    const bare = Sim.create(cfg, Element.Earth);
    bare.buildTower({ x: 3, y: 1 }, Element.Earth, Tier.T2, NodeKind.Turret);
    bare.spawnGroup(3, Element.Light, Trait.Tank, 1);

    stepN(walled, 70); stepN(bare, 70);
    expect(hpOf(walled, Trait.Tank)).toBeLessThan(hpOf(bare, Trait.Tank));
  });
});

describe('Radiance (Light) — purge', () => {
  it('purges a Warden — its ward no longer protects the escort', () => {
    // Turret (col 2) shoots the grunt (col 3); Warden rides col 4 warding the grunt. A Light
    // ward at col 5 covers the Warden (not the grunt) → the ward is purged.
    const purged = Sim.create(cfg, Element.Fire);
    purged.buildTower({ x: 2, y: 1 }, Element.Fire, Tier.T1, NodeKind.Turret);
    purged.attune(Element.Light);
    purged.buildTower({ x: 5, y: 1 }, Element.Light, Tier.T1, NodeKind.Turret); // covers the Warden, not the grunt
    purged.spawnGroup(3, Element.Light, Trait.Grunt, 1);
    purged.spawnGroup(4, Element.Light, Trait.Warden, 1);

    const warded = Sim.create(cfg, Element.Fire); // no Light → Warden's aura intact
    warded.buildTower({ x: 2, y: 1 }, Element.Fire, Tier.T1, NodeKind.Turret);
    warded.spawnGroup(3, Element.Light, Trait.Grunt, 1);
    warded.spawnGroup(4, Element.Light, Trait.Warden, 1);

    for (let i = 0; i < 24; i++) { purged.step(); warded.step(); }
    expect(hpOf(purged, Trait.Grunt)).toBeLessThan(hpOf(warded, Trait.Grunt)); // purge stripped the protection
  });

  it('purges a Mender — it cannot heal in a Light ward\'s range', () => {
    // Control: no purge → the Mender heals a wounded Flier (untouchable — no anti-air anywhere).
    const ctl = Sim.create(cfg, Element.Fire);
    ctl.spawnGroup(3, Element.Fire, Trait.Flier, 1);
    ctl.spawnGroup(3, Element.Fire, Trait.Mender, 1);
    ctl.step();
    const cF = ctl.liveMobs().find((m) => m.trait === Trait.Flier)!;
    cF.hp = fx(1); const cBefore = cF.hp; ctl.step();
    expect(cF.hp).toBeGreaterThan(cBefore);

    // Purge: a Light ward over the spawn silences the Mender (it can't reach the flier: no anti-air).
    const pur = Sim.create(cfg, Element.Light);
    expect(pur.buildTower({ x: 3, y: 1 }, Element.Light, Tier.T2, NodeKind.Turret)).toBe(true);
    pur.spawnGroup(3, Element.Fire, Trait.Flier, 1);
    pur.spawnGroup(3, Element.Fire, Trait.Mender, 1);
    pur.step();
    const pF = pur.liveMobs().find((m) => m.trait === Trait.Flier)!;
    pF.hp = fx(1); const pBefore = pF.hp; pur.step();
    expect(pF.hp).toBe(pBefore); // not healed
  });
});

describe('Earth (Geomancy) — Breaker bane', () => {
  it('an Earth ward shatters a Breaker far faster than a vanilla ward', () => {
    const earth = Sim.create(cfg, Element.Earth);
    earth.buildTower({ x: 3, y: 1 }, Element.Earth, Tier.T2, NodeKind.Turret); // no adjacent walls → isolates the Breaker bane
    earth.spawnGroup(3, Element.Light, Trait.Breaker, 1); // Light: neutral typing to both

    const plain = Sim.create(cfg, Element.Sonic); // Sonic T2: neutral to Light, and its perks (anti-air/disrupt) don't touch a ground Breaker
    plain.buildTower({ x: 3, y: 1 }, Element.Sonic, Tier.T2, NodeKind.Turret);
    plain.spawnGroup(3, Element.Light, Trait.Breaker, 1);

    stepN(earth, 20); stepN(plain, 20);
    expect(hpOf(earth, Trait.Breaker)).toBeLessThan(hpOf(plain, Trait.Breaker));
  });
});

describe('Umbra (Dark) — kill ramp', () => {
  it('a Dark ward accrues kills', () => {
    const s = Sim.create(cfg, Element.Dark);
    s.buildTower({ x: 3, y: 1 }, Element.Dark, Tier.T2, NodeKind.Turret);
    s.spawnGroup(3, Element.Light, Trait.Swarm, 4); // Dark↔Light 1.5× — it mows them down
    runUntil(s, (s) => s.liveMobs().length === 0);
    expect(s.liveTowers()[0].kills).toBeGreaterThan(0);
  });

  it('a ramped Dark ward out-damages a fresh one', () => {
    const ramped = Sim.create(cfg, Element.Dark);
    ramped.buildTower({ x: 3, y: 1 }, Element.Dark, Tier.T2, NodeKind.Turret);
    ramped.liveTowers()[0].kills = 15; // as if it had farmed a lane
    ramped.spawnGroup(3, Element.Light, Trait.Tank, 1);

    const fresh = Sim.create(cfg, Element.Dark);
    fresh.buildTower({ x: 3, y: 1 }, Element.Dark, Tier.T2, NodeKind.Turret); // 0 kills
    fresh.spawnGroup(3, Element.Light, Trait.Tank, 1);

    stepN(ramped, 40); stepN(fresh, 40);
    expect(hpOf(ramped, Trait.Tank)).toBeLessThan(hpOf(fresh, Trait.Tank));
  });
});
