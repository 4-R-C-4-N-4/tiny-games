import { describe, it, expect } from 'vitest';
import { Sim } from './sim.ts';
import { Element } from './element.ts';
import { OccKind, Tier, NodeKind } from './types.ts';
import { DEFAULT_CONFIG, WALL_COST, towerCost, refund, tierGateCost, attuneCost } from './config.ts';

const cfg = { ...DEFAULT_CONFIG };

function sim(starting = Element.Fire) {
  return Sim.create(cfg, starting);
}

describe('build/sell walls', () => {
  it('builds a wall: charges cost, occupies, dirties maze, blocks', () => {
    const s = sim();
    s.mazeDirty = false;
    const c = { x: 2, y: 5 };
    expect(s.buildWall(c)).toBe(true);
    expect(s.player.currency).toBe(cfg.startCurrency - WALL_COST);
    expect(s.grid.get(c).occ.kind).toBe(OccKind.Wall);
    expect(s.grid.blocks(c)).toBe(true);
    expect(s.mazeDirty).toBe(true);
  });

  it('rejects walls on non-buildable / occupied cells', () => {
    const s = sim();
    expect(s.buildWall({ x: 3, y: 11 })).toBe(false); // core
    expect(s.buildWall({ x: 0, y: 0 })).toBe(false); // spawn
    s.buildWall({ x: 2, y: 5 });
    expect(s.buildWall({ x: 2, y: 5 })).toBe(false); // occupied
  });

  it('sells a wall: partial refund, empties, dirties maze', () => {
    const s = sim();
    const c = { x: 2, y: 5 };
    s.buildWall(c);
    const before = s.player.currency;
    s.mazeDirty = false;
    expect(s.sell(c)).toBe(true);
    expect(s.player.currency).toBe(before + refund(WALL_COST));
    expect(s.grid.get(c).occ.kind).toBe(OccKind.Empty);
    expect(s.mazeDirty).toBe(true);
  });
});

describe('build/sell towers + tree economy', () => {
  it('builds a starting-element T1 turret without dirtying the maze', () => {
    const s = sim(Element.Fire);
    s.mazeDirty = false;
    const c = { x: 2, y: 5 };
    expect(s.buildTower(c, Element.Fire, Tier.T1, NodeKind.Turret)).toBe(true);
    expect(s.player.currency).toBe(cfg.startCurrency - towerCost(NodeKind.Turret, Tier.T1));
    expect(s.grid.get(c).occ.kind).toBe(OccKind.Tower);
    expect(s.mazeDirty).toBe(false); // towers are coverage, not maze
    expect(s.liveTowers()).toHaveLength(1);
  });

  it('refuses a non-attuned element until attuned', () => {
    const s = sim(Element.Fire);
    expect(s.buildTower({ x: 2, y: 5 }, Element.Ice, Tier.T1, NodeKind.Turret)).toBe(false);
    expect(s.attune(Element.Ice)).toBe(true);
    expect(s.player.currency).toBe(cfg.startCurrency - attuneCost(0));
    expect(s.buildTower({ x: 2, y: 5 }, Element.Ice, Tier.T1, NodeKind.Turret)).toBe(true);
  });

  it('attunement escalates with each extra element', () => {
    const s = sim(Element.Fire);
    s.player.currency = 10_000;
    expect(s.attune(Element.Ice)).toBe(true); // count 0 -> cost 40
    expect(s.attune(Element.Zap)).toBe(true); // count 1 -> cost 65
    // starting is pre-attuned and cannot be re-attuned
    expect(s.attune(Element.Fire)).toBe(false);
    const spent = attuneCost(0) + attuneCost(1);
    expect(s.player.currency).toBe(10_000 - spent);
  });

  it('pays the T2 tier-gate on demand and forbids skipping to T3', () => {
    const s = sim(Element.Ice); // Ice starting: T2 gate waived
    s.player.currency = 10_000;
    // Fire is non-starting: T2 gate costs money and needs T1 first.
    s.attune(Element.Fire);
    expect(s.buildTower({ x: 1, y: 3 }, Element.Fire, Tier.T3, NodeKind.Turret)).toBe(false); // skip
    const before = s.player.currency;
    expect(s.buildTower({ x: 1, y: 3 }, Element.Fire, Tier.T2, NodeKind.Turret)).toBe(true);
    expect(before - s.player.currency).toBe(
      towerCost(NodeKind.Turret, Tier.T2) + tierGateCost(Element.Fire, Tier.T2, Element.Ice),
    );
    expect(s.player.depth[Element.Fire]).toBe(Tier.T2);
  });

  it("starting element's T2 gate is waived (expedited path)", () => {
    const s = sim(Element.Fire);
    const before = s.player.currency;
    expect(s.buildTower({ x: 1, y: 3 }, Element.Fire, Tier.T2, NodeKind.Turret)).toBe(true);
    // only the tower cost, no gate
    expect(before - s.player.currency).toBe(towerCost(NodeKind.Turret, Tier.T2));
  });

  it('sells a tower: refund, frees the slot, reuses the id', () => {
    const s = sim(Element.Fire);
    const c = { x: 2, y: 5 };
    s.buildTower(c, Element.Fire, Tier.T1, NodeKind.Turret);
    const before = s.player.currency;
    expect(s.sell(c)).toBe(true);
    expect(s.player.currency).toBe(before + refund(towerCost(NodeKind.Turret, Tier.T1)));
    expect(s.grid.get(c).occ.kind).toBe(OccKind.Empty);
    expect(s.liveTowers()).toHaveLength(0);
    // id reuse: next tower takes the freed slot 0
    s.buildTower({ x: 4, y: 6 }, Element.Fire, Tier.T1, NodeKind.Turret);
    expect(s.liveTowers()[0].id).toBe(0);
  });
});
