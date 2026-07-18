import { describe, it, expect } from 'vitest';
import { Sim } from './sim.ts';
import { Element } from './element.ts';
import { Trait, Tier, NodeKind } from './types.ts';
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
