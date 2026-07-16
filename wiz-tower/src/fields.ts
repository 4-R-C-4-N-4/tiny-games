/**
 * Pathing — dual flow fields (§3.5, PHASE0 §3). Movement is a shared integration field
 * to the Core, not per-mob A*: every ground mob follows the gradient; recomputed only
 * when the maze (wall layout) changes. Cheap for many mobs on a phone.
 *
 *   costWalled — walls impassable. The route mobs actually take. UNREACHABLE where the
 *                maze is sealed off from the Core.
 *   costOpen   — walls passable. The "if I could walk straight" field. When a mob is
 *                blocked (or a Breaker is choosing work), the wall to attack is the first
 *                one down THIS gradient (breachTarget) — a deterministic, sensible pick.
 *
 * Uniform step cost ⇒ BFS is exact (== Dijkstra with unit weights). Neighbour order is
 * fixed so gradient ties break identically on every platform (determinism contract).
 */
import { Grid } from './grid.ts';
import type { Cell } from './types.ts';

export const UNREACHABLE = 0xffffffff;

// Fixed 4-neighbourhood order — load-bearing for deterministic tie-breaks.
const DX = [0, 1, -1, 0]; // down, right, left, up
const DY = [1, 0, 0, -1];

export class Fields {
  readonly w: number;
  readonly h: number;
  readonly costWalled: Uint32Array;
  readonly costOpen: Uint32Array;
  dirty: boolean;

  constructor(grid: Grid) {
    this.w = grid.w;
    this.h = grid.h;
    this.costWalled = new Uint32Array(grid.w * grid.h);
    this.costOpen = new Uint32Array(grid.w * grid.h);
    this.dirty = true;
    this.recompute(grid);
  }

  /** BFS from Core over both wall-modes. O(cells); cheap enough per maze-change. */
  recompute(grid: Grid): void {
    this.bfs(grid, this.costWalled, /*wallsPassable=*/ false);
    this.bfs(grid, this.costOpen, /*wallsPassable=*/ true);
    this.dirty = false;
  }

  private bfs(grid: Grid, cost: Uint32Array, wallsPassable: boolean): void {
    cost.fill(UNREACHABLE);
    const core = grid.coreCell();
    const start = grid.idx(core);
    cost[start] = 0;
    // Ring-buffer-free BFS: array + head index, stable insertion order.
    const queue: number[] = [start];
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const cx = cur % this.w;
      const cy = (cur / this.w) | 0;
      const nd = cost[cur] + 1;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
        const ni = ny * this.w + nx;
        if (cost[ni] !== UNREACHABLE) continue; // visited (BFS ⇒ already optimal)
        if (!wallsPassable && grid.blocks({ x: nx, y: ny })) continue; // wall impassable
        cost[ni] = nd;
        queue.push(ni);
      }
    }
  }

  distCore(grid: Grid, c: Cell): number {
    return this.costWalled[grid.idx(c)];
  }

  /**
   * Next cell down the walled gradient from `from`, or null if `from` is the Core
   * (arrived) or UNREACHABLE (blocked — the mob must breach). Picks the neighbour with
   * the strictly smallest costWalled; ties break by the fixed neighbour order.
   */
  stepWalled(grid: Grid, from: Cell): Cell | null {
    return this.descend(grid, this.costWalled, from);
  }

  private descend(grid: Grid, cost: Uint32Array, from: Cell): Cell | null {
    const here = cost[grid.idx(from)];
    if (here === UNREACHABLE || here === 0) return null;
    let best: Cell | null = null;
    let bestCost = here;
    for (let k = 0; k < 4; k++) {
      const nx = from.x + DX[k];
      const ny = from.y + DY[k];
      if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
      const nc = cost[ny * this.w + nx];
      if (nc < bestCost) {
        bestCost = nc;
        best = { x: nx, y: ny };
      }
    }
    return best;
  }

  /**
   * The wall a blocked mob at `from` should attack: the first wall cell along the OPEN
   * gradient toward the Core. Walks the strictly-decreasing costOpen path; returns the
   * first wall it steps onto, or null if the straight route to Core hits no wall.
   * costOpen strictly decreases each step, so this always terminates.
   */
  breachTarget(grid: Grid, from: Cell): Cell | null {
    let cur: Cell | null = from;
    // Guard against a from-cell that is itself unreachable in the open field (shouldn't
    // happen — walls are passable there — but stay safe).
    if (this.costOpen[grid.idx(from)] === UNREACHABLE) return null;
    while (cur) {
      const next = this.descend(grid, this.costOpen, cur);
      if (!next) return null; // reached Core with no wall in the way
      if (grid.blocks(next)) return next; // first wall on the open route
      cur = next;
    }
    return null;
  }
}
