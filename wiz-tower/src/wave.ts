/**
 * Wave DSL — the serialized attacker plan (§4.3). This AST is BOTH the
 * grammar-constrained model output (parsed from text) AND the telegraph/replay
 * representation. It maps 1:1 to `wave.ebnf`. The parser + PlanAttacker land in step 7.
 */
import type { Fx } from './fx.ts';
import type { Element } from './element.ts';
import type { Cell, Trait, Observation, DecisionContext } from './types.ts';

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
}

export type WaveErrorKind = 'syntax' | 'overBudget' | 'badCell' | 'badTiming';
export class WaveError extends Error {
  constructor(public kind: WaveErrorKind, message: string) {
    super(message);
    this.name = 'WaveError';
  }
}
