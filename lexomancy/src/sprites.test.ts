import { describe, expect, it } from 'vitest';
import { GRIDS, enemyPalette, playerPalette } from './sprites.ts';
import { STATS } from './stats.ts';

const KNOWN = new Set(['.', 'o', 'p', 'P', 'b', 'g', 'a', 'm', 'w']);

describe('sprite grids', () => {
  it('every grid is rectangular and uses only known palette chars', () => {
    for (const [name, grid] of Object.entries(GRIDS)) {
      const width = grid[0].length;
      for (const [y, row] of grid.entries()) {
        expect(row.length, `${name} row ${y}`).toBe(width);
        for (const ch of row) expect(KNOWN.has(ch), `${name} row ${y} char ${ch}`).toBe(true);
      }
    }
  });

  it('palettes cover every non-transparent char', () => {
    const pal = enemyPalette('necromancer', 40);
    for (const grid of Object.values(GRIDS)) {
      for (const row of grid) {
        for (const ch of row) {
          if (ch === '.') continue;
          expect(pal[ch as keyof typeof pal], ch).toBeDefined();
        }
      }
    }
  });

  it('theme hue changes accents but not the class robe', () => {
    const a = enemyPalette('necromancer', 0);
    const b = enemyPalette('necromancer', 190);
    expect(a.a).not.toBe(b.a);
    expect(a.g).not.toBe(b.g);
    expect(a.p).toBe(b.p);
  });

  it('every stat has a distinct player cloak', () => {
    const cloaks = new Set(STATS.map((s) => playerPalette(s).p));
    expect(cloaks.size).toBe(STATS.length);
  });
});
