import type { TarotCard, Suit } from './types';
import { DeterministicRandom, seedFromString } from './engine';

// Procedural card sigils: a mirrored half-grid of noise smoothed into a
// blot-like glyph. Majors sweep the full hue wheel (golden-angle steps);
// each minor suit lives in its element's color family. Same card, same art.
const W = 14;
const H = 22;
const HALF = W / 2;

const SUIT_HUE: Record<Exclude<Suit, 'major'>, number> = {
  wands: 18,      // fire — ember orange
  cups: 210,      // water — deep blue
  swords: 265,    // air — steel violet
  pentacles: 130, // earth — leaf green
};

const cache = new Map<string, string>();

export function cardArt(card: TarotCard, px = 8): string {
  const key = `${card.id}:${px}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rng = new DeterministicRandom((seedFromString(card.id) * 2654435761) % 4294967296);
  let grid: number[][] = Array.from({ length: H }, () =>
    Array.from({ length: HALF }, () => (rng.next() < 0.44 ? 1 : 0)),
  );

  for (let pass = 0; pass < 2; pass++) {
    grid = grid.map((row, y) => row.map((v, x) => {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const yy = y + dy;
          const xx = Math.abs(x + dx); // mirror across the symmetry axis
          if (yy < 0 || yy >= H || xx >= HALF) continue;
          n += grid[yy][xx];
        }
      }
      return n >= 5 ? 1 : n <= 2 ? 0 : v;
    }));
  }

  const hue = card.suit === 'major'
    ? Math.round((card.number * 137.508) % 360)
    : (SUIT_HUE[card.suit] + card.number * 3) % 360;
  const canvas = document.createElement('canvas');
  canvas.width = W * px;
  canvas.height = H * px;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = `hsl(${hue} 40% 8%)`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const shades = [
    `hsl(${hue} 65% 38%)`,
    `hsl(${hue} 70% 52%)`,
    `hsl(${hue} 85% 72%)`,
  ];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const hx = x < HALF ? HALF - 1 - x : x - HALF;
      if (!grid[y][hx]) continue;
      ctx.fillStyle = shades[(x * 7 + y * 13 + card.number) % 3];
      ctx.fillRect(x * px, y * px, px, px);
    }
  }

  ctx.strokeStyle = `hsl(${hue} 60% 60% / 0.5)`;
  ctx.lineWidth = px / 2;
  ctx.strokeRect(px / 2, px / 2, canvas.width - px, canvas.height - px);

  const url = canvas.toDataURL();
  cache.set(key, url);
  return url;
}
