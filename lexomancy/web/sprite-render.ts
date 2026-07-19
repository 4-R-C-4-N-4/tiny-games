import { GRIDS, type Palette, type SpriteArt } from '../src/sprites.ts';

// Canvas rendering for the pixel grids. Sprites are drawn once per
// (art, palette) pair and cached — palettes only change per floor/rite.

const cache = new Map<string, HTMLCanvasElement>();

export function spriteCanvas(art: SpriteArt, palette: Palette, scale = 5): HTMLCanvasElement {
  const key = `${art}:${scale}:${JSON.stringify(palette)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const grid = GRIDS[art];
  const rows = grid.length;
  const cols = grid[0].length;
  const canvas = document.createElement('canvas');
  canvas.width = cols * scale;
  canvas.height = rows * scale;
  canvas.className = 'pixel-sprite';
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = grid[y][x] as keyof Palette | '.';
      if (ch === '.') continue;
      ctx.fillStyle = palette[ch] ?? '#ff00ff';
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  cache.set(key, canvas);
  return canvas;
}
