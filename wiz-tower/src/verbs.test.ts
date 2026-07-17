import { describe, it, expect } from 'vitest';
import { Sim } from './sim.ts';
import { Game } from './game.ts';
import { Element } from './element.ts';
import { Trait, Tier, NodeKind, OccKind } from './types.ts';
import { fx } from './fx.ts';
import { DEFAULT_CONFIG, VERB_CHARGES } from './config.ts';

const cfg = { ...DEFAULT_CONFIG };

function run(s: Sim, n: number) { for (let i = 0; i < n; i++) s.step(); }

describe('in-wave verbs — sim effects', () => {
  it('overcharge makes towers in the zone hit much harder', () => {
    const plain = Sim.create(cfg, Element.Fire);
    plain.buildTower({ x: 3, y: 2 }, Element.Fire, Tier.T2, NodeKind.Turret); // range covers spawn band
    plain.spawnGroup(3, Element.Ice, Trait.Tank, 1); // resisted tank survives a while
    run(plain, 60);
    const plainDmg = plain.liveMobs()[0]?.damageTaken ?? fx(999);

    const oc = Sim.create(cfg, Element.Fire);
    oc.buildTower({ x: 3, y: 2 }, Element.Fire, Tier.T2, NodeKind.Turret);
    oc.spawnGroup(3, Element.Ice, Trait.Tank, 1);
    oc.playerVerb({ kind: 'overcharge', cell: { x: 3, y: 2 } });
    run(oc, 60);
    const ocDmg = oc.liveMobs()[0]?.damageTaken ?? fx(999);

    expect(plainDmg).toBeGreaterThan(0); // sanity: the tower was in range and firing
    expect(ocDmg).toBeGreaterThan(plainDmg);
  });

  it('reveal lets a non-detection tower hit a Shade it otherwise cannot', () => {
    const blind = Sim.create(cfg, Element.Fire);
    blind.buildTower({ x: 3, y: 2 }, Element.Fire, Tier.T2, NodeKind.Turret);
    blind.spawnGroup(3, Element.Fire, Trait.Shade, 1);
    run(blind, 90);
    // Without detection/reveal, the Shade is never targeted.
    expect(blind.liveMobs()[0]?.damageTaken ?? 0).toBe(0);

    const seen = Sim.create(cfg, Element.Fire);
    seen.buildTower({ x: 3, y: 2 }, Element.Fire, Tier.T2, NodeKind.Turret);
    seen.spawnGroup(3, Element.Fire, Trait.Shade, 1);
    seen.playerVerb({ kind: 'reveal', cell: { x: 3, y: 2 } });
    run(seen, 90);
    const seenMob = seen.liveMobs()[0];
    // Either it took damage or it already died — both mean the reveal worked.
    expect(seenMob ? seenMob.damageTaken > 0 : true).toBe(true);
    expect(seen.coreHp()).toBeGreaterThanOrEqual(blind.coreHp()); // fewer/no leaks
  });

  it('reinforce restores a damaged wall', () => {
    const s = Sim.create(cfg, Element.Fire);
    s.buildWall({ x: 3, y: 6 });
    s.grid.setOcc({ x: 3, y: 6 }, { kind: OccKind.Wall, hp: fx(3) }); // pretend it's been chewed down
    expect(s.playerVerb({ kind: 'reinforce', cell: { x: 3, y: 6 } })).toBe(true);
    const occ = s.grid.get({ x: 3, y: 6 }).occ;
    expect(occ.kind === OccKind.Wall && occ.hp > fx(3)).toBe(true);
  });
});

describe('Game — verb charges', () => {
  it('spends limited charges, only during a wave', () => {
    const g = new Game({ seed: 1n, config: { ...cfg, startCurrency: 200 } });
    g.buildTower({ x: 3, y: 6 }, Element.Fire, Tier.T2, NodeKind.Turret);
    // no verbs during build
    expect(g.verb({ kind: 'overcharge', cell: { x: 3, y: 6 } })).toBe(false);
    g.startWave();
    expect(g.verbsLeft).toBe(VERB_CHARGES);
    expect(g.verb({ kind: 'overcharge', cell: { x: 3, y: 6 } })).toBe(true);
    expect(g.verbsLeft).toBe(VERB_CHARGES - 1);
    // exhaust
    for (let i = 0; i < VERB_CHARGES; i++) g.verb({ kind: 'overcharge', cell: { x: 3, y: 6 } });
    expect(g.verbsLeft).toBe(0);
    expect(g.verb({ kind: 'overcharge', cell: { x: 3, y: 6 } })).toBe(false);
  });
});
