/**
 * Game controller — the renderer-agnostic state machine that turns the sim + attacker
 * into a playable loop. It owns the build↔wave↔gameover phases, carries economy and Core
 * HP across waves, and drives the sim one step at a time so a renderer can animate it (or
 * a headless test can fast-forward it). All game rules live in the sim; this only
 * sequences them and gates player actions to the build phase.
 */
import { fxToFloat, type Fx } from './fx.ts';
import { Element } from './element.ts';
import { Tier, NodeKind, type Cell } from './types.ts';
import type { Metrics } from './types.ts';
import { DEFAULT_CONFIG, type Config } from './config.ts';
import { Sim } from './sim.ts';
import { SearchAttacker, type SearchOptions } from './search.ts';
import type { Opener } from './wave.ts';

export type GameState = 'build' | 'wave' | 'gameover';

export interface GameOptions {
  starting?: Element;
  difficulty?: number; // 1 (gentle) … 5 (brutal) — maps to the search's top-K
  seed?: bigint; // makes a whole run reproducible
  config?: Config;
}

/** Map difficulty to the search's beatability knob: lower diff picks a weaker top-K. */
function searchOptsForDiff(diff: number, seed: bigint): SearchOptions {
  const topK = diff >= 5 ? 1 : diff >= 4 ? 2 : diff >= 3 ? 3 : diff >= 2 ? 4 : 6;
  return { seed, topK };
}

export class Game {
  readonly sim: Sim;
  readonly attacker: SearchAttacker;
  readonly diff: number;
  wave = 1;
  state: GameState = 'build';
  /** The telegraphed opener for the current/last wave (composition the player can plan against). */
  telegraph: Opener = [];
  lastMetrics: Metrics | null = null;
  highestWave = 1;

  constructor(opts: GameOptions = {}) {
    const cfg = opts.config ?? DEFAULT_CONFIG;
    const starting = opts.starting ?? Element.Fire;
    this.diff = opts.difficulty ?? 3;
    this.sim = Sim.create(cfg, starting);
    this.attacker = new SearchAttacker(this.sim, searchOptsForDiff(this.diff, opts.seed ?? 0xd15ea5en));
  }

  // ---- build phase actions (ignored unless in the build phase) --------------------

  buildTower(cell: Cell, e: Element, tier: Tier, kind: NodeKind): boolean {
    return this.state === 'build' && this.sim.buildTower(cell, e, tier, kind);
  }
  buildWall(cell: Cell): boolean {
    return this.state === 'build' && this.sim.buildWall(cell);
  }
  sell(cell: Cell): boolean {
    return this.state === 'build' && this.sim.sell(cell);
  }
  attune(e: Element): boolean {
    return this.state === 'build' && this.sim.attune(e);
  }

  // ---- wave lifecycle -------------------------------------------------------------

  /** Leave the build phase: the attacker reads the board and commits its opener. */
  startWave(): void {
    if (this.state !== 'build') return;
    this.sim.syncFields();
    this.sim.prepareWave(this.wave, this.diff);
    const { opener, pool } = this.attacker.open(this.sim.observe());
    this.telegraph = opener;
    this.sim.beginWave(opener, pool, this.wave, this.diff);
    this.state = 'wave';
  }

  /** Advance the active wave by up to `maxSteps` ticks (the speed control). Returns the
   *  number of ticks actually stepped (0 if not in a wave). */
  update(maxSteps = 1): number {
    if (this.state !== 'wave') return 0;
    let n = 0;
    for (; n < maxSteps; n++) {
      const out = this.sim.step();
      if (out.kind === 'continue') continue;
      if (out.kind === 'decision') {
        this.sim.commit(this.attacker.commit(this.sim.decisionContext()));
        continue;
      }
      if (out.kind === 'waveComplete') {
        this.lastMetrics = out.metrics;
        this.endWave();
        n++;
        break;
      }
      // gameOver
      this.lastMetrics = this.sim.metricsSnapshot();
      this.state = 'gameover';
      n++;
      break;
    }
    return n;
  }

  private endWave(): void {
    this.sim.player.currency += this.sim.cfg.waveStipend;
    this.wave += 1;
    this.highestWave = Math.max(this.highestWave, this.wave);
    this.state = 'build';
  }

  // ---- read-only view for the renderer / UI ---------------------------------------

  get currency(): number {
    return this.sim.player.currency;
  }
  coreHp(): Fx {
    return this.sim.coreHp();
  }
  coreHpMax(): Fx {
    return this.sim.cfg.coreHp;
  }
  coreHpFraction(): number {
    return Math.max(0, fxToFloat(this.sim.coreHp()) / fxToFloat(this.sim.cfg.coreHp));
  }
}
