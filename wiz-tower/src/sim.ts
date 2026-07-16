/**
 * td_sim — Phase 0 deterministic simulation core (TypeScript port of `lib.rs`).
 *
 * ONE ENGINE, TWO CONSUMERS: the browser (live play, attacker = distilled model) and
 * the Node trainer (attacker = branching search) drive this identically through the
 * {@link Attacker} interface. Nothing here renders, learns, or searches.
 *
 * Determinism contract (PHASE0.md §1): fixed timestep, fixed-point math, entities in
 * arrays iterated in stable id order (never Map key order for logic).
 *
 * This file is grown in the Phase 0 build order; build/sell + economy land first, then
 * fields, entities, towers, the wave parser, and finally step().
 */
import { fx, type Fx } from './fx.ts';
import { Rng } from './fx.ts';
import { Element } from './element.ts';
import { Grid } from './grid.ts';
import { Fields } from './fields.ts';
import { PlayerState } from './player.ts';
import {
  OccKind, Tier, NodeKind,
  type Cell, type Tower, type Mob, type TowerId,
} from './types.ts';
import {
  type Config, WALL_COST, WALL_HP, refund, towerCost, towerStats,
} from './config.ts';

export class Sim {
  readonly cfg: Config;
  readonly grid: Grid;
  readonly fields: Fields;
  readonly player: PlayerState;
  readonly rng: Rng;

  /** id-indexed; null = freed slot (freelist reuse keeps ids stable for iteration). */
  readonly towers: (Tower | null)[] = [];
  private freeTowerIds: TowerId[] = [];
  readonly mobs: Mob[] = [];

  tick = 0;
  private _coreHp: Fx;
  /** Set when the maze (wall layout) changes; drives a single field recompute per tick. */
  mazeDirty = true;

  constructor(cfg: Config, grid: Grid, starting: Element) {
    this.cfg = cfg;
    this.grid = grid;
    this.player = new PlayerState(starting, cfg.startCurrency);
    this.rng = new Rng(cfg.seed);
    this._coreHp = cfg.coreHp;
    this.fields = new Fields(grid);
    this.mazeDirty = false; // Fields ctor just computed a fresh field
  }

  /** Recompute flow fields iff the maze changed. Called at §2 step 6; exposed so the
   *  build phase and tests can read a current field after building/selling walls. */
  syncFields(): void {
    if (this.mazeDirty) {
      this.fields.recompute(this.grid);
      this.mazeDirty = false;
    }
  }

  static create(cfg: Config, starting: Element): Sim {
    return new Sim(cfg, Grid.basic(cfg.gridW, cfg.gridH), starting);
  }

  coreHp(): Fx {
    return this._coreHp;
  }

  // ---- build phase (player) -------------------------------------------------------

  /** Pay the one-time attunement to unlock a non-starting element's tree (§3.4). */
  attune(e: Element): boolean {
    return this.player.attune(e);
  }

  /** Build an element node. Requires buildable+empty cell, attuned+tier reachable+affordable.
   *  Towers never affect pathing, so this never dirties the maze. */
  buildTower(cell: Cell, e: Element, tier: Tier, kind: NodeKind): boolean {
    if (!this.grid.inBounds(cell)) return false;
    const info = this.grid.get(cell);
    if (!info.buildable || info.occ.kind !== OccKind.Empty) return false;
    const cost = towerCost(kind, tier);
    if (!this.player.chargeBuild(e, tier, cost)) return false;
    const stats = towerStats(e, tier, kind);
    const id = this.freeTowerIds.pop() ?? this.towers.length;
    const tower: Tower = {
      id, cell, element: e, tier, kind,
      dps: stats.dps, range: stats.range, priority: stats.priority, flags: stats.flags,
    };
    if (id === this.towers.length) this.towers.push(tower);
    else this.towers[id] = tower;
    this.grid.setOcc(cell, { kind: OccKind.Tower, tower: id });
    return true;
  }

  /** The universal breakable wall (§3.3). Marks the maze dirty for a field recompute. */
  buildWall(cell: Cell): boolean {
    if (!this.grid.inBounds(cell)) return false;
    const info = this.grid.get(cell);
    if (!info.buildable || info.occ.kind !== OccKind.Empty) return false;
    if (this.player.currency < WALL_COST) return false;
    this.player.currency -= WALL_COST;
    this.grid.setOcc(cell, { kind: OccKind.Wall, hp: WALL_HP });
    this.mazeDirty = true;
    return true;
  }

  /** Sell a wall or tower; refund a fraction of build cost. Walls dirty the maze. */
  sell(cell: Cell): boolean {
    if (!this.grid.inBounds(cell)) return false;
    const occ = this.grid.get(cell).occ;
    if (occ.kind === OccKind.Wall) {
      this.player.currency += refund(WALL_COST);
      this.grid.setOcc(cell, { kind: OccKind.Empty });
      this.mazeDirty = true;
      return true;
    }
    if (occ.kind === OccKind.Tower) {
      const t = this.towers[occ.tower];
      if (t) {
        this.player.currency += refund(towerCost(t.kind, t.tier));
        this.towers[occ.tower] = null;
        this.freeTowerIds.push(occ.tower);
      }
      this.grid.setOcc(cell, { kind: OccKind.Empty });
      return true;
    }
    return false;
  }

  /** Live towers in stable id order (skips freed slots). */
  liveTowers(): Tower[] {
    const out: Tower[] = [];
    for (const t of this.towers) if (t) out.push(t);
    return out;
  }
}

/** Cell-unit helper: centre position of a cell in Fx. */
export function cellCenter(c: Cell): { x: Fx; y: Fx } {
  return { x: fx(c.x) + (fx(1) >> 1), y: fx(c.y) + (fx(1) >> 1) };
}
