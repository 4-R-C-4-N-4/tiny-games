import { describe, it, expect } from 'vitest';
import { Sim } from './sim.ts';
import { Rng } from './fx.ts';
import { Element, N_ELEMENTS } from './element.ts';
import { NodeKind, OccKind } from './types.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { archmageBuild, elementThatBeats } from './archmage.ts';
import { leakSurface, adaptiveLeakSurface, sampleBoard } from './teacher.ts';

const cfg = { ...DEFAULT_CONFIG };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('Archmage — best-practice defender', () => {
  it('funnels ground through a single chokepoint (walls the row but the gap)', () => {
    const sim = Sim.create(cfg, Element.Fire);
    archmageBuild(sim, { budget: 500, foeSchool: Element.Ice, stage: 0.5 });
    let walls = 0;
    for (let x = 0; x < sim.grid.w; x++) {
      const occ = sim.grid.get({ x, y: 8 }).occ;
      if (occ.kind === OccKind.Wall) walls++;
      else expect(x).toBe(3); // the only open column on the wall row is the gap
    }
    expect(walls).toBe(sim.grid.w - 1);
  });

  it('builds the counter school, plus anti-air and detection when it expects them', () => {
    const sim = Sim.create(cfg, Element.Fire);
    archmageBuild(sim, { budget: 900, foeSchool: Element.Zap, expectAir: true, expectStealth: true, stage: 0.8 });
    const els = new Set(sim.liveTowers().map((t) => t.element));
    expect(els.has(elementThatBeats(Element.Zap))).toBe(true); // counter of the expected foe school
    expect(els.has(Element.Sonic)).toBe(true); // anti-air
    expect(els.has(Element.Light)).toBe(true); // detection
  });

  it('uses arcane synergy once developed — a Pylon and an Emitter', () => {
    const sim = Sim.create(cfg, Element.Fire);
    archmageBuild(sim, { budget: 1100, foeSchool: Element.Ice, stage: 0.9 });
    const kinds = sim.liveTowers().map((t) => t.kind);
    expect(kinds).toContain(NodeKind.Structure); // Pylon (ally buff)
    expect(kinds).toContain(NodeKind.Active); //    Emitter (mob field)
  });

  it('defends far better than an undefended board (low leak surface)', () => {
    const arch = Sim.create(cfg, Element.Fire);
    archmageBuild(arch, { budget: 900, foeSchool: Element.Ice, expectAir: true, expectStealth: true, stage: 0.9 });
    const bare = Sim.create(cfg, Element.Fire); bare.syncFields();
    expect(sum(leakSurface(arch))).toBeLessThan(sum(leakSurface(bare)) * 0.5);
  });

  it('the adaptive probe escalates to keep a strong board discriminative', () => {
    // A strong defense stops the small fixed probe (little to learn); the adaptive probe
    // escalates the wave until the board's real weak spot breaks through.
    const strong = Sim.create(cfg, Element.Zap);
    archmageBuild(strong, { budget: 700, foeSchool: Element.Ice, expectAir: true, expectStealth: true, stage: 0.8 });
    const fixedMax = Math.max(...leakSurface(strong)); // base probe (2/column)
    const a = adaptiveLeakSurface(strong);
    expect(a.discriminative).toBe(true); //                             it found a real exploit
    expect(Math.max(...a.surface)).toBeGreaterThanOrEqual(fixedMax); // escalation never finds less
    expect(Math.max(...a.surface) - Math.min(...a.surface)).toBeGreaterThan(0); // a clear best action, not a flat wall
    // a bigger probe never leaks LESS than a smaller one (monotone signal)
    expect(Math.max(...leakSurface(strong, 32))).toBeGreaterThanOrEqual(Math.max(...leakSurface(strong, 2)));
  });

  it('is a tougher teaching board than the random scatter it replaces (lower leak surface)', () => {
    // The whole point of Slice 3: the teacher should train the attacker against COMPETENT
    // defense, not noise. A best-practice Archmage board must be harder to leak against than
    // the random `sampleBoard` scatter, on average, at comparable resources.
    const rng = new Rng(11n);
    let archTotal = 0, scatterTotal = 0;
    const N = 6;
    for (let i = 0; i < N; i++) {
      const scatter = sampleBoard(rng, cfg); // random towers + random walls (the old teacher board)
      const arch = Sim.create(cfg, Element.Fire);
      archmageBuild(arch, { budget: 700, foeSchool: rng.below(N_ELEMENTS) as Element, expectAir: true, expectStealth: true, stage: 0.7 });
      scatterTotal += sum(leakSurface(scatter));
      archTotal += sum(leakSurface(arch));
    }
    expect(archTotal).toBeLessThan(scatterTotal); // Archmage defends the probe suite better
  });
});
