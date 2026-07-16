/**
 * Grid & occupancy (§2, §9.4). Buildability is a static map property; occupancy is
 * dynamic. CONFIRMED: only walls block movement — towers are pure coverage.
 */
import { OccKind, type Cell, type CellInfo, type Occupant } from './types.ts';

export class Grid {
  readonly w: number;
  readonly h: number;
  readonly cells: CellInfo[];

  constructor(w: number, h: number, cells: CellInfo[]) {
    this.w = w;
    this.h = h;
    this.cells = cells;
  }

  /**
   * Default map: fully buildable interior, a Core cell at the bottom-centre, and the
   * whole top row as the spawn band. Non-buildable: Core and Spawn cells.
   */
  static basic(w: number, h: number): Grid {
    const cells: CellInfo[] = [];
    const coreX = (w / 2) | 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let occ: Occupant = { kind: OccKind.Empty };
        let buildable = true;
        if (y === 0) {
          occ = { kind: OccKind.Spawn };
          buildable = false;
        } else if (y === h - 1 && x === coreX) {
          occ = { kind: OccKind.Core };
          buildable = false;
        }
        cells.push({ buildable, occ });
      }
    }
    return new Grid(w, h, cells);
  }

  idx(c: Cell): number {
    return c.y * this.w + c.x;
  }

  inBounds(c: Cell): boolean {
    return c.x >= 0 && c.y >= 0 && c.x < this.w && c.y < this.h;
  }

  get(c: Cell): CellInfo {
    return this.cells[this.idx(c)];
  }

  /** Walls block; everything else (towers included) is passable. */
  blocks(c: Cell): boolean {
    return this.cells[this.idx(c)].occ.kind === OccKind.Wall;
  }

  isEmpty(c: Cell): boolean {
    return this.cells[this.idx(c)].occ.kind === OccKind.Empty;
  }

  setOcc(c: Cell, occ: Occupant): void {
    this.cells[this.idx(c)].occ = occ;
  }

  /** The single Core cell (first found in id order). */
  coreCell(): Cell {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.cells[y * this.w + x].occ.kind === OccKind.Core) return { x, y };
    throw new Error('grid has no Core');
  }

  /** Spawn-band cells (top row), in x order. */
  spawnCells(): Cell[] {
    const out: Cell[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.cells[y * this.w + x].occ.kind === OccKind.Spawn) out.push({ x, y });
    return out;
  }
}
