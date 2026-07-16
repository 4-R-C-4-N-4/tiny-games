import { describe, it, expect } from 'vitest';
import { Sim } from './sim.ts';
import { Element } from './element.ts';
import { UNREACHABLE } from './fields.ts';
import { DEFAULT_CONFIG } from './config.ts';

const cfg = { ...DEFAULT_CONFIG };
const spawn = { x: 3, y: 0 };

function fresh() {
  return Sim.create(cfg, Element.Fire); // 7×12, Core at (3,11)
}

describe('flow fields — open grid', () => {
  it('distCore is the straight-line distance with no walls', () => {
    const s = fresh();
    expect(s.fields.distCore(s.grid, spawn)).toBe(11); // (3,0) → (3,11)
    expect(s.fields.distCore(s.grid, s.grid.coreCell())).toBe(0);
  });

  it('stepWalled descends toward the Core; Core yields null (arrived)', () => {
    const s = fresh();
    expect(s.fields.stepWalled(s.grid, spawn)).toEqual({ x: 3, y: 1 });
    expect(s.fields.stepWalled(s.grid, s.grid.coreCell())).toBeNull();
  });

  it('no wall in the way ⇒ no breach target', () => {
    const s = fresh();
    expect(s.fields.breachTarget(s.grid, spawn)).toBeNull();
  });
});

describe('flow fields — a wall detour lengthens the route', () => {
  it('walling a row (with one gap) increases distCore', () => {
    const s = fresh();
    const before = s.fields.distCore(s.grid, spawn);
    // Wall all of row y=6 except the far-right gap at x=6.
    for (let x = 0; x < 6; x++) s.buildWall({ x, y: 6 });
    s.syncFields();
    const after = s.fields.distCore(s.grid, spawn);
    expect(after).toBeGreaterThan(before);
    // The mob must first head toward the gap, not straight down through the wall.
    const next = s.fields.stepWalled(s.grid, { x: 3, y: 5 });
    expect(next).not.toBeNull();
    expect(s.grid.blocks(next!)).toBe(false); // never steps onto a wall
  });
});

describe('flow fields — sealing the Core forces a breach', () => {
  it('a sealed Core is UNREACHABLE and yields a breach target on the open gradient', () => {
    const s = fresh();
    // Wall every passable neighbour of the Core (3,11): (2,11),(4,11),(3,10).
    s.buildWall({ x: 2, y: 11 });
    s.buildWall({ x: 4, y: 11 });
    s.buildWall({ x: 3, y: 10 });
    s.syncFields();

    expect(s.fields.distCore(s.grid, spawn)).toBe(UNREACHABLE);
    // The straight-down open route hits the wall directly above the Core first.
    expect(s.fields.breachTarget(s.grid, spawn)).toEqual({ x: 3, y: 10 });
    // A blocked mob can't step the walled field at all.
    expect(s.fields.stepWalled(s.grid, spawn)).toBeNull();
  });
});
