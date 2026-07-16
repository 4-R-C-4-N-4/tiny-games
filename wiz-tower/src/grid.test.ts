import { describe, it, expect } from 'vitest';
import { Grid } from './grid.ts';
import { OccKind } from './types.ts';

describe('Grid.basic', () => {
  const g = Grid.basic(7, 12);

  it('has a single Core at bottom-centre', () => {
    expect(g.coreCell()).toEqual({ x: 3, y: 11 });
  });

  it('has a full top-row spawn band', () => {
    const spawns = g.spawnCells();
    expect(spawns).toHaveLength(7);
    expect(spawns.every((c) => c.y === 0)).toBe(true);
  });

  it('Core and Spawn are non-buildable; interior is buildable', () => {
    expect(g.get({ x: 3, y: 11 }).buildable).toBe(false); // core
    expect(g.get({ x: 0, y: 0 }).buildable).toBe(false); // spawn
    expect(g.get({ x: 2, y: 5 }).buildable).toBe(true); // interior
  });

  it('only walls block; empty/spawn/core/tower do not', () => {
    expect(g.blocks({ x: 2, y: 5 })).toBe(false);
    g.setOcc({ x: 2, y: 5 }, { kind: OccKind.Wall, hp: 100 });
    expect(g.blocks({ x: 2, y: 5 })).toBe(true);
    g.setOcc({ x: 2, y: 5 }, { kind: OccKind.Empty });
    expect(g.blocks({ x: 2, y: 5 })).toBe(false);
  });

  it('inBounds guards edges', () => {
    expect(g.inBounds({ x: -1, y: 0 })).toBe(false);
    expect(g.inBounds({ x: 7, y: 0 })).toBe(false);
    expect(g.inBounds({ x: 6, y: 11 })).toBe(true);
  });
});
