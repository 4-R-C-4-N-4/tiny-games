/**
 * td_sim — Phase 0 deterministic simulation core (TypeScript port of `lib.rs`).
 *
 * ONE ENGINE, TWO CONSUMERS: the browser (live play, attacker = distilled model) and
 * the Node trainer (attacker = branching search) drive this identically through the
 * {@link Attacker} interface. Nothing here renders, learns, or searches.
 *
 * Determinism contract (PHASE0.md §1): fixed timestep, fixed-point math, entities in
 * arrays iterated in stable id order (never Map key order for logic).
 */
import { fx, fxMul, fxDiv, fxToInt, fxToFloat, FX_SHIFT, FX_ONE, Rng, type Fx } from './fx.ts';
import { Element, N_ELEMENTS, typeMult } from './element.ts';
import { Grid } from './grid.ts';
import { Fields } from './fields.ts';
import { PlayerState } from './player.ts';
import {
  OccKind, Tier, NodeKind, Trait, TargetPriority,
  type Cell, type Pos, type Tower, type Mob, type TowerId, type MobId,
  type Metrics, type Observation, type CellFeatures, type BuildProfile,
  type DecisionContext, type StepOutcome, type PlayerVerb,
} from './types.ts';
import {
  type Config, WALL_COST, WALL_HP, refund, towerCost, towerStats, mobStats,
  BREAKER_WALL_DPS, MOB_WALL_DPS, MENDER_HEAL_RADIUS, SPLASH_RADIUS, leakDamage, budgetFor, bounty, harvestBonus,
  waveMobScale, waveLeakScale, WARD_RADIUS, HASTE_RADIUS, BURN_SECS, EARTH_WALL_CAP, DARK_RAMP_CAP,
  VERB_RADIUS, OVERCHARGE_MULT, OVERCHARGE_SECS, REVEAL_SECS, REINFORCE_HP,
} from './config.ts';
import type { Opener, Commit } from './wave.ts';

/** Centre position of a cell in Fx cell-units. */
export function cellCenter(c: Cell): Pos {
  return { x: (c.x << FX_SHIFT) + (FX_ONE >> 1), y: (c.y << FX_SHIFT) + (FX_ONE >> 1) };
}

/** The integer cell a position falls in (positions are always non-negative on the grid). */
function cellOf(p: Pos): Cell {
  return { x: p.x >> FX_SHIFT, y: p.y >> FX_SHIFT };
}

/** Squared Fx distance between two positions (avoids a sqrt — determinism + speed). */
function dist2(a: Pos, b: Pos): Fx {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return fxMul(dx, dx) + fxMul(dy, dy);
}

/** An opener/reserve spawn resolved to an absolute tick. */
interface ScheduledSpawn {
  tick: number;
  x: number;
  element: Element;
  trait: Trait;
  count: number;
}

/** A transient in-wave effect from a player verb (§2). Pruned when `until` passes. */
interface Effect {
  kind: 'overcharge' | 'reveal';
  cx: Fx;
  cy: Fx;
  r2: Fx;
  until: number; // tick it expires
}

function emptyMetrics(): Metrics {
  return {
    leakedHp: 0,
    timeToFirstLeak: -1,
    overkill: 0,
    dpsUtil: new Array(N_ELEMENTS).fill(0),
    currencyDelta: 0,
    breaches: 0,
    fireMisalloc: 0,
  };
}

export class Sim {
  readonly cfg: Config;
  readonly grid: Grid;
  readonly fields: Fields;
  readonly player: PlayerState;
  readonly rng: Rng;

  /** id-indexed; null = freed slot (freelist reuse keeps ids stable for iteration). */
  readonly towers: (Tower | null)[] = [];
  private freeTowerIds: TowerId[] = [];
  /** id-indexed; `alive=false` = tombstone (freelist reuse keeps ids stable). */
  readonly mobs: Mob[] = [];
  private freeMobIds: MobId[] = [];

  tick = 0;
  private _coreHp: Fx;
  mazeDirty = true;
  /** Active in-wave verb effects (overcharge/reveal zones). */
  private effects: Effect[] = [];

  // ---- wave state ----
  private waveActive = false;
  private waveNum = 0;
  private diff = 0;
  private budget = 0;
  private waveBaseTick = 0;
  private pending: ScheduledSpawn[] = [];
  private reserveLeft = 0;
  private decisionTicks: number[] = [];
  private nextDecisionIdx = 0;
  private waveMaxTick = 0;
  private metrics: Metrics = emptyMetrics();

  constructor(cfg: Config, grid: Grid, starting: Element) {
    this.cfg = cfg;
    this.grid = grid;
    this.player = new PlayerState(starting, cfg.startCurrency);
    this.rng = new Rng(cfg.seed);
    this._coreHp = cfg.coreHp;
    this.fields = new Fields(grid);
    this.mazeDirty = false;
  }

  static create(cfg: Config, starting: Element): Sim {
    return new Sim(cfg, Grid.basic(cfg.gridW, cfg.gridH), starting);
  }

  /**
   * Deep fork of the entire sim state. The search (and Phase 1.5 branching) plays
   * candidate waves on a clone and discards it, never touching the live game. `cfg` is
   * shared by reference (it's immutable tuning data); everything mutable is copied.
   */
  clone(): Sim {
    const s = Object.create(Sim.prototype) as {
      -readonly [K in keyof Sim]: Sim[K];
    } & Record<string, unknown>;
    s.cfg = this.cfg;
    s.grid = this.grid.clone();
    s.fields = this.fields.clone();
    s.player = this.player.clone();
    s.rng = this.rng.clone();
    s.towers = this.towers.map((t) => (t ? { ...t, cell: { ...t.cell }, flags: { ...t.flags } } : null));
    s.freeTowerIds = this.freeTowerIds.slice();
    s.mobs = this.mobs.map((m) => ({
      ...m, pos: { ...m.pos }, flags: { ...m.flags },
      breachCell: m.breachCell ? { ...m.breachCell } : null,
    }));
    s.freeMobIds = this.freeMobIds.slice();
    s.tick = this.tick;
    s._coreHp = this._coreHp;
    s.mazeDirty = this.mazeDirty;
    s.effects = this.effects.map((e) => ({ ...e }));
    s.waveActive = this.waveActive;
    s.waveNum = this.waveNum;
    s.diff = this.diff;
    s.budget = this.budget;
    s.waveBaseTick = this.waveBaseTick;
    s.pending = this.pending.map((p) => ({ ...p }));
    s.reserveLeft = this.reserveLeft;
    s.decisionTicks = this.decisionTicks.slice();
    s.nextDecisionIdx = this.nextDecisionIdx;
    s.waveMaxTick = this.waveMaxTick;
    s.metrics = { ...this.metrics, dpsUtil: this.metrics.dpsUtil.slice() };
    return s as unknown as Sim;
  }

  coreHp(): Fx {
    return this._coreHp;
  }

  /** Recompute flow fields iff the maze changed. Called at §2 step 6; also exposed so the
   *  build phase and tests can read a current field after building/selling walls. */
  syncFields(): void {
    if (this.mazeDirty) {
      this.fields.recompute(this.grid);
      this.mazeDirty = false;
    }
  }

  liveTowers(): Tower[] {
    const out: Tower[] = [];
    for (const t of this.towers) if (t) out.push(t);
    return out;
  }

  liveMobs(): Mob[] {
    const out: Mob[] = [];
    for (const m of this.mobs) if (m.alive) out.push(m);
    return out;
  }

  // ================================================================================
  // Build phase (player)
  // ================================================================================

  attune(e: Element): boolean {
    return this.player.attune(e);
  }

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
      dps: stats.dps, range: stats.range, priority: stats.priority, flags: stats.flags, aura: stats.aura, kills: 0,
    };
    if (id === this.towers.length) this.towers.push(tower);
    else this.towers[id] = tower;
    this.grid.setOcc(cell, { kind: OccKind.Tower, tower: id });
    return true; // towers never affect pathing → no maze recompute
  }

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

  // ================================================================================
  // Wave lifecycle
  // ================================================================================

  /** Begin a wave: schedule the telegraphed opener, arm the reserve, place decision
   *  points at config-owned ticks (so search and model react at identical ticks). */
  beginWave(opener: Opener, reservePool: number, wave: number, diff: number): void {
    this.syncFields();
    this.waveActive = true;
    this.waveNum = wave;
    this.diff = diff;
    this.budget = budgetFor(wave, diff);
    this.reserveLeft = reservePool;
    this.waveBaseTick = this.tick;
    this.metrics = emptyMetrics();
    this.pending = [];
    for (const s of opener) {
      this.scheduleGroup(this.waveBaseTick + this.secToTick(s.t), s.x, s.group.element, s.group.trait, s.group.count);
    }
    const horizon = this.secToTick(this.cfg.waveSeconds);
    // Pure anti-hang backstop. Mobs always make strictly-decreasing progress (or leak /
    // die / breach a finite-HP wall), so a wave always terminates on its own; this only
    // guards against a logic bug. Sized well past the slowest mob crossing the whole grid.
    this.waveMaxTick = this.waveBaseTick + horizon + this.grid.w * this.grid.h * 80;
    this.decisionTicks = [];
    const n = this.cfg.decisionPoints;
    for (let i = 1; i <= n; i++) {
      this.decisionTicks.push(this.waveBaseTick + Math.round((i / (n + 1)) * horizon));
    }
    this.nextDecisionIdx = 0;
  }

  /** Announce the upcoming wave so a pre-wave observe() reports the right budget/wave/diff
   *  (the attacker's open() reads the board before beginWave). beginWave re-sets these. */
  prepareWave(wave: number, diff: number): void {
    this.waveNum = wave;
    this.diff = diff;
    this.budget = budgetFor(wave, diff);
  }

  /** The wave number currently announced (0 before the first prepareWave/beginWave). */
  waveNumber(): number {
    return this.waveNum;
  }

  private secToTick(t: Fx): number {
    return fxToInt(fxDiv(t, this.cfg.dt));
  }

  /** Spend reserve and inject the committed spawns (fired from a decision point). */
  commit(commits: Commit[]): void {
    for (const c of commits) {
      const cost = mobStats(c.group.trait).cost * c.group.count;
      if (cost > this.reserveLeft) continue; // parser guards this, but clamp defensively
      this.reserveLeft -= cost;
      // Enter next tick; breachers path to walls autonomously (the gate is a hint the
      // validator checked was a real wall — Phase 0 needs no extra steering).
      this.scheduleGroup(this.tick + 1, c.x, c.group.element, c.group.trait, c.group.count);
    }
  }

  /** Apply an in-wave player verb (§2). Overcharge/Reveal drop a timed zone; Reinforce
   *  restores a wall immediately. The Game gates how many charges the player has. */
  playerVerb(verb: PlayerVerb): boolean {
    const c = cellCenter(verb.cell);
    const r2 = fxMul(VERB_RADIUS, VERB_RADIUS);
    if (verb.kind === 'overcharge') {
      this.effects.push({ kind: 'overcharge', cx: c.x, cy: c.y, r2, until: this.tick + this.secToTick(OVERCHARGE_SECS) });
      return true;
    }
    if (verb.kind === 'reveal') {
      this.effects.push({ kind: 'reveal', cx: c.x, cy: c.y, r2, until: this.tick + this.secToTick(REVEAL_SECS) });
      return true;
    }
    // reinforce
    if (!this.grid.inBounds(verb.cell)) return false;
    const occ = this.grid.get(verb.cell).occ;
    if (occ.kind !== OccKind.Wall) return false;
    this.grid.setOcc(verb.cell, { kind: OccKind.Wall, hp: REINFORCE_HP });
    return true;
  }

  /** Active verb zones in cell units (for rendering). */
  activeEffects(): { kind: 'overcharge' | 'reveal'; x: number; y: number; r: number }[] {
    return this.effects
      .filter((e) => e.until >= this.tick)
      .map((e) => ({ kind: e.kind, x: fxToFloat(e.cx), y: fxToFloat(e.cy), r: fxToFloat(VERB_RADIUS) }));
  }

  private effectActive(kind: 'overcharge' | 'reveal', p: Pos): boolean {
    for (const e of this.effects) {
      if (e.kind !== kind || e.until < this.tick) continue;
      const dx = e.cx - p.x, dy = e.cy - p.y;
      if (fxMul(dx, dx) + fxMul(dy, dy) <= e.r2) return true;
    }
    return false;
  }

  /** Schedule a group to STREAM in one mob at a time (staggered), so a group reads as a
   *  file of creatures marching, not a single stack of overlapping sprites at one point. */
  private scheduleGroup(baseTick: number, x: number, element: Element, trait: Trait, count: number): void {
    // Stagger the file, but bound the whole group's spawn window to ~2s so a big late-wave
    // group still arrives as a dense flood, not a minutes-long trickle. gap ∈ [1, 6] ticks.
    const WINDOW = 60; // ticks (~2s at 30Hz)
    const gap = count > 1 ? Math.max(1, Math.min(6, Math.floor(WINDOW / count))) : 6;
    for (let k = 0; k < count; k++) {
      this.pending.push({ tick: baseTick + k * gap, x, element, trait, count: 1 });
    }
  }

  /** Directly spawn a group at a spawn column (used by the schedule and by tests). */
  spawnGroup(x: number, element: Element, trait: Trait, count: number): void {
    const st = mobStats(trait);
    const spawnCell: Cell = { x, y: 0 };
    const center = cellCenter(spawnCell);
    // Late-wave toughness: spawned mobs get spongier so the assault scales without needing an
    // un-renderable body count (waveNum is 0 in unit tests → scale 1, no effect there).
    const hp = fxMul(st.hp, waveMobScale(this.waveNum));
    for (let i = 0; i < count; i++) {
      const id = this.freeMobIds.pop() ?? this.mobs.length;
      // Small deterministic per-mob offset so a clump never renders as one stacked sprite
      // (id-based → still fully deterministic). It washes out as they align to the lane.
      const jx = (((id * 7) % 5) - 2) * (FX_ONE >> 3); // ±0.25 cell
      const jy = ((id * 3) % 4) * (FX_ONE >> 4); //       0…0.19 cell down
      const mob: Mob = {
        id, element, trait,
        pos: { x: center.x + jx, y: center.y + jy },
        hp, maxHp: hp, speed: st.speed,
        flags: { ...st.flags }, shieldHits: st.shieldHits,
        entryX: x, alive: true, slowMul: FX_ONE, damageTaken: 0, breachCell: null,
        lastHitElement: null, lastHitTower: -1, burnDps: 0, burnTicks: 0,
      };
      if (id === this.mobs.length) this.mobs.push(mob);
      else this.mobs[id] = mob;
    }
  }

  // ================================================================================
  // The tick — canonical update order (PHASE0 §2). DO NOT REORDER.
  // ================================================================================

  step(): StepOutcome {
    this.tick += 1; // §2.1

    if (this.effects.length) this.effects = this.effects.filter((e) => e.until >= this.tick);
    this.processSpawns(); // §2.2
    this.moveMobs(); // §2.3 + §2.4 (intended movement, move, leaks)
    this.applyBreachDamage(); // §2.5
    if (this.mazeDirty) this.syncFields(); // §2.6 (recompute once)
    this.towersFire(); // §2.7 (typing × shield × splash × slow, dpsUtil)
    this.tickBurns(); // §2.7b Pyromancy burn DoT
    this.resolveDeaths(); // §2.8 (bounty → currency)
    this.menderRegen(); // §2.9
    // §2.10 metrics accumulate inline in the phases above.

    return this.outcome(); // §2.11
  }

  private processSpawns(): void {
    if (this.pending.length === 0) return;
    // Fire any spawn due this tick OR earlier: step() increments the tick before this
    // phase, so a spawn scheduled for tick 0 (opener t=0) is due on the first step. Using
    // <= also makes scheduling robust to rounding. Insertion order (opener, then commits)
    // is preserved, so the spawn order is deterministic.
    const due = this.pending.filter((s) => s.tick <= this.tick);
    if (due.length === 0) return;
    for (const s of due) this.spawnGroup(s.x, s.element, s.trait, s.count);
    this.pending = this.pending.filter((s) => s.tick > this.tick);
  }

  private moveMobs(): void {
    const core = this.grid.coreCell();
    const coreCenter = cellCenter(core);
    for (const m of this.mobs) {
      if (!m.alive) continue;
      m.breachCell = null;
      // Strongest slow wins (tower-applied this-tick slow vs a standing Emitter slow field);
      // a Totem's haste aura then speeds the survivor back up.
      let mult = m.slowMul;
      const fieldSlow = this.fieldSlowMul(m.pos);
      if (fieldSlow < mult) mult = fieldSlow;
      let budget = fxMul(fxMul(m.speed, this.cfg.dt), mult);
      const haste = this.mobHaste(m.pos);
      if (haste > 0) budget = fxMul(budget, FX_ONE + haste);
      m.slowMul = FX_ONE; // slow lasts exactly one tick; slow towers re-apply in §2.7

      if (m.flags.flier) {
        // Fliers ignore walls: straight line to the Core (manhattan-budget, no sqrt).
        if (this.moveToward(m.pos, coreCenter, budget)) {
          this.leak(m);
        }
        continue;
      }

      const cell = cellOf(m.pos);
      if (cell.x === core.x && cell.y === core.y) {
        this.leak(m);
        continue;
      }
      const next = this.fields.stepWalled(this.grid, cell);
      if (next) {
        const reached = this.moveToward(m.pos, cellCenter(next), budget);
        if (reached && next.x === core.x && next.y === core.y) this.leak(m);
      } else {
        // Blocked (walled route sealed): choose a wall to breach along the open gradient.
        m.breachCell = this.fields.breachTarget(this.grid, cell);
      }
    }
  }

  /** Move `pos` toward `target` by `budget`, splitting across axes by remaining distance
   *  (manhattan metric — deterministic, no sqrt). Returns true if it reached the target. */
  private moveToward(pos: Pos, target: Pos, budget: Fx): boolean {
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const total = Math.abs(dx) + Math.abs(dy);
    if (total === 0) return true;
    if (total <= budget) {
      pos.x = target.x;
      pos.y = target.y;
      return true;
    }
    pos.x += fxMul(budget, fxDiv(dx, total));
    pos.y += fxMul(budget, fxDiv(dy, total));
    return false;
  }

  private leak(m: Mob): void {
    const dmg = fxMul(leakDamage(m.trait), waveLeakScale(this.waveNum)); // late leaks bite harder
    this._coreHp -= dmg;
    this.metrics.leakedHp += dmg;
    this.metrics.fireMisalloc += m.damageTaken; // fire invested in a mob that leaked anyway
    if (this.metrics.timeToFirstLeak < 0) {
      this.metrics.timeToFirstLeak = fxMul((this.tick - this.waveBaseTick) << FX_SHIFT, this.cfg.dt);
    }
    this.killMob(m);
  }

  private applyBreachDamage(): void {
    for (const m of this.mobs) {
      if (!m.alive || !m.breachCell) continue;
      const wallCell = m.breachCell;
      const occ = this.grid.get(wallCell).occ;
      if (occ.kind !== OccKind.Wall) continue; // already gone
      const wdps = m.flags.breaker ? BREAKER_WALL_DPS : MOB_WALL_DPS;
      const dmg = fxMul(wdps, this.cfg.dt);
      const hp = occ.hp - dmg;
      if (hp <= 0) {
        this.grid.setOcc(wallCell, { kind: OccKind.Empty });
        this.mazeDirty = true;
        this.metrics.breaches += 1;
      } else {
        this.grid.setOcc(wallCell, { kind: OccKind.Wall, hp });
      }
    }
  }

  private towersFire(): void {
    for (const t of this.towers) {
      if (!t || t.dps <= 0) continue; // support roles (Pylon/Emitter) don't fire — they project auras
      const target = this.acquire(t);
      if (!target) continue;
      let base = fxMul(t.dps, this.cfg.dt);
      // Geomancy: an Earth ward channels through the stone — +30% damage per adjacent wall.
      if (t.flags.wallAmp > 0) {
        const walls = Math.min(EARTH_WALL_CAP, this.adjacentWalls(t.cell));
        if (walls > 0) base = fxMul(base, FX_ONE + fxMul(t.flags.wallAmp, walls << FX_SHIFT));
      }
      // Umbra: a Void ward grows in ruin — +6% damage per kill it has landed (capped).
      if (t.flags.ramp > 0 && t.kills > 0) {
        base = fxMul(base, FX_ONE + fxMul(t.flags.ramp, Math.min(DARK_RAMP_CAP, t.kills) << FX_SHIFT));
      }
      // Pylon buff: allied turrets standing in a Pylon's aura hit harder.
      const buff = this.pylonBuff(t.cell);
      if (buff !== FX_ONE) base = fxMul(base, buff);
      // Overcharge verb: towers inside an active zone fire much harder.
      if (this.effects.length && this.effectActive('overcharge', cellCenter(t.cell))) {
        base = fxMul(base, OVERCHARGE_MULT);
      }
      this.damageMob(t, target, base, /*isSplash=*/ false);
      if (t.flags.splash > 0) {
        const splashDmg = fxMul(base, t.flags.splash);
        const r2 = fxMul(SPLASH_RADIUS, SPLASH_RADIUS);
        for (const o of this.mobs) {
          if (!o.alive || o.id === target.id) continue;
          if (dist2(o.pos, target.pos) <= r2 && this.canHit(t, o)) {
            this.damageMob(t, o, splashDmg, /*isSplash=*/ true);
          }
        }
      }
    }
  }

  /** Can tower `t` legally hit mob `m`? Fliers need antiAir; Shades need detection (or a
   *  Reveal verb zone covering the mob). */
  private canHit(t: Tower, m: Mob): boolean {
    if (m.flags.flier && !t.flags.antiAir) return false;
    if (m.flags.stealth && !t.flags.detection && !this.effectActive('reveal', m.pos) && !this.fieldDetect(m.pos)) return false;
    return true;
  }

  private acquire(t: Tower): Mob | null {
    const center = cellCenter(t.cell);
    const r2 = fxMul(t.range, t.range);
    let best: Mob | null = null;
    for (const m of this.mobs) {
      if (!m.alive || !this.canHit(t, m)) continue;
      if (dist2(center, m.pos) > r2) continue;
      if (!best || this.preferred(t.priority, m, best)) best = m;
    }
    return best;
  }

  /** True if `m` is preferred over `cur` under `priority`; ties fall through to stable id
   *  order (the loop visits ascending ids, so we only replace on a STRICT improvement). */
  private preferred(priority: TargetPriority, m: Mob, cur: Mob): boolean {
    switch (priority) {
      case TargetPriority.First: // furthest along = smallest distCore
        return this.distCore(m) < this.distCore(cur);
      case TargetPriority.Strongest:
        return m.hp > cur.hp;
      case TargetPriority.Fastest:
        return m.speed > cur.speed;
      case TargetPriority.Flying:
        if (m.flags.flier !== cur.flags.flier) return m.flags.flier;
        return this.distCore(m) < this.distCore(cur);
    }
  }

  private distCore(m: Mob): number {
    return this.fields.distCore(this.grid, cellOf(m.pos));
  }

  private damageMob(t: Tower, m: Mob, rawDamage: Fx, isSplash: boolean): void {
    // Shielded absorbs a whole hit (primary hits only; splash doesn't burn shields)...
    if (m.shieldHits > 0 && !isSplash) {
      if (t.flags.disrupt) m.shieldHits = 0; // ...but Resonance shatters the whole ward and rings on through
      else { m.shieldHits -= 1; return; }
    }
    let dmg = fxMul(rawDamage, typeMult(t.element, m.element));
    const vuln = this.fieldVuln(m.pos); //   Emitter (vulnerable) field amplifies incoming damage
    if (vuln !== FX_ONE) dmg = fxMul(dmg, vuln);
    const ward = this.mobWard(m.pos); //     Warden aura soaks a fraction of it
    if (ward > 0) dmg = fxMul(dmg, FX_ONE - ward);
    const hpBefore = m.hp;
    const applied = dmg > hpBefore ? hpBefore : dmg;
    m.hp -= dmg;
    m.damageTaken += applied;
    if (applied > 0) { m.lastHitElement = t.element; m.lastHitTower = t.id; } // credit the ward (harvest bounty + ramp)
    // Pyromancy: a primary Fire hit sets the mob alight — a burn DoT that lingers/refreshes.
    if (!isSplash && t.flags.burn > 0) {
      m.burnDps = fxMul(t.dps, t.flags.burn);
      m.burnTicks = this.secToTick(BURN_SECS);
    }
    this.metrics.dpsUtil[t.element] += applied;
    if (dmg > hpBefore) this.metrics.overkill += dmg - hpBefore;
    if (t.flags.slow > 0 && !isSplash) {
      // Slow applies next tick: keep the strongest slow seen this tick.
      const mul = FX_ONE - t.flags.slow;
      if (mul < m.slowMul) m.slowMul = mul;
    }
  }

  /** Pyromancy's lingering burn: a per-tick DoT independent of range, typing, or shields. */
  private tickBurns(): void {
    for (const m of this.mobs) {
      if (!m.alive || m.burnTicks <= 0) continue;
      const dmg = fxMul(m.burnDps, this.cfg.dt);
      m.damageTaken += dmg > m.hp ? m.hp : dmg;
      m.hp -= dmg;
      this.metrics.dpsUtil[Element.Fire] += dmg > 0 ? dmg : 0; // burn is Fire's damage
      m.burnTicks -= 1;
    }
  }

  /** Orthogonally-adjacent wall count for a tower cell (drives Geomancy's wall-amp). */
  private adjacentWalls(cell: Cell): number {
    const g = this.grid;
    let n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = cell.x + dx, y = cell.y + dy;
      if (x >= 0 && y >= 0 && x < g.w && y < g.h && g.cells[y * g.w + x].occ.kind === OccKind.Wall) n++;
    }
    return n;
  }

  private resolveDeaths(): void {
    for (const m of this.mobs) {
      if (!m.alive || m.hp > 0) continue;
      // Umbra harvests: a Dark ward's kill reaps a bounty bonus (kills → power).
      const b = bounty(m.trait) + (m.lastHitElement === Element.Dark ? harvestBonus(m.trait) : 0);
      this.player.currency += b;
      this.metrics.currencyDelta += b;
      // …and that Void ward grows in ruin: the killing tower gains a permanent damage stack.
      if (m.lastHitTower >= 0) { const kt = this.towers[m.lastHitTower]; if (kt && kt.flags.ramp > 0) kt.kills += 1; }
      this.killMob(m);
    }
  }

  /** Is `p` inside any Resonance ward's aura? Such a mob is disrupted (Menders there are hushed). */
  private inDisruptAura(p: Pos): boolean {
    for (const t of this.towers) {
      if (!t || !t.flags.disrupt) continue;
      if (dist2(cellCenter(t.cell), p) <= fxMul(t.range, t.range)) return true;
    }
    return false;
  }

  private menderRegen(): void {
    const r2 = fxMul(MENDER_HEAL_RADIUS, MENDER_HEAL_RADIUS);
    for (const healer of this.mobs) {
      if (!healer.alive || healer.flags.regen <= 0) continue;
      if (this.inDisruptAura(healer.pos)) continue; // Resonance silences the healer's channel
      const heal = fxMul(healer.flags.regen, this.cfg.dt);
      for (const m of this.mobs) {
        if (!m.alive || m.hp >= m.maxHp) continue;
        if (dist2(healer.pos, m.pos) <= r2) {
          m.hp += heal;
          if (m.hp > m.maxHp) m.hp = m.maxHp;
        }
      }
    }
  }

  // ---- support-role auras: tower Pylon/Emitter fields + mob Warden/Totem auras ---------

  /** Damage multiplier on a turret from Pylon buff auras covering its cell (FX_ONE = none). */
  private pylonBuff(cell: Cell): Fx {
    const c = cellCenter(cell);
    let mul = FX_ONE;
    for (const t of this.towers) {
      if (!t || !t.aura || t.aura.kind !== 'buff') continue;
      if (dist2(cellCenter(t.cell), c) <= fxMul(t.aura.radius, t.aura.radius)) mul += t.aura.amount;
    }
    return mul;
  }

  /** Damage-taken multiplier on a mob from Emitter 'vulnerable' fields over its position. */
  private fieldVuln(p: Pos): Fx {
    let mul = FX_ONE;
    for (const t of this.towers) {
      if (!t || !t.aura || t.aura.kind !== 'vulnerable') continue;
      if (dist2(cellCenter(t.cell), p) <= fxMul(t.aura.radius, t.aura.radius)) mul += t.aura.amount;
    }
    return mul;
  }

  /** Movement multiplier from the strongest Emitter 'slow' field over a position (FX_ONE = none). */
  private fieldSlowMul(p: Pos): Fx {
    let mul = FX_ONE;
    for (const t of this.towers) {
      if (!t || !t.aura || t.aura.kind !== 'slow') continue;
      if (dist2(cellCenter(t.cell), p) <= fxMul(t.aura.radius, t.aura.radius)) {
        const m = FX_ONE - t.aura.amount;
        if (m < mul) mul = m;
      }
    }
    return mul;
  }

  /** Is a position inside an Emitter 'detect' field (Shades revealed, like a Reveal verb)? */
  private fieldDetect(p: Pos): boolean {
    for (const t of this.towers) {
      if (!t || !t.aura || t.aura.kind !== 'detect') continue;
      if (dist2(cellCenter(t.cell), p) <= fxMul(t.aura.radius, t.aura.radius)) return true;
    }
    return false;
  }

  /** Strongest Warden damage-reduction fraction covering a position (0 = none). */
  private mobWard(p: Pos): Fx {
    const r2 = fxMul(WARD_RADIUS, WARD_RADIUS);
    let best = 0;
    for (const w of this.mobs) {
      if (!w.alive || w.flags.ward <= 0) continue;
      if (dist2(w.pos, p) <= r2 && w.flags.ward > best) best = w.flags.ward;
    }
    return best;
  }

  /** Strongest Totem haste fraction covering a position (0 = none). */
  private mobHaste(p: Pos): Fx {
    const r2 = fxMul(HASTE_RADIUS, HASTE_RADIUS);
    let best = 0;
    for (const t of this.mobs) {
      if (!t.alive || t.flags.haste <= 0) continue;
      if (dist2(t.pos, p) <= r2 && t.flags.haste > best) best = t.flags.haste;
    }
    return best;
  }

  private killMob(m: Mob): void {
    m.alive = false;
    m.breachCell = null;
    this.freeMobIds.push(m.id);
  }

  private outcome(): StepOutcome {
    // A shattered Core ends the run immediately — this MUST win over wave-complete, or a
    // final mob that both leaks the killing blow AND empties the wave would be scored as a
    // completed wave and the game would carry on into the next build phase.
    if (this._coreHp <= 0) { this.waveActive = false; return { kind: 'gameOver' }; }
    if (this.nextDecisionIdx < this.decisionTicks.length &&
        this.tick === this.decisionTicks[this.nextDecisionIdx]) {
      this.nextDecisionIdx += 1;
      return { kind: 'decision', obs: this.observe() };
    }
    const decisionsDone = this.nextDecisionIdx >= this.decisionTicks.length;
    const drained = this.pending.length === 0;
    const noMobs = !this.mobs.some((m) => m.alive);
    if (this.waveActive && decisionsDone && drained && noMobs) {
      this.waveActive = false;
      return { kind: 'waveComplete', metrics: this.metrics };
    }
    if (this.tick >= this.waveMaxTick && this.waveActive) {
      // Safety: mobs always make progress, but never hang the driver.
      this.waveActive = false;
      return { kind: 'waveComplete', metrics: this.metrics };
    }
    return { kind: 'continue' };
  }

  // ================================================================================
  // Observation (§4.2) — the model's input tensor and the search's read model.
  // ================================================================================

  observe(): Observation {
    const { w, h } = this.grid;
    const cells: CellFeatures[] = new Array(w * h);
    for (let i = 0; i < w * h; i++) {
      cells[i] = {
        dps: new Array(N_ELEMENTS).fill(0),
        control: 0, antiAir: 0, detection: 0, wallHp: 0,
        buildable: this.grid.cells[i].buildable, distCore: this.fields.costWalled[i],
      };
    }
    // Wall HP channel.
    for (let i = 0; i < w * h; i++) {
      const occ = this.grid.cells[i].occ;
      if (occ.kind === OccKind.Wall) cells[i].wallHp = occ.hp;
    }
    // Coverage: each tower contributes its DPS to every cell within range.
    for (const t of this.towers) {
      if (!t) continue;
      const center = cellCenter(t.cell);
      const r2 = fxMul(t.range, t.range);
      const rCells = fxToInt(t.range) + 1;
      for (let y = Math.max(0, t.cell.y - rCells); y <= Math.min(h - 1, t.cell.y + rCells); y++) {
        for (let x = Math.max(0, t.cell.x - rCells); x <= Math.min(w - 1, t.cell.x + rCells); x++) {
          if (dist2(center, cellCenter({ x, y })) > r2) continue;
          const f = cells[y * w + x];
          f.dps[t.element] += t.dps;
          if (t.flags.slow > 0) f.control += t.dps;
          if (t.flags.antiAir) f.antiAir += t.dps;
          if (t.flags.detection) f.detection += t.dps;
        }
      }
    }
    const profile: BuildProfile = {
      starting: this.player.starting,
      attuned: this.player.attuned.slice(),
      depth: this.player.depth.slice(),
    };
    return { w, h, cells, profile, budget: this.budget, wave: this.waveNum, diff: this.diff };
  }

  /** State handed to the attacker at a decision point. */
  decisionContext(): DecisionContext {
    return {
      obs: this.observe(),
      reserveLeft: this.reserveLeft,
      coreHp: this._coreHp,
      t: fxMul((this.tick - this.waveBaseTick) << FX_SHIFT, this.cfg.dt),
      pointIndex: this.nextDecisionIdx - 1,
    };
  }

  metricsSnapshot(): Metrics {
    return this.metrics;
  }
}

// re-export for convenience
export { fx };
