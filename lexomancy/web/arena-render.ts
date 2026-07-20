import { THEME_HUES, type Theme } from '../src/floors.ts';

// The battle arena: a fixed-size backdrop behind the combatants, giving them
// a place to stand instead of floating in a gradient. Everything here is
// procedural — a ground+horizon canvas tinted by the floor's theme hue, plus
// two parallax dressing bands (far/near) built from a handful of shared prop
// "kinds" so 26 themes cost ~5 authored shapes, not 26 bespoke backgrounds.

type PropKind = 'spike' | 'shard' | 'wisp' | 'reed' | 'orb';

/** Groups the 26 themes into shared silhouette vocabularies. */
const THEME_PROPS: Record<Theme, PropKind> = {
  bone: 'spike', ash: 'spike', ruin: 'spike', iron: 'spike', clockwork: 'spike',
  tide: 'shard', frost: 'shard', salt: 'shard', glass: 'shard',
  storm: 'wisp', thunder: 'wisp', starlight: 'wisp', dream: 'wisp', choir: 'wisp',
  garden: 'reed', venom: 'reed', root: 'reed', honey: 'reed', moth: 'reed', silk: 'reed',
  blood: 'orb', hunger: 'orb', plague: 'orb', mirror: 'orb', lantern: 'orb', ember: 'orb',
};

const NATIVE_W = 300;
const NATIVE_H = 160;
const HORIZON_Y = NATIVE_H * 0.5;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ground + horizon + sky, theme-tinted. Two ground tones give the enemy
 * (far) and player (near) each a distinct standing strip — the depth cue a
 * Gen-1 battle framing wants. */
function drawGroundCanvas(hue: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = NATIVE_W;
  c.height = NATIVE_H;
  const ctx = c.getContext('2d')!;

  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
  sky.addColorStop(0, `hsl(${hue} 30% 9%)`);
  sky.addColorStop(1, `hsl(${hue} 35% 16%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, NATIVE_W, HORIZON_Y);

  // Horizon glow.
  ctx.fillStyle = `hsl(${hue} 45% 22%)`;
  ctx.fillRect(0, HORIZON_Y - 1, NATIVE_W, 2);

  // Far ground (enemy strip) — lighter, recedes into the horizon.
  const far = ctx.createLinearGradient(0, HORIZON_Y, 0, HORIZON_Y + 26);
  far.addColorStop(0, `hsl(${hue} 22% 15%)`);
  far.addColorStop(1, `hsl(${hue} 20% 11%)`);
  ctx.fillStyle = far;
  ctx.fillRect(0, HORIZON_Y, NATIVE_W, 26);

  // Near ground (player strip) — darker foreground.
  const near = ctx.createLinearGradient(0, HORIZON_Y + 26, 0, NATIVE_H);
  near.addColorStop(0, `hsl(${hue} 18% 9%)`);
  near.addColorStop(1, `hsl(${hue} 16% 6%)`);
  ctx.fillStyle = near;
  ctx.fillRect(0, HORIZON_Y + 26, NATIVE_W, NATIVE_H - HORIZON_Y - 26);

  return c;
}

function drawProp(ctx: CanvasRenderingContext2D, kind: PropKind, x: number, y: number, s: number, hue: number, alpha: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = `hsl(${hue} 40% 30%)`;
  switch (kind) {
    case 'spike':
      ctx.beginPath();
      ctx.moveTo(-s * 0.35, 0);
      ctx.lineTo(0, -s);
      ctx.lineTo(s * 0.35, 0);
      ctx.closePath();
      ctx.fill();
      break;
    case 'shard':
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.3, -s * 0.4);
      ctx.lineTo(s * 0.15, 0);
      ctx.lineTo(-s * 0.15, 0);
      ctx.lineTo(-s * 0.3, -s * 0.4);
      ctx.closePath();
      ctx.fillStyle = `hsl(${hue} 50% 40%)`;
      ctx.fill();
      break;
    case 'wisp':
      ctx.fillStyle = `hsl(${hue} 45% 35%)`;
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.3, s * 0.5, s * 0.22, 0, 0, Math.PI * 2);
      ctx.ellipse(s * 0.35, -s * 0.35, s * 0.3, s * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'reed':
      ctx.strokeStyle = `hsl(${hue} 40% 30%)`;
      ctx.lineWidth = Math.max(1, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(s * 0.15, -s * 0.5, -s * 0.05, -s);
      ctx.stroke();
      break;
    case 'orb':
      ctx.fillStyle = `hsl(${hue} 55% 40%)`;
      ctx.beginPath();
      ctx.arc(0, -s * 0.3, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}

interface DressingLayer {
  canvas: HTMLCanvasElement;
  tileWidth: number;
}

/** One tileable strip of props for a theme, drawn once and repeated via CSS. */
function drawDressingLayer(theme: Theme, far: boolean): DressingLayer {
  const kind = THEME_PROPS[theme];
  const hue = THEME_HUES[theme];
  const tileWidth = far ? 180 : 130;
  const height = far ? 34 : 40;
  const c = document.createElement('canvas');
  c.width = tileWidth;
  c.height = height;
  const ctx = c.getContext('2d')!;
  const rng = mulberry32(hue * 1000 + (far ? 1 : 2));
  const count = far ? 4 : 3;
  const baseSize = far ? 14 : 22;
  for (let i = 0; i < count; i++) {
    const x = (i + 0.3 + rng() * 0.5) * (tileWidth / count);
    const s = baseSize * (0.7 + rng() * 0.6);
    drawProp(ctx, kind, x, height, s, hue, far ? 0.35 : 0.55);
  }
  return { canvas: c, tileWidth };
}

export interface ArenaLayers {
  ground: string;
  farDressing: string;
  nearDressing: string;
  farTileWidth: number;
  nearTileWidth: number;
}

const cache = new Map<Theme, ArenaLayers>();

/** Data URLs for the three arena layers, cached per theme. */
export function arenaFor(theme: Theme): ArenaLayers {
  const hit = cache.get(theme);
  if (hit) return hit;
  const hue = THEME_HUES[theme];
  const ground = drawGroundCanvas(hue).toDataURL();
  const far = drawDressingLayer(theme, true);
  const near = drawDressingLayer(theme, false);
  const layers: ArenaLayers = {
    ground,
    farDressing: far.canvas.toDataURL(),
    nearDressing: near.canvas.toDataURL(),
    farTileWidth: far.tileWidth,
    nearTileWidth: near.tileWidth,
  };
  cache.set(theme, layers);
  return layers;
}
