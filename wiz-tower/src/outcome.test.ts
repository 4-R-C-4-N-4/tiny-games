import { describe, it, expect } from 'vitest';
import { Sim } from './sim.ts';
import { Element } from './element.ts';
import { Trait } from './types.ts';
import { fx } from './fx.ts';
import { DEFAULT_CONFIG } from './config.ts';
import type { StepOutcome } from './types.ts';

describe('step() terminal outcome', () => {
  it('a shattered Core ends the run even when the killing blow is the LAST mob', () => {
    // Core so fragile one Grunt leak (4) is lethal, and that Grunt is the whole wave — so
    // the tick it leaks is also the tick the wave would "complete". Game-over must win.
    const cfg = { ...DEFAULT_CONFIG, coreHp: fx(4) };
    const s = Sim.create(cfg, Element.Fire); // no towers
    s.beginWave([{ t: 0, x: 3, group: { element: Element.Fire, trait: Trait.Grunt, count: 1 } }], 0, 1, 1);
    let out: StepOutcome = { kind: 'continue' };
    for (let i = 0; i < 4000; i++) {
      out = s.step();
      if (out.kind === 'decision') { s.commit([]); continue; }
      if (out.kind !== 'continue') break;
    }
    expect(out.kind).toBe('gameOver');
    expect(s.coreHp()).toBeLessThanOrEqual(0);
  });

  it('a wave still completes normally when the Core survives', () => {
    const s = Sim.create(DEFAULT_CONFIG, Element.Fire); // core 100, one Grunt leak = 4
    s.beginWave([{ t: 0, x: 3, group: { element: Element.Fire, trait: Trait.Grunt, count: 1 } }], 0, 1, 1);
    let out: StepOutcome = { kind: 'continue' };
    for (let i = 0; i < 4000; i++) {
      out = s.step();
      if (out.kind === 'decision') { s.commit([]); continue; }
      if (out.kind !== 'continue') break;
    }
    expect(out.kind).toBe('waveComplete');
    expect(s.coreHp()).toBeGreaterThan(0);
  });
});
