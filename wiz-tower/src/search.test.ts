import { describe, it, expect } from 'vitest';
import { Sim } from './sim.ts';
import { Element } from './element.ts';
import { Trait, Tier, NodeKind } from './types.ts';
import { DEFAULT_CONFIG, budgetFor, groupCost } from './config.ts';
import { SearchAttacker } from './search.ts';
import { PlanAttacker, type Wave, type Opener } from './wave.ts';
import { playWave } from './driver.ts';

// A ground-heavy Fire defense with a glaring hole: NO anti-air anywhere.
const cfg = { ...DEFAULT_CONFIG, startCurrency: 1000 };

function groundOnlyDefense(): Sim {
  const s = Sim.create(cfg, Element.Fire);
  for (const [x, y] of [[1, 6], [3, 6], [5, 6], [1, 8], [3, 8], [5, 8]] as const) {
    s.buildTower({ x, y }, Element.Fire, Tier.T2, NodeKind.Turret);
  }
  s.syncFields();
  return s;
}

function openerCost(opener: Opener): number {
  return opener.reduce((sum, s) => sum + groupCost(s.group.trait, s.group.count), 0);
}

describe('SearchAttacker (L1 open-loop)', () => {
  it('holds back a hidden reserve; opener fits the remaining budget', () => {
    const s = groundOnlyDefense();
    s.prepareWave(2, 3);
    const atk = new SearchAttacker(s, { seed: 1n, topK: 1, reserveFrac: 0.35 });
    const { opener, pool } = atk.open(s.observe());
    expect(opener.length).toBeGreaterThan(0);
    expect(pool).toBeGreaterThan(0); // L2: reserve is hidden, not shown in the telegraph
    expect(pool).toBe(Math.round(budgetFor(2) * 0.35));
    // The telegraphed opener spends only the non-reserve budget.
    expect(openerCost(opener)).toBeLessThanOrEqual(budgetFor(2) - pool);
  });

  it('fires reactive commits from the reserve at decision points', () => {
    // A weak board + a bigger wave, so spending the reserve is clearly worth it (against a
    // strong defense the search may correctly HOLD, which isn't what we're testing here).
    const s = Sim.create(cfg, Element.Fire);
    for (const [x, y] of [[2, 6], [4, 6], [3, 8]] as const) s.buildTower({ x, y }, Element.Fire, Tier.T2, NodeKind.Turret);
    s.syncFields();
    s.prepareWave(3, 3);
    const atk = new SearchAttacker(s, { seed: 5n, topK: 1 });
    playWave(s, atk, 3, 3);
    // Two decision points (config default) → the attacker got two chances to commit…
    expect(atk.committed.length).toBe(2);
    // …and against a thin defense it spends the reserve at least once.
    expect(atk.committed.some((c) => c.length > 0)).toBe(true);
  });

  it('exploits the anti-air gap: out-leaks a ground baseline on the same defense', () => {
    // Search plays its chosen wave. Wave 4 — fliers are unlocked, so the anti-air gap is real
    // (and buffed Fire now burns ground to nothing, making the air lane the only way through).
    const sSearch = groundOnlyDefense();
    sSearch.prepareWave(4, 3);
    const atk = new SearchAttacker(sSearch, { seed: 7n, topK: 1, candidates: 32 });
    const mSearch = playWave(sSearch, atk, 4, 3);

    // Baseline: a naive all-ground wave of comparable budget vs an identical defense.
    const sBase = groundOnlyDefense();
    const budget = budgetFor(4);
    const count = Math.floor(budget / 4); // Fire grunts, cost 4 each
    const baseWave: Wave = {
      budget, diff: 3,
      opener: [{ t: 0, x: 3, group: { element: Element.Fire, trait: Trait.Grunt, count } }],
      reserve: { pool: 0, points: [] },
    };
    const mBase = playWave(sBase, new PlanAttacker(baseWave), 4, 3);

    // The ground baseline gets shot down; the search finds the air lane and leaks more.
    expect(mSearch.leakedHp).toBeGreaterThan(mBase.leakedHp);
    expect(mSearch.leakedHp).toBeGreaterThan(0);
  });

  it('is deterministic: same seed + same board → identical plan and outcome', () => {
    const s1 = groundOnlyDefense(); s1.prepareWave(2, 3);
    const s2 = groundOnlyDefense(); s2.prepareWave(2, 3);
    const a1 = new SearchAttacker(s1, { seed: 42n, topK: 1 });
    const a2 = new SearchAttacker(s2, { seed: 42n, topK: 1 });
    const m1 = playWave(s1, a1, 2, 3);
    const m2 = playWave(s2, a2, 2, 3);
    expect(a1.lastPlan?.opener).toEqual(a2.lastPlan?.opener);
    expect(m1).toEqual(m2);
  });

  it('records the chosen plan for the telegraph/recap', () => {
    const s = groundOnlyDefense(); s.prepareWave(1, 2);
    const atk = new SearchAttacker(s, { seed: 3n });
    atk.open(s.observe());
    expect(atk.lastPlan).not.toBeNull();
    expect(atk.lastPlan!.opener.length).toBeGreaterThan(0);
  });
});
