/**
 * Board (de)serialization — Phase 6 Slice 3b. Turns a Sim's defense into a plain JSON
 * snapshot and back, so a HUMAN's play (logged in the browser) can be replayed into the
 * teacher as training boards. Expert boards beat the heuristic Archmage — the best player
 * sets a higher bar than any hand-written defender.
 *
 * Snapshots are taken at the START of a wave (post-build), so walls are full and the board is
 * the complete defense the player committed for that wave.
 */
import { Sim } from './sim.ts';
import { Element } from './element.ts';
import { Tier, NodeKind, OccKind } from './types.ts';
import type { Config } from './config.ts';

export interface TowerSnap { x: number; y: number; element: number; tier: number; kind: number; }
export interface BoardSnapshot {
  starting: number;
  attuned: boolean[];
  depth: number[];
  currency: number;
  towers: TowerSnap[];
  walls: { x: number; y: number }[];
}

/** Capture the current defense on `sim` as a plain-JSON snapshot. */
export function snapshotBoard(sim: Sim): BoardSnapshot {
  const { w } = sim.grid;
  const towers: TowerSnap[] = sim.liveTowers().map((t) => ({ x: t.cell.x, y: t.cell.y, element: t.element, tier: t.tier, kind: t.kind }));
  const walls: { x: number; y: number }[] = [];
  for (let i = 0; i < sim.grid.cells.length; i++) {
    if (sim.grid.cells[i].occ.kind === OccKind.Wall) walls.push({ x: i % w, y: (i / w) | 0 });
  }
  const pl = sim.player;
  return { starting: pl.starting, attuned: pl.attuned.slice(), depth: pl.depth.slice(), currency: pl.currency, towers, walls };
}

/** Rebuild a Sim from a snapshot. Attunement/depth are set directly and currency is lifted
 *  during construction (then restored), so the exact board is reproduced regardless of the
 *  economy rules that would gate a live build. */
export function restoreBoard(cfg: Config, snap: BoardSnapshot): Sim {
  const sim = Sim.create(cfg, snap.starting as Element);
  const pl = sim.player;
  for (let e = 0; e < snap.attuned.length; e++) { if (snap.attuned[e]) pl.attuned[e] = true; pl.depth[e] = snap.depth[e]; }
  pl.currency = 1e9;
  for (const wcell of snap.walls) sim.buildWall(wcell);
  // Tier-ascending so any depth-ladder check is satisfied even if depth were understated.
  for (const t of [...snap.towers].sort((a, b) => a.tier - b.tier)) {
    sim.buildTower({ x: t.x, y: t.y }, t.element as Element, t.tier as Tier, t.kind as NodeKind);
  }
  pl.currency = snap.currency;
  sim.syncFields();
  return sim;
}
