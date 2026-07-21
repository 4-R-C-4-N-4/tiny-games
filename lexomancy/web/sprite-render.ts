import { ALT_GRIDS, GRIDS, type Palette, type SpriteArt, type SpriteGrid } from '../src/sprites.ts';

// Canvas rendering for the pixel grids. Sprites are drawn once per
// (slot, art, palette) and cached — palettes only change per floor/rite, and
// re-rendering the SAME slot reuses its element so an idle-bob/wing-flap
// animation doesn't restart every render() pass. The slot exists because a
// DOM node can only live in one place at a time: if two different UI spots
// (e.g. the live battle view and a death-screen overlay) want the same
// visual (identical art+palette) at once, caching by (art, palette) alone
// hands out the SAME node to both, and whichever renders second silently
// steals it out of the other's container. Callers pass their holder's own
// id as the slot so concurrent spots never collide.

const cache = new Map<string, HTMLCanvasElement>();
const animCache = new Map<string, HTMLElement>();

function drawGrid(grid: SpriteGrid, palette: Palette, scale: number): HTMLCanvasElement {
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
  return canvas;
}

export function spriteCanvas(art: SpriteArt, palette: Palette, scale = 5, slot = 'default'): HTMLCanvasElement {
  const key = `${slot}:${art}:${scale}:${JSON.stringify(palette)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = drawGrid(GRIDS[art], palette, scale);
  cache.set(key, canvas);
  return canvas;
}

/**
 * Two-frame animated sprite: frame B is the hand-drawn alt grid where one
 * exists (wing flap), otherwise the base grid with the pulsed palette. CSS
 * hard-toggles the frames; the element is cached so re-renders don't restart
 * the animation.
 */
export function spriteAnim(
  art: SpriteArt,
  frameA: Palette,
  frameB: Palette,
  scale = 5,
  slot = 'default',
): HTMLElement {
  const key = `${slot}:${art}:${scale}:${JSON.stringify(frameA)}`;
  const hit = animCache.get(key);
  if (hit) return hit;
  const el = document.createElement('div');
  el.className = 'sprite-anim';
  const a = drawGrid(GRIDS[art], frameA, scale);
  const b = drawGrid(ALT_GRIDS[art] ?? GRIDS[art], frameB, scale);
  a.classList.add('frame-a');
  b.classList.add('frame-b');
  el.append(a, b);
  animCache.set(key, el);
  return el;
}
