/**
 * Central tuning tables. Phase 0 needs concrete, deterministic numbers so the sim
 * runs headlessly; the *values* here are placeholders meant to be tuned in Phase 1/1.5,
 * but their SHAPE (what depends on element/trait/tier/kind) follows design §3.
 *
 * Everything a game rule multiplies is fixed-point (Fx); costs/bounties are integer
 * points (the currency/budget unit, `i64` in lib.rs).
 */
import { fx, fxRatio, fxMul, type Fx } from './fx.ts';
import { Element } from './element.ts';
import { Trait, Tier, NodeKind, TargetPriority, type TowerFlags, type MobFlags } from './types.ts';

// ---- global sim config ------------------------------------------------------------

export interface Config {
  dt: Fx; // fixed timestep, seconds (Fx)
  seed: bigint;
  decisionPoints: number; // §9.1 — start at 2
  reserveFrac: Fx; // §9.1 — start ~0.35
  gridW: number;
  gridH: number;
  coreHp: Fx;
  startCurrency: number;
  waveStipend: number; // per-wave income
}

export const DEFAULT_CONFIG: Omit<Config, 'seed'> & { seed: bigint } = {
  dt: fxRatio(1, 30), // 30 Hz
  seed: 0x9e3779b97f4a7c15n,
  decisionPoints: 2,
  reserveFrac: fxRatio(35, 100),
  gridW: 7,
  gridH: 12,
  coreHp: fx(100),
  startCurrency: 120,
  waveStipend: 25,
};

// ---- economy: walls & towers ------------------------------------------------------

export const WALL_COST = 5;
export const WALL_HP: Fx = fx(30); // basic breakable wall; Earth's tree hardens this later
export const REFUND_NUM = 3; // sell refunds 3/5 of build cost, floored
export const REFUND_DEN = 5;

export function refund(cost: number): number {
  return Math.floor((cost * REFUND_NUM) / REFUND_DEN);
}

const TOWER_TIER_BASE: Record<Tier, number> = { [Tier.T1]: 20, [Tier.T2]: 45, [Tier.T3]: 90 };
const TOWER_KIND_MUL: Record<NodeKind, number> = {
  [NodeKind.Turret]: 100, // ×1.00 (percent, to stay integer)
  [NodeKind.Structure]: 50,
  [NodeKind.Active]: 80,
};

export function towerCost(kind: NodeKind, tier: Tier): number {
  return Math.round((TOWER_TIER_BASE[tier] * TOWER_KIND_MUL[kind]) / 100);
}

/** Tier-gate cost (§3.4). Starting element's T2 is waived (the expedited path). */
export function tierGateCost(e: Element, tier: Tier, starting: Element): number {
  if (tier === Tier.T1) return 0; // T1 unlocks with attunement
  if (tier === Tier.T2) return e === starting ? 0 : 35;
  return 80; // T3
}

/** Escalating attunement price (§3.4): rises with how many extra elements are attuned. */
export function attuneCost(extraCount: number): number {
  return 40 + 25 * extraCount;
}

// ---- tower stats by (element, tier, kind) -----------------------------------------

const DPS_TIER_BASE: Record<Tier, Fx> = { [Tier.T1]: fx(8), [Tier.T2]: fx(16), [Tier.T3]: fx(28) };
const RANGE_TIER: Record<Tier, Fx> = { [Tier.T1]: fxRatio(3, 2), [Tier.T2]: fx(2), [Tier.T3]: fxRatio(5, 2) };
// kind DPS factor as an Fx fraction: turrets shoot, structures chip, actives passive-idle.
const KIND_DPS_FRAC: Record<NodeKind, Fx> = {
  [NodeKind.Turret]: fx(1),
  [NodeKind.Structure]: fxRatio(2, 5),
  [NodeKind.Active]: 0,
};

export interface TowerStats {
  dps: Fx;
  range: Fx;
  flags: TowerFlags;
  priority: TargetPriority;
}

export function towerStats(element: Element, tier: Tier, kind: NodeKind): TowerStats {
  const dps = fxMul(DPS_TIER_BASE[tier], KIND_DPS_FRAC[kind]);
  const range = RANGE_TIER[tier];
  const flags: TowerFlags = {
    // §3.3: Sonic/Zap style nodes hit fliers; Light reveals (detection); Fire/Zap splash; Ice slows.
    antiAir: element === Element.Sonic || element === Element.Zap,
    detection: element === Element.Light,
    splash: element === Element.Fire ? fxRatio(1, 2) : element === Element.Zap ? fxRatio(1, 3) : 0,
    slow: element === Element.Ice ? fxRatio(1, 2) : 0,
  };
  const priority = flags.antiAir ? TargetPriority.Flying : TargetPriority.First;
  return { dps, range, flags, priority };
}

// ---- mob stats by trait (element only decides matchup, not base stats) -------------

export interface MobStats {
  hp: Fx;
  speed: Fx; // cells/sec
  flags: MobFlags;
  shieldHits: number;
  cost: number; // budget points (also the death bounty)
}

export function mobStats(trait: Trait): MobStats {
  const base = (
    hp: number, speed: [number, number], cost: number,
    flags: Partial<MobFlags> = {}, shieldHits = 0,
  ): MobStats => ({
    hp: fx(hp),
    speed: fxRatio(speed[0], speed[1]),
    cost,
    shieldHits,
    flags: { flier: false, stealth: false, breaker: false, regen: 0, ...flags },
  });
  switch (trait) {
    case Trait.Grunt: return base(20, [1, 1], 4);
    case Trait.Swarm: return base(6, [6, 5], 2); // 1.2 c/s, cheap bodies
    case Trait.Tank: return base(80, [1, 2], 10); // 0.5 c/s
    case Trait.Runner: return base(10, [2, 1], 5); // 2.0 c/s
    case Trait.Flier: return base(18, [11, 10], 6, { flier: true });
    case Trait.Shade: return base(16, [1, 1], 6, { stealth: true });
    case Trait.Shielded: return base(20, [9, 10], 7, {}, 3);
    case Trait.Mender: return base(24, [4, 5], 8, { regen: fxRatio(2, 1) });
    case Trait.Breaker: return base(14, [7, 10], 5, { breaker: true });
  }
}

/** Point cost of a mob group = per-mob cost × count (budget accounting, §3.4). */
export function groupCost(trait: Trait, count: number): number {
  return mobStats(trait).cost * count;
}
