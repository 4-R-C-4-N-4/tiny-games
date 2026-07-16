/**
 * Shared value types for the sim — mirrored from `lib.rs`. Enums keep the exact index
 * order of the Rust originals where that order is observable (Element channels, Tier
 * ordering); the rest are plain discriminated data.
 */
import type { Fx } from './fx.ts';
import type { Element } from './element.ts';

// ---- coordinates & ids ------------------------------------------------------------

/** Integer grid cell. `x` in [0,w), `y` in [0,h). y grows downward (top = spawn band). */
export interface Cell {
  x: number;
  y: number;
}

/** Continuous position in fixed-point cell units. */
export interface Pos {
  x: Fx;
  y: Fx;
}

/** Entities live in arrays indexed by id; iteration is therefore stable (determinism). */
export type MobId = number;
export type TowerId = number;

// ---- taxonomy ---------------------------------------------------------------------

/** Mechanical threat, orthogonal to Element (§3.2). Resistance is the mob's Element. */
export enum Trait {
  Grunt = 0,
  Swarm = 1,
  Tank = 2,
  Runner = 3,
  Flier = 4,
  Shade = 5,
  Shielded = 6,
  Mender = 7,
  Breaker = 8,
}

export const TRAIT_NAMES = [
  'Grunt', 'Swarm', 'Tank', 'Runner', 'Flier', 'Shade', 'Shielded', 'Mender', 'Breaker',
] as const;

/**
 * Skill-tree tier. Numeric values are the ordinal (T1<T2<T3) AND the "depth reached"
 * scale used by {@link PlayerState}: depth 0 = nothing unlocked, 1 = T1, etc.
 */
export enum Tier {
  T1 = 1,
  T2 = 2,
  T3 = 3,
}

/** The three node kinds a tree slot can be (§3.3). Actives double as in-wave verbs. */
export enum NodeKind {
  Turret = 0,
  Structure = 1,
  Active = 2,
}

/** Tower target selection order; ties broken by stable id order (§2 step 7). */
export enum TargetPriority {
  First = 0, // furthest along toward Core (smallest distCore)
  Strongest = 1, // highest current HP
  Fastest = 2, // highest speed
  Flying = 3, // prefer fliers, else First
}

// ---- occupancy --------------------------------------------------------------------

export const enum OccKind {
  Empty = 0,
  Wall = 1,
  Tower = 2,
  Core = 3,
  Spawn = 4,
}

/** Tagged union for what sits on a cell. Only `Wall` blocks movement (§9.4). */
export type Occupant =
  | { kind: OccKind.Empty }
  | { kind: OccKind.Wall; hp: Fx }
  | { kind: OccKind.Tower; tower: TowerId }
  | { kind: OccKind.Core }
  | { kind: OccKind.Spawn };

export interface CellInfo {
  buildable: boolean;
  occ: Occupant;
}

// ---- entities ---------------------------------------------------------------------

export interface TowerFlags {
  antiAir: boolean;
  detection: boolean;
  splash: Fx; // fraction of hit damage dealt to other mobs in-cell/adjacent (0 = none)
  slow: Fx; // movement multiplier applied on hit (0 = none)
}

export interface Tower {
  id: TowerId;
  cell: Cell;
  element: Element;
  tier: Tier;
  kind: NodeKind;
  dps: Fx; // damage per second (scaled by dt at fire time)
  range: Fx; // in cell units
  priority: TargetPriority;
  flags: TowerFlags;
}

export interface MobFlags {
  flier: boolean; // ignores walls, straight line to Core; needs antiAir to be hit
  stealth: boolean; // untargetable unless detection covers it (Shade)
  breaker: boolean; // damages walls to breach
  regen: Fx; // Mender: HP/sec healed to nearby mobs (0 = none)
}

export interface Mob {
  id: MobId;
  element: Element;
  trait: Trait;
  pos: Pos;
  hp: Fx;
  maxHp: Fx;
  speed: Fx; // cells per second
  flags: MobFlags;
  shieldHits: number; // Shielded: absorbs first N damage applications
  entryX: number; // spawn column, for telemetry/telegraph
  alive: boolean; // freelist tombstone; iteration stays in id order
}
