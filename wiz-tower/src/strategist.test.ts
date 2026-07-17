import { describe, it, expect } from 'vitest';
import { Game } from './game.ts';
import { Element } from './element.ts';
import { Tier, NodeKind, Trait } from './types.ts';
import { fxToFloat } from './fx.ts';
import { DEFAULT_CONFIG } from './config.ts';
import type { StrategistAttacker } from './strategist.ts';

const cfg = { ...DEFAULT_CONFIG, startCurrency: 800 };

/** Play `waves` waves against a Fire-only defense (no anti-air, no detection), recording
 *  the Strategist's stated intent and how many Drakes (fliers) it summoned each wave. */
function playMind(seed: bigint, waves: number) {
  const g = new Game({ starting: Element.Fire, difficulty: 3, seed, opponent: 'strategist', config: cfg });
  const intents: string[] = [];
  const fliers: number[] = [];
  const cells = [[3, 7], [2, 7], [4, 7], [3, 9], [2, 9], [4, 9], [3, 10], [3, 6], [2, 6], [4, 6], [1, 7], [5, 7]] as const;
  for (let w = 0; w < waves && g.state !== 'gameover'; w++) {
    // A funnel + a wall of pure-Fire wards — strong on the ground, but NEVER any anti-air or
    // detection, so the mind's air/stealth escalation has a gap to read and exploit.
    if (w === 0) for (let x = 0; x < g.sim.grid.w; x++) if (x !== 3) g.buildWall({ x, y: 8 });
    for (const [x, y] of cells) { if (g.currency < 20) break; g.buildTower({ x, y }, Element.Fire, Tier.T1, NodeKind.Turret); }
    g.startWave();
    intents.push(g.attackerIntent);
    // Count Drakes from the telegraph (set at scry, survives a mid-wave game-over) + reserve.
    let f = 0;
    for (const s of g.telegraph) if (s.group.trait === Trait.Flier) f += s.group.count;
    let guard = 0;
    while (g.state === 'wave' && guard++ < 300) g.update(5000);
    for (const cs of g.attacker.committed ?? []) for (const c of cs) if (c.group.trait === Trait.Flier) f += c.group.count;
    fliers.push(f);
  }
  return { intents, fliers, wave: g.wave, coreHp: fxToFloat(g.coreHp()), currency: g.currency, state: g.state };
}

describe('StrategistAttacker (L3 cross-wave mind)', () => {
  it('names the chronic type gap it reads (Fire defense answers Ice weakly)', () => {
    const r = playMind(1n, 3);
    // effective coverage vs Ice is lowest for a Fire-only defense (Fire is weak into Ice),
    // so the mind should call out the thin Ice ward from the very first wave.
    expect(r.intents[0]).toMatch(/Ice ward/);
    expect(r.intents[0]).toMatch(/^The Adversary /);
  });

  it('escalates air pressure across waves when anti-air never appears', () => {
    const r = playMind(2n, 4);
    // By the 2nd+ consecutive open-sky wave it should be massing Drakes…
    expect(r.intents.slice(1).some((s) => /Drakes/.test(s))).toBe(true);
    // …and it should actually field air (some fliers summoned over the run).
    expect(r.fliers.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('is fully deterministic for a fixed seed + scripted play', () => {
    const a = playMind(7n, 3);
    const b = playMind(7n, 3);
    expect(b).toEqual(a);
  });

  it('different seeds diverge', () => {
    const a = playMind(1n, 3);
    const b = playMind(9n, 3);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('actually steers mobs at the chronic gap (the elemWeightMul reaches the search)', () => {
    // Regression: the bias field was mis-named, so gap targeting was a silent no-op. A Fire
    // defense answers Ice weakly → the opener bias must up-weight Ice element sampling.
    const g = new Game({ starting: Element.Fire, difficulty: 3, seed: 1n, opponent: 'strategist', config: cfg });
    const atk = g.attacker as StrategistAttacker;
    for (let w = 0; w < 3; w++) {
      if (w === 0) for (let x = 0; x < g.sim.grid.w; x++) if (x !== 3) g.buildWall({ x, y: 8 });
      for (const [x, y] of [[3, 7], [2, 7], [4, 7], [3, 9], [3, 6]] as const) g.buildTower({ x, y }, Element.Fire, Tier.T1, NodeKind.Turret);
      g.startWave();
      let guard = 0; while (g.state === 'wave' && guard++ < 300) g.update(5000);
    }
    const em = atk.lastOpenerBias?.elemWeightMul;
    expect(em).toBeDefined();
    expect(em![Element.Ice]).toBeGreaterThan(1.5); // the gap school is boosted, not left at 1
    expect(em![Element.Ice]).toBeGreaterThan(em![Element.Fire]); // and above their own strong school
  });

  it('reads your go-to build and calls it out in the telegraph', () => {
    const r = playMind(3n, 3);
    expect(r.intents.some((s) => /Fire-heavy wards/.test(s))).toBe(true);
  });

  it('runs the gambit: when you reinforce the baited flank, the reserve strikes the flank you thinned', () => {
    // Pile all wards on the RIGHT and keep reinforcing it. The mind feints there, sees the
    // reinforcement, and swings an amplified reserve strike LEFT.
    const g = new Game({ starting: Element.Fire, difficulty: 3, seed: 5n, opponent: 'strategist', config: cfg });
    const atk = g.attacker as StrategistAttacker;
    // A growing pool of DISTINCT right-flank cells so each wave truly adds coverage there.
    const right = [[5, 7], [6, 7], [5, 9], [6, 9], [5, 6], [6, 6], [5, 10], [6, 10], [5, 5], [6, 5], [5, 3], [6, 3]] as const;
    let ri = 0, struck = false, leftHeavier = false;
    for (let w = 0; w < 4; w++) {
      if (w === 0) for (let x = 0; x < g.sim.grid.w; x++) if (x !== 5) g.buildWall({ x, y: 8 });
      // reinforce the right flank with THREE fresh cells each wave (the bait the mind reads)
      for (let k = 0; k < 3 && ri < right.length; k++, ri++) { const [x, y] = right[ri]; if (g.currency > 20) g.buildTower({ x, y }, Element.Fire, Tier.T1, NodeKind.Turret); }
      g.startWave();
      if (/as baited/.test(g.attackerIntent) && /strikes your left/.test(g.attackerIntent)) struck = true;
      let guard = 0; while (g.state === 'wave' && guard++ < 300) g.update(5000);
      const col = atk.lastCommitBias?.colWeightMul;
      if (struck && col && col[0] > col[6]) leftHeavier = true; // reserve concentrated left, off the reinforced right
    }
    expect(struck).toBe(true);
    expect(leftHeavier).toBe(true);
  });
});
