import { describe, it, expect } from 'vitest';
import { parseWave, PlanAttacker, WaveError } from './wave.ts';
import { Element } from './element.ts';
import { Trait } from './types.ts';
import { fx } from './fx.ts';
import type { DecisionContext, Observation } from './types.ts';
import { N_ELEMENTS } from './element.ts';

// The canonical §4.3 example (element × trait), matching wave.ebnf's example block.
const EXAMPLE = `WAVE budget=120 diff=3
OPEN
  SPAWN t=0.0 x=1 FIRE SWARM x8       # bait fire toward the left
  SPAWN t=1.2 x=5 EARTH TANK x2       # visible pressure right
RESERVE pool=45
  AT t=2.0
  IF dps_near(x=5,DARK)<40.0
      COMMIT x=5 DARK GRUNT x3
  ELSE IF wall_hp((1,7))<30.0
      COMMIT x=1 EARTH BREAKER x2 BREACH (1,7)
      COMMIT x=1 FIRE GRUNT x6
  ELSE
      COMMIT x=3 SONIC FLIER x5
`;

const env = { gridW: 7, gridH: 12, waveSeconds: fx(8), isWall: (c: { x: number; y: number }) => c.x === 1 && c.y === 7 };

describe('parseWave — the §4.3 example', () => {
  const w = parseWave(EXAMPLE, env);

  it('parses the header', () => {
    expect(w.budget).toBe(120);
    expect(w.diff).toBe(3);
  });

  it('parses the telegraphed opener', () => {
    expect(w.opener).toHaveLength(2);
    expect(w.opener[0].group).toEqual({ element: Element.Fire, trait: Trait.Swarm, count: 8 });
    expect(w.opener[0].x).toBe(1);
    expect(w.opener[1].group).toEqual({ element: Element.Earth, trait: Trait.Tank, count: 2 });
    expect(w.opener[1].t).toBe(Math.round(1.2 * 1024)); // 1.2s → 1229 Fx
  });

  it('parses the reserve with one decision point and three guards', () => {
    expect(w.reserve.pool).toBe(45);
    expect(w.reserve.points).toHaveLength(1);
    const guards = w.reserve.points[0].guards;
    expect(guards).toHaveLength(3);
    expect(guards[0].cond).toEqual({ kind: 'dpsNearLt', x: 5, element: Element.Dark, thresh: fx(40) });
    expect(guards[1].cond).toEqual({ kind: 'wallHpLt', gate: { x: 1, y: 7 }, thresh: fx(30) });
    expect(guards[2].cond).toBeNull(); // trailing ELSE
    // the breach branch carries two commits, one of them a BREACH
    expect(guards[1].commit).toHaveLength(2);
    expect(guards[1].commit[0]).toEqual({
      kind: 'breach', x: 1, gate: { x: 1, y: 7 },
      group: { element: Element.Earth, trait: Trait.Breaker, count: 2 },
    });
  });
});

describe('parseWave — validation', () => {
  it('rejects an over-budget wave', () => {
    const src = `WAVE budget=10 diff=1
OPEN
  SPAWN t=0.0 x=1 FIRE GRUNT x2
RESERVE pool=45
`;
    expect(() => parseWave(src, env)).toThrow(WaveError);
    try { parseWave(src, env); } catch (e) { expect((e as WaveError).kind).toBe('overBudget'); }
  });

  it('rejects an out-of-range entry column', () => {
    const src = `WAVE budget=100 diff=1
OPEN
  SPAWN t=0.0 x=9 FIRE GRUNT x2
RESERVE pool=0
`;
    try { parseWave(src, env); throw new Error('should have thrown'); }
    catch (e) { expect((e as WaveError).kind).toBe('badCell'); }
  });

  it('rejects a breach gate that is not a wall', () => {
    const src = `WAVE budget=100 diff=1
OPEN
  SPAWN t=0.0 x=1 FIRE GRUNT x2
RESERVE pool=20
  AT t=2.0
  IF core_hp<50.0
      COMMIT x=1 EARTH BREAKER x2 BREACH (2,2)
`;
    try { parseWave(src, env); throw new Error('should have thrown'); }
    catch (e) { expect((e as WaveError).kind).toBe('badCell'); }
  });

  it('rejects timing outside the wave window', () => {
    const src = `WAVE budget=100 diff=1
OPEN
  SPAWN t=99.0 x=1 FIRE GRUNT x2
RESERVE pool=0
`;
    try { parseWave(src, env); throw new Error('should have thrown'); }
    catch (e) { expect((e as WaveError).kind).toBe('badTiming'); }
  });

  it('rejects syntactically malformed input', () => {
    expect(() => parseWave('NOPE', env)).toThrow(WaveError);
  });
});

// --- PlanAttacker guard resolution --------------------------------------------------

function fakeObs(overrides: Partial<Observation> = {}): Observation {
  const w = 7, h = 12;
  const cells = Array.from({ length: w * h }, (_, idx) => ({
    dps: new Array(N_ELEMENTS).fill(0), control: 0, antiAir: 0, detection: 0,
    wallHp: 0, buildable: true, distCore: idx,
  }));
  return {
    w, h, cells,
    profile: { starting: Element.Fire, attuned: new Array(N_ELEMENTS).fill(false), depth: new Array(N_ELEMENTS).fill(0) },
    budget: 120, wave: 1, diff: 3, ...overrides,
  };
}

function ctx(obs: Observation, coreHp = fx(100), pointIndex = 0): DecisionContext {
  return { obs, reserveLeft: 45, coreHp, t: fx(2), pointIndex };
}

describe('PlanAttacker — reserve guard resolution', () => {
  const wave = parseWave(EXAMPLE, env);

  it('open() returns the opener + reserve pool', () => {
    const a = new PlanAttacker(wave);
    const { opener, pool } = a.open(fakeObs());
    expect(opener).toHaveLength(2);
    expect(pool).toBe(45);
  });

  it('fires the first guard whose condition holds (low DARK coverage on col 5)', () => {
    const a = new PlanAttacker(wave);
    const commits = a.commit(ctx(fakeObs())); // all dps 0 → dps_near(x=5,DARK)=0 < 40
    expect(commits).toEqual([{ kind: 'spawn', x: 5, group: { element: Element.Dark, trait: Trait.Grunt, count: 3 } }]);
  });

  it('falls through to the ELSE branch when earlier guards fail', () => {
    // Make col-5 DARK coverage high so guard 0 fails; keep wall HP high so guard 1 fails.
    const obs = fakeObs();
    for (let y = 0; y < obs.h; y++) obs.cells[y * obs.w + 5].dps[Element.Dark] = fx(100);
    obs.cells[7 * obs.w + 1].wallHp = fx(100); // wall_hp((1,7))=100, not < 30 → guard 1 fails
    const a = new PlanAttacker(wave);
    const commits = a.commit(ctx(obs));
    expect(commits).toEqual([{ kind: 'spawn', x: 3, group: { element: Element.Sonic, trait: Trait.Flier, count: 5 } }]);
  });

  it('fires the breach branch when the gate wall is softened', () => {
    const obs = fakeObs();
    for (let y = 0; y < obs.h; y++) obs.cells[y * obs.w + 5].dps[Element.Dark] = fx(100); // guard 0 fails
    obs.cells[7 * obs.w + 1].wallHp = fx(10); // wall_hp((1,7))=10 < 30 → guard 1 holds
    const a = new PlanAttacker(wave);
    const commits = a.commit(ctx(obs));
    expect(commits).toHaveLength(2);
    expect(commits[0].kind).toBe('breach');
  });
});
