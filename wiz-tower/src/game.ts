/**
 * Game controller — the renderer-agnostic state machine that turns the sim + attacker
 * into a playable loop. It owns the build↔wave↔gameover phases, carries economy and Core
 * HP across waves, and drives the sim one step at a time so a renderer can animate it (or
 * a headless test can fast-forward it). All game rules live in the sim; this only
 * sequences them and gates player actions to the build phase.
 */
import { fxToFloat, type Fx } from './fx.ts';
import { Element } from './element.ts';
import { Tier, NodeKind, type Cell, type PlayerVerb } from './types.ts';
import type { Metrics } from './types.ts';
import { DEFAULT_CONFIG, VERB_CHARGES, type Config } from './config.ts';
import { Sim } from './sim.ts';
import { SearchAttacker, type SearchOptions } from './search.ts';
import { ModelAttacker, type Weights } from './model.ts';
import weightsJson from './weights.json';
import type { Attacker, Opener, Commit } from './wave.ts';

const DISTILLED_WEIGHTS = weightsJson as unknown as Weights;

export type Opponent = 'search' | 'model';

/** Post-wave recap that makes the feint legible (§4.6). */
export interface Recap {
  wave: number;
  telegraph: Opener;
  committed: Commit[][];
  metrics: Metrics;
}

export type GameState = 'build' | 'wave' | 'gameover';

export interface GameOptions {
  starting?: Element;
  difficulty?: number; // 1 (gentle) … 5 (brutal) — maps to the search's top-K
  seed?: bigint; // makes a whole run reproducible
  config?: Config;
  opponent?: Opponent; // 'search' (live L2) or 'model' (distilled net) — same interface
}

/** Map difficulty to the search's beatability knob: lower diff picks a weaker top-K. */
function searchOptsForDiff(diff: number, seed: bigint): SearchOptions {
  const topK = diff >= 5 ? 1 : diff >= 4 ? 2 : diff >= 3 ? 3 : diff >= 2 ? 4 : 6;
  return { seed, topK };
}

export class Game {
  readonly sim: Sim;
  readonly attacker: Attacker;
  readonly opponent: Opponent;
  readonly diff: number;
  wave = 1;
  state: GameState = 'build';
  /** The telegraphed opener for the current/last wave (composition the player can plan against). */
  telegraph: Opener = [];
  lastMetrics: Metrics | null = null;
  highestWave = 1;
  /** Post-wave recap that makes the feint legible (§4.6): what was telegraphed vs. committed. */
  lastRecap: Recap | null = null;
  /** In-wave tactical taps remaining this wave (§2). */
  verbsLeft = VERB_CHARGES;
  /** Committed opener + reserve pool, set by planWave() and consumed by startWave(). */
  private committed: { opener: Opener; pool: number } | null = null;

  constructor(opts: GameOptions = {}) {
    const cfg = opts.config ?? DEFAULT_CONFIG;
    const starting = opts.starting ?? Element.Fire;
    this.diff = opts.difficulty ?? 3;
    this.opponent = opts.opponent ?? 'search';
    this.sim = Sim.create(cfg, starting);
    this.attacker = this.opponent === 'model'
      ? new ModelAttacker(this.sim, DISTILLED_WEIGHTS)
      : new SearchAttacker(this.sim, searchOptsForDiff(this.diff, opts.seed ?? 0xd15ea5en));
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

  /** True once the attacker has committed (and telegraphed) its opener for this wave. */
  get planned(): boolean {
    return this.committed !== null;
  }

  /** Have the attacker read the current board and commit its telegraphed opener, WITHOUT
   *  starting the wave — so the player can counter-build against the telegraph (§2, §4.6).
   *  Re-callable: re-plans against the latest board. */
  planWave(): void {
    if (this.state !== 'build') return;
    this.sim.syncFields();
    this.sim.prepareWave(this.wave, this.diff);
    this.committed = this.attacker.open(this.sim.observe());
    this.telegraph = this.committed.opener;
  }

  /** Leave the build phase and run the committed opener (auto-plans if not yet planned). */
  startWave(): void {
    if (this.state !== 'build') return;
    if (!this.committed) this.planWave();
    const { opener, pool } = this.committed!;
    this.sim.beginWave(opener, pool, this.wave, this.diff);
    this.verbsLeft = VERB_CHARGES;
    this.state = 'wave';
  }

  /** Spend one tactical tap on an in-wave verb (§2). Only during a wave, while charges remain. */
  verb(v: PlayerVerb): boolean {
    if (this.state !== 'wave' || this.verbsLeft <= 0) return false;
    if (!this.sim.playerVerb(v)) return false;
    this.verbsLeft -= 1;
    return true;
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
    if (this.lastMetrics) {
      this.lastRecap = {
        wave: this.wave,
        telegraph: this.telegraph,
        committed: this.attacker.committed ?? [],
        metrics: this.lastMetrics,
      };
    }
    this.sim.player.currency += this.sim.cfg.waveStipend;
    this.wave += 1;
    this.highestWave = Math.max(this.highestWave, this.wave);
    this.committed = null;
    this.telegraph = [];
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
