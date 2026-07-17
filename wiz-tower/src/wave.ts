/**
 * Wave DSL — the serialized attacker plan (§4.3). This AST is BOTH the
 * grammar-constrained model output (parsed from text) AND the telegraph/replay
 * representation. It maps 1:1 to `wave.ebnf`. The parser + PlanAttacker land in step 7.
 */
import { FX_ONE, type Fx } from './fx.ts';
import { Element, ELEMENT_NAMES, N_ELEMENTS } from './element.ts';
import { Trait, TRAIT_NAMES, type Cell, type Observation, type DecisionContext } from './types.ts';
import { groupCost } from './config.ts';

export interface MobGroup {
  element: Element;
  trait: Trait;
  count: number;
}

/** A telegraphed opener spawn: `SPAWN t=.. x=.. ELEMENT TRAIT xN`. */
export interface Spawn {
  t: Fx; // seconds
  x: number; // entry column
  group: MobGroup;
}

/** A reserve commit fired at a decision point. `Breach` aims a group at a gate wall. */
export type Commit =
  | { kind: 'spawn'; x: number; group: MobGroup }
  | { kind: 'breach'; x: number; group: MobGroup; gate: Cell };

/** Small CLOSED predicate set so grammar-constrained decoding has a finite space. */
export type Cond =
  | { kind: 'dpsNearLt'; x: number; element: Element; thresh: Fx }
  | { kind: 'wallHpLt'; gate: Cell; thresh: Fx }
  | { kind: 'coreHpLt'; thresh: Fx }
  | { kind: 'and'; a: Cond; b: Cond };

/** Guards evaluated in order at a decision point; first satisfied one fires.
 *  A trailing guard with `cond: null` is the ELSE. */
export interface GuardedCommit {
  cond: Cond | null;
  commit: Commit[];
}

export interface DecisionPointPlan {
  t: Fx;
  guards: GuardedCommit[];
}

export interface Reserve {
  pool: number;
  points: DecisionPointPlan[];
}

export interface Wave {
  budget: number;
  diff: number;
  opener: Spawn[];
  reserve: Reserve;
}

export type Opener = Spawn[];

/**
 * The runtime interface both consumers implement (§7). The Sim never knows whether a
 * model (PlanAttacker) or a live search (SearchAttacker, Phase 1.5) is behind it.
 */
export interface Attacker {
  /** Plan the telegraphed opener + declare the hidden reserve pool for this wave. */
  open(obs: Observation): { opener: Opener; pool: number };
  /** React at a decision point: choose commits from the remaining reserve. */
  commit(ctx: DecisionContext): Commit[];
  /** The reserve commits fired at each decision point this wave — for the post-wave recap
   *  that makes the feint legible (§4.6). Reset at open(). */
  readonly committed?: Commit[][];
}

export type WaveErrorKind = 'syntax' | 'overBudget' | 'badCell' | 'badTiming';
export class WaveError extends Error {
  constructor(public kind: WaveErrorKind, message: string) {
    super(message);
    this.name = 'WaveError';
  }
}

// ==================================================================================
// Parser — grammar-constrained text (model output / replay) → validated Wave.
// The grammar (wave.ebnf) guarantees SHAPE; parse_wave enforces the semantics it can't
// (cost ≤ budget, x in range, gate is a real wall, t in window).
// ==================================================================================

/** Validation environment: what the parser needs to check semantics against the board. */
export interface WaveEnv {
  gridW?: number;
  gridH?: number;
  isWall?: (c: Cell) => boolean;
  waveSeconds?: Fx; // timing window; spawns/decision points must fall within [0, this]
}

const ELEMENT_BY_NAME = new Map<string, Element>(
  ELEMENT_NAMES.map((n, i) => [n.toUpperCase(), i as Element]),
);
const TRAIT_BY_NAME = new Map<string, Trait>(
  TRAIT_NAMES.map((n, i) => [n.toUpperCase(), i as Trait]),
);

function syntax(msg: string): never {
  throw new WaveError('syntax', msg);
}

function decToFx(s: string): Fx {
  if (!/^\d+(\.\d+)?$/.test(s)) syntax(`bad decimal "${s}"`);
  return Math.round(parseFloat(s) * FX_ONE);
}
function uint(s: string): number {
  if (!/^\d+$/.test(s)) syntax(`bad uint "${s}"`);
  return parseInt(s, 10);
}
function kv(tok: string, key: string): string {
  const p = `${key}=`;
  if (!tok.startsWith(p)) syntax(`expected ${key}= but got "${tok}"`);
  return tok.slice(p.length);
}
function elementTok(s: string): Element {
  const e = ELEMENT_BY_NAME.get(s);
  if (e === undefined) syntax(`unknown element "${s}"`);
  return e;
}
function traitTok(s: string): Trait {
  const t = TRAIT_BY_NAME.get(s);
  if (t === undefined) syntax(`unknown trait "${s}"`);
  return t;
}
function cellTok(s: string): Cell {
  const m = /^\((\d+),(\d+)\)$/.exec(s);
  if (!m) syntax(`bad cell "${s}"`);
  return { x: parseInt(m[1], 10), y: parseInt(m[2], 10) };
}

/** Parse `ELEMENT TRAIT xN` starting at tokens[i]; returns the group and the next index. */
function parseGroup(tokens: string[], i: number): { group: MobGroup; next: number } {
  const element = elementTok(tokens[i] ?? syntax('missing element'));
  const trait = traitTok(tokens[i + 1] ?? syntax('missing trait'));
  const cnt = tokens[i + 2] ?? syntax('missing count');
  if (cnt[0] !== 'x') syntax(`expected xN count but got "${cnt}"`);
  const count = uint(cnt.slice(1));
  if (count <= 0) syntax('group count must be positive');
  return { group: { element, trait, count }, next: i + 3 };
}

function parseCondExpr(expr: string): Cond {
  const parts = expr.split(' AND ').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) syntax('empty condition');
  const atoms = parts.map(parseAtomicCond);
  return atoms.reduce((a, b) => ({ kind: 'and', a, b }));
}

function parseAtomicCond(s: string): Cond {
  let m = /^dps_near\(x=(\d+),([A-Z]+)\)<(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return { kind: 'dpsNearLt', x: uint(m[1]), element: elementTok(m[2]), thresh: decToFx(m[3]) };
  m = /^wall_hp\(\((\d+),(\d+)\)\)<(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return { kind: 'wallHpLt', gate: { x: uint(m[1]), y: uint(m[2]) }, thresh: decToFx(m[3]) };
  m = /^core_hp<(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return { kind: 'coreHpLt', thresh: decToFx(m[1]) };
  syntax(`bad condition "${s}"`);
}

function parseCommit(tokens: string[]): Commit {
  if (tokens[0] !== 'COMMIT') syntax(`expected COMMIT, got "${tokens[0]}"`);
  const x = uint(kv(tokens[1] ?? syntax('commit missing x'), 'x'));
  const { group, next } = parseGroup(tokens, 2);
  if (tokens[next] === 'BREACH') {
    const gate = cellTok(tokens[next + 1] ?? syntax('BREACH missing cell'));
    return { kind: 'breach', x, group, gate };
  }
  return { kind: 'spawn', x, group };
}

/** Strip a trailing `# comment` and surrounding whitespace; returns '' for blank/comment lines. */
function clean(line: string): string {
  const hash = line.indexOf('#');
  return (hash >= 0 ? line.slice(0, hash) : line).trim();
}

export function parseWave(src: string, env: WaveEnv = {}): Wave {
  const lines = src.split('\n').map(clean).filter((l) => l.length > 0);
  let i = 0;
  const next = () => lines[i++] ?? syntax('unexpected end of wave');
  let budget = 0, diff = 0, pool = 0;

  // WAVE budget=.. diff=..
  {
    const t = next().split(/\s+/);
    if (t[0] !== 'WAVE') syntax('wave must start with WAVE');
    budget = uint(kv(t[1] ?? '', 'budget'));
    diff = uint(kv(t[2] ?? '', 'diff'));
  }

  // OPEN block
  if (next() !== 'OPEN') syntax('expected OPEN');
  const opener: Spawn[] = [];
  while (i < lines.length && !lines[i].startsWith('RESERVE')) {
    const t = lines[i].split(/\s+/);
    if (t[0] !== 'SPAWN') syntax(`expected SPAWN in OPEN, got "${t[0]}"`);
    const tt = decToFx(kv(t[1] ?? '', 't'));
    const x = uint(kv(t[2] ?? '', 'x'));
    const { group } = parseGroup(t, 3);
    opener.push({ t: tt, x, group });
    i++;
  }

  // RESERVE pool=..
  {
    const t = next().split(/\s+/);
    if (t[0] !== 'RESERVE') syntax('expected RESERVE');
    pool = uint(kv(t[1] ?? '', 'pool'));
  }

  // decision points
  const points: DecisionPointPlan[] = [];
  let cur: DecisionPointPlan | null = null;
  let guard: GuardedCommit | null = null;
  while (i < lines.length) {
    const line = lines[i++];
    const t = line.split(/\s+/);
    if (t[0] === 'AT') {
      cur = { t: decToFx(kv(t[1] ?? '', 't')), guards: [] };
      points.push(cur);
      guard = null;
    } else if (line === 'ELSE' || (t[0] === 'ELSE' && t[1] === undefined)) {
      if (!cur) syntax('ELSE outside a decision point');
      guard = { cond: null, commit: [] };
      cur.guards.push(guard);
    } else if (t[0] === 'ELSE' && t[1] === 'IF') {
      if (!cur) syntax('ELSE IF outside a decision point');
      guard = { cond: parseCondExpr(t.slice(2).join(' ')), commit: [] };
      cur.guards.push(guard);
    } else if (t[0] === 'IF') {
      if (!cur) syntax('IF outside a decision point');
      guard = { cond: parseCondExpr(t.slice(1).join(' ')), commit: [] };
      cur.guards.push(guard);
    } else if (t[0] === 'COMMIT') {
      if (!guard) syntax('COMMIT outside a guard');
      guard.commit.push(parseCommit(t));
    } else {
      syntax(`unexpected line "${line}"`);
    }
  }

  const wave: Wave = { budget, diff, opener, reserve: { pool, points } };
  validate(wave, env);
  return wave;
}

function validate(wave: Wave, env: WaveEnv): void {
  const inCol = (x: number): boolean => env.gridW === undefined || (x >= 0 && x < env.gridW);
  const inBounds = (c: Cell): boolean =>
    env.gridW === undefined || env.gridH === undefined ||
    (c.x >= 0 && c.y >= 0 && c.x < env.gridW && c.y < env.gridH);
  const inWindow = (t: Fx): boolean => env.waveSeconds === undefined || (t >= 0 && t <= env.waveSeconds);

  let openerCost = 0;
  for (const s of wave.opener) {
    if (!inCol(s.x)) throw new WaveError('badCell', `opener x=${s.x} out of range`);
    if (!inWindow(s.t)) throw new WaveError('badTiming', `opener t out of window`);
    openerCost += groupCost(s.group.trait, s.group.count);
  }
  for (const p of wave.reserve.points) {
    if (!inWindow(p.t)) throw new WaveError('badTiming', `decision point t out of window`);
    for (const g of p.guards) {
      for (const c of g.commit) {
        if (!inCol(c.x)) throw new WaveError('badCell', `commit x=${c.x} out of range`);
        if (c.kind === 'breach') {
          if (!inBounds(c.gate)) throw new WaveError('badCell', `breach gate out of bounds`);
          if (env.isWall && !env.isWall(c.gate)) {
            throw new WaveError('badCell', `breach gate (${c.gate.x},${c.gate.y}) is not a wall`);
          }
        }
      }
    }
  }
  // The reserve pool is the max additional spend; opener + pool must fit the budget.
  if (openerCost + wave.reserve.pool > wave.budget) {
    throw new WaveError('overBudget', `opener ${openerCost} + pool ${wave.reserve.pool} > budget ${wave.budget}`);
  }
}

// ==================================================================================
// PlanAttacker — executes a compiled Wave (the model's parsed DSL, or a replay).
// ==================================================================================

export class PlanAttacker implements Attacker {
  private cursor = 0;
  constructor(public readonly wave: Wave) {}

  open(_obs: Observation): { opener: Opener; pool: number } {
    this.cursor = 0;
    return { opener: this.wave.opener, pool: this.wave.reserve.pool };
  }

  commit(ctx: DecisionContext): Commit[] {
    // The sim owns decision-point ticks; the plan's points align by index. Prefer the
    // point matching ctx.pointIndex, else advance a cursor (robust to count mismatch).
    const idx = ctx.pointIndex >= 0 && ctx.pointIndex < this.wave.reserve.points.length
      ? ctx.pointIndex
      : this.cursor;
    this.cursor = idx + 1;
    const point = this.wave.reserve.points[idx];
    if (!point) return [];
    for (const g of point.guards) {
      if (g.cond === null || evalCond(g.cond, ctx)) return g.commit;
    }
    return []; // no guard matched and no ELSE
  }
}

function evalCond(cond: Cond, ctx: DecisionContext): boolean {
  switch (cond.kind) {
    case 'and':
      return evalCond(cond.a, ctx) && evalCond(cond.b, ctx);
    case 'coreHpLt':
      return ctx.coreHp < cond.thresh;
    case 'wallHpLt': {
      const { obs } = ctx;
      if (cond.gate.x < 0 || cond.gate.y < 0 || cond.gate.x >= obs.w || cond.gate.y >= obs.h) return false;
      return obs.cells[cond.gate.y * obs.w + cond.gate.x].wallHp < cond.thresh;
    }
    case 'dpsNearLt': {
      // "dps_near(x, element)" = peak coverage of that element anywhere in column x.
      const { obs } = ctx;
      if (cond.x < 0 || cond.x >= obs.w || cond.element >= N_ELEMENTS) return false;
      let peak = 0;
      for (let y = 0; y < obs.h; y++) {
        const d = obs.cells[y * obs.w + cond.x].dps[cond.element];
        if (d > peak) peak = d;
      }
      return peak < cond.thresh;
    }
  }
}
