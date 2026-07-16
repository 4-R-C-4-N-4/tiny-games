import { describe, it, expect } from 'vitest';
import { Sim } from './sim.ts';
import { Element } from './element.ts';
import { Trait, Tier, NodeKind } from './types.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { parseWave, PlanAttacker } from './wave.ts';
import { playWave } from './driver.ts';

const cfg = { ...DEFAULT_CONFIG };

function defended(): Sim {
  const s = Sim.create(cfg, Element.Fire);
  s.buildWall({ x: 3, y: 5 });
  s.buildTower({ x: 3, y: 6 }, Element.Fire, Tier.T2, NodeKind.Turret);
  s.syncFields();
  return s;
}

const WAVE = `WAVE budget=100 diff=1
OPEN
  SPAWN t=0.0 x=3 SONIC GRUNT x4
  SPAWN t=0.5 x=2 FIRE SWARM x5
RESERVE pool=0
`;

describe('Sim.clone', () => {
  it('a fork plays a wave identically to the original', () => {
    const a = defended();
    const b = a.clone();
    const wave = parseWave(WAVE, { gridW: a.grid.w, gridH: a.grid.h });
    const mA = playWave(a, new PlanAttacker(wave), 1, 1);
    const mB = playWave(b, new PlanAttacker(wave), 1, 1);
    expect(mB).toEqual(mA);
    expect(b.coreHp()).toBe(a.coreHp());
    expect(b.tick).toBe(a.tick);
  });

  it('mutating a fork does not touch the original', () => {
    const a = defended();
    a.spawnGroup(3, Element.Sonic, Trait.Grunt, 2);
    const b = a.clone();
    // advance only the fork
    for (let i = 0; i < 50; i++) b.step();
    expect(b.tick).toBe(50);
    expect(a.tick).toBe(0);
    // the original still has its two live mobs at the spawn band; the fork moved/killed
    expect(a.liveMobs()).toHaveLength(2);
    expect(a.liveMobs()[0].pos.y).not.toBe(b.mobs[0]?.pos.y ?? -1);
    // grids are independent objects
    a.buildWall({ x: 1, y: 8 });
    expect(a.grid.blocks({ x: 1, y: 8 })).toBe(true);
    expect(b.grid.blocks({ x: 1, y: 8 })).toBe(false);
  });

  it('a fork mid-wave continues deterministically alongside the original', () => {
    const a = defended();
    a.beginWave([], 0, 1, 1);
    a.spawnGroup(3, Element.Sonic, Trait.Grunt, 3);
    for (let i = 0; i < 30; i++) a.step();
    const b = a.clone();
    for (let i = 0; i < 60; i++) { a.step(); b.step(); }
    expect(b.coreHp()).toBe(a.coreHp());
    expect(b.metricsSnapshot()).toEqual(a.metricsSnapshot());
  });
});
