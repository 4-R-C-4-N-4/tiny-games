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
  it('burns for more total damage than an equal non-burn (Sonic) ward', () => {
    const fire = Sim.create(cfg, Element.Fire);
    fire.buildTower({ x: 3, y: 1 }, Element.Fire, Tier.T2, NodeKind.Turret);
    fire.spawnGroup(3, Element.Light, Trait.Tank, 1); // Light: neutral to both; a ground mob so Sonic's perks are inert

    const plain = Sim.create(cfg, Element.Sonic); // Sonic vs a ground Light Tank = plain DPS (anti-air/disrupt idle)
    plain.buildTower({ x: 3, y: 1 }, Element.Sonic, Tier.T2, NodeKind.Turret);
    plain.spawnGroup(3, Element.Light, Trait.Tank, 1);

    stepN(fire, 70); stepN(plain, 70);
    expect(hpOf(fire, Trait.Tank)).toBeLessThan(hpOf(plain, Trait.Tank));
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

describe('Earth (Geomancy) — wards are walls', () => {
  it('an Earth turret blocks the lane like a wall; a normal ward does not', () => {
    const s = Sim.create(cfg, Element.Earth);
    s.buildTower({ x: 3, y: 6 }, Element.Earth, Tier.T1, NodeKind.Turret); // Earth ward = wall
    s.attune(Element.Sonic);
    s.buildTower({ x: 4, y: 6 }, Element.Sonic, Tier.T1, NodeKind.Turret); // a normal ward
    s.syncFields();
    expect(s.grid.blocks({ x: 3, y: 6 })).toBe(true);
    expect(s.grid.blocks({ x: 4, y: 6 })).toBe(false);
  });

  it('an Earth turret is breachable — a blocked mob demolishes it', () => {
    const s = Sim.create(cfg, Element.Earth);
    s.player.currency = 5000;
    for (let x = 0; x < 7; x++) s.buildTower({ x, y: 8 }, Element.Earth, Tier.T1, NodeKind.Turret); // seal the row → mobs must breach
    s.syncFields();
    const gate = s.liveTowers().find((t) => t.cell.x === 3)!;
    gate.wallHp = fx(0.5); // pre-weaken the centre ward so the breach lands quickly
    const before = s.liveTowers().length;
    s.spawnGroup(3, Element.Light, Trait.Tank, 2); // tanks reach the wall and chew through it
    runUntil(s, (s) => s.liveTowers().length < before, 4000);
    expect(s.liveTowers().length).toBeLessThan(before); // the breached Earth ward was demolished
    expect(s.metricsSnapshot().breaches).toBeGreaterThanOrEqual(1);
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
    // Turret at column 2 (off the Breaker's column 3) so the Earth ward SHOOTS the breaker without
    // blocking its path — isolating the Breaker-bane from the new wall behaviour.
    const earth = Sim.create(cfg, Element.Earth);
    earth.buildTower({ x: 2, y: 1 }, Element.Earth, Tier.T2, NodeKind.Turret);
    earth.spawnGroup(3, Element.Light, Trait.Breaker, 1); // Light: neutral typing to both

    const plain = Sim.create(cfg, Element.Sonic); // Sonic T2: neutral to Light, and its perks (anti-air/disrupt) don't touch a ground Breaker
    plain.buildTower({ x: 2, y: 1 }, Element.Sonic, Tier.T2, NodeKind.Turret);
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
