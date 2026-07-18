import { describe, it, expect } from 'vitest';
import { Sim } from './sim.ts';
import { Element } from './element.ts';
import { Tier, NodeKind } from './types.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { snapshotBoard, restoreBoard } from './board-io.ts';

const cfg = { ...DEFAULT_CONFIG };

describe('board snapshot round-trip', () => {
  it('restores towers, walls, attunement, depth and coverage exactly', () => {
    const s = Sim.create(cfg, Element.Fire);
    s.player.currency = 5000;
    s.buildWall({ x: 2, y: 8 }); s.buildWall({ x: 4, y: 8 });
    s.buildTower({ x: 3, y: 6 }, Element.Fire, Tier.T1, NodeKind.Turret);
    s.attune(Element.Sonic);
    s.buildTower({ x: 3, y: 7 }, Element.Sonic, Tier.T1, NodeKind.Turret); // depth Sonic→1
    s.buildTower({ x: 2, y: 7 }, Element.Sonic, Tier.T2, NodeKind.Turret); // depth Sonic→2
    s.buildTower({ x: 4, y: 7 }, Element.Fire, Tier.T1, NodeKind.Structure); // a Pylon
    s.attune(Element.Ice);
    s.buildTower({ x: 3, y: 9 }, Element.Ice, Tier.T1, NodeKind.Active); // an Emitter
    s.syncFields();

    const snap = snapshotBoard(s);
    const r = restoreBoard(cfg, JSON.parse(JSON.stringify(snap))); // force through JSON
    const snap2 = snapshotBoard(r);

    // towers + walls + player state identical
    const key = (t: { x: number; y: number; element: number; tier: number; kind: number }) => `${t.x},${t.y},${t.element},${t.tier},${t.kind}`;
    expect(snap2.towers.map(key).sort()).toEqual(snap.towers.map(key).sort());
    expect(snap2.walls.map((w) => `${w.x},${w.y}`).sort()).toEqual(snap.walls.map((w) => `${w.x},${w.y}`).sort());
    expect(snap2.attuned).toEqual(snap.attuned);
    expect(snap2.depth).toEqual(snap.depth);
    expect(snap2.currency).toBe(snap.currency);

    // and the observable coverage (what the teacher reads) matches
    expect(r.observe().cells.map((c) => c.dps)).toEqual(s.observe().cells.map((c) => c.dps));
  });
});
