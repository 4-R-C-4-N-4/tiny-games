/**
 * Presentation-only juice: particle bursts, tower-fire beams, leak shockwaves, screen
 * shake, and ambient motes. Non-deterministic (Math.random) by design — the sim stays
 * deterministic; this only paints. Honors prefers-reduced-motion (calmer, no shake).
 */
type Kind = 'spark' | 'shard' | 'mote' | 'ring';

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; color: string; kind: Kind;
}

interface Beam { x1: number; y1: number; x2: number; y2: number; color: string; life: number; max: number; }

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Effects {
  private particles: Particle[] = [];
  private beams: Beam[] = [];
  private shakeMag = 0;
  readonly reduced: boolean;

  constructor(reduced: boolean) {
    this.reduced = reduced;
  }

  /** Element-colored shatter when a mob dies. */
  burst(x: number, y: number, color: string, power = 1): void {
    const n = this.reduced ? 4 : Math.round(10 * power);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(30, 120) * power;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, max: rand(0.35, 0.7), size: rand(1.5, 3.5) * power, color, kind: 'shard',
      });
    }
  }

  /** A short glowing tracer from a firing tower to its target, plus a spark. */
  beam(x1: number, y1: number, x2: number, y2: number, color: string): void {
    this.beams.push({ x1, y1, x2, y2, color, life: 0, max: 0.09 });
    if (!this.reduced && Math.random() < 0.5) {
      this.particles.push({ x: x2, y: y2, vx: rand(-20, 20), vy: rand(-20, 20), life: 0, max: 0.25, size: rand(1, 2.2), color, kind: 'spark' });
    }
  }

  /** Expanding ring when the Core is breached, plus screen shake. */
  shockwave(x: number, y: number, color: string, power = 1): void {
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0, max: 0.5, size: 8, color, kind: 'ring' });
    this.addShake(6 * power);
  }

  /** A spell being cast — twin blooming rune-rings, a spark burst, a soft thump. */
  cast(x: number, y: number, color: string): void {
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0, max: 0.55, size: 6, color, kind: 'ring' });
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0, max: 0.4, size: 16, color, kind: 'ring' });
    this.burst(x, y, color, 0.8);
    this.addShake(3);
  }

  addShake(mag: number): void {
    if (this.reduced) return;
    this.shakeMag = Math.min(14, Math.max(this.shakeMag, mag));
  }

  /** A drifting ambient mote somewhere on the board. */
  ambientMote(w: number, h: number, color: string): void {
    if (this.reduced) return;
    this.particles.push({
      x: rand(0, w), y: rand(0, h), vx: rand(-6, 6), vy: rand(-14, -4),
      life: 0, max: rand(2, 4), size: rand(0.8, 1.8), color, kind: 'mote',
    });
  }

  update(dt: number): void {
    this.shakeMag *= Math.max(0, 1 - dt * 9);
    if (this.shakeMag < 0.15) this.shakeMag = 0;
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - dt * 2; p.vy *= 1 - dt * 2;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    for (const b of this.beams) b.life += dt;
    this.beams = this.beams.filter((b) => b.life < b.max);
  }

  shakeXY(): [number, number] {
    if (this.shakeMag === 0) return [0, 0];
    return [rand(-this.shakeMag, this.shakeMag), rand(-this.shakeMag, this.shakeMag)];
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; // additive glow
    for (const b of this.beams) {
      const t = 1 - b.life / b.max;
      ctx.globalAlpha = t;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.globalAlpha = t;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    }
    for (const p of this.particles) {
      const t = 1 - p.life / p.max;
      if (p.kind === 'ring') {
        const r = p.size + (1 - t) * 46;
        ctx.globalAlpha = t * 0.8;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * t + 0.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
      } else {
        ctx.globalAlpha = p.kind === 'mote' ? t * 0.5 : t;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.kind === 'shard' ? t : 1), 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }
}
