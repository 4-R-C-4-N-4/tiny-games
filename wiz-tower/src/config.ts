/**
 * Central tuning tables. Phase 0 needs concrete, deterministic numbers so the sim
 * runs headlessly; the *values* here are placeholders meant to be tuned in Phase 1/1.5,
 * but their SHAPE (what depends on element/trait/tier/kind) follows design §3.
 *
 * Everything a game rule multiplies is fixed-point (Fx); costs/bounties are integer
 * points (the currency/budget unit, `i64` in lib.rs).
 */
import { fx, fxRatio, fxMul, FX_ONE, type Fx } from './fx.ts';
import { Element } from './element.ts';
import { Trait, Tier, NodeKind, TargetPriority, type TowerFlags, type MobFlags, type Aura } from './types.ts';

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
  waveSeconds: Fx; // nominal wave length; places decision points and caps runaway waves
}

export const DEFAULT_CONFIG: Omit<Config, 'seed'> & { seed: bigint } = {
  dt: fxRatio(1, 30), // 30 Hz
  seed: 0x9e3779b97f4a7c15n,
  decisionPoints: 2,
  reserveFrac: fxRatio(35, 100),
  gridW: 7,
  gridH: 12,
  coreHp: fx(100),
  startCurrency: 140,
  waveStipend: 20, // small passive income; most currency must come from kills (bounties)
  waveSeconds: fx(8),
};

// ---- combat / pathing constants (Fx per second where a rate) ----------------------

export const BREAKER_WALL_DPS: Fx = fx(26); // Breakers demolish a wall in ~1.7s (§3.2)
export const MOB_WALL_DPS: Fx = fxRatio(3, 2); // other blocked mobs only CHIP at 1.5/s (>0 so a sealed Core still eventually breaches)
export const BURN_SECS: Fx = fx(2); // Fire's burn DoT lingers this long, refreshed on each hit
export const EARTH_WALL_CAP = 4; //   Geomancy counts at most this many adjacent walls (+30% each)
export const DARK_RAMP_CAP = 20; //   Umbra's ramp caps here (+6%/kill → up to +120% damage)
export const MENDER_HEAL_RADIUS: Fx = fx(2); // cell units (euclidean, compared squared)
export const WARD_RADIUS: Fx = fx(2); //   Warden's protective aura reach
export const HASTE_RADIUS: Fx = fx(2); //  Totem's haste aura reach
export const PYLON_RADIUS: Fx = fx(2); //  Pylon's ally-buff aura reach
export const EMITTER_RADIUS: Fx = fx(2); //Emitter's mob-debuff field reach
export const SPLASH_RADIUS: Fx = fx(1); // splash reaches mobs within 1 cell of the target
/** Core damage per leaked mob = its point cost (tanks hurt more than swarm bodies). */
export function leakDamage(trait: Trait): Fx {
  return fx(mobStats(trait).cost);
}

// ---- economy: walls & towers ------------------------------------------------------

export const WALL_COST = 5;
export const WALL_HP: Fx = fx(45); // basic breakable wall; Earth's tree hardens this later
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

/** Escalating attunement price (§3.4): rises with how many extra elements are attuned.
 *  Kept modest so teching a counter (e.g. anti-air before fliers) doesn't cost a whole wave. */
export function attuneCost(extraCount: number): number {
  return 25 + 15 * extraCount;
}

// ---- tower stats by (element, tier, kind) -----------------------------------------

const DPS_TIER_BASE: Record<Tier, Fx> = { [Tier.T1]: fx(8), [Tier.T2]: fx(16), [Tier.T3]: fx(28) };
const RANGE_TIER: Record<Tier, Fx> = { [Tier.T1]: fxRatio(3, 2), [Tier.T2]: fx(2), [Tier.T3]: fxRatio(5, 2) };
// kind DPS factor as an Fx fraction. Turrets shoot; the support roles deal NO direct damage
// and instead project an aura (Pylon buffs allies, Emitter debuffs mobs).
const KIND_DPS_FRAC: Record<NodeKind, Fx> = {
  [NodeKind.Turret]: fx(1),
  [NodeKind.Structure]: 0, // Pylon
  [NodeKind.Active]: 0, //    Emitter
};

export interface TowerStats {
  dps: Fx;
  range: Fx;
  flags: TowerFlags;
  priority: TargetPriority;
  aura: Aura | null;
}

/** The field a support role projects. Pylon amps allied towers; Emitter debuffs mobs,
 *  flavoured by element (Ice slows, Light reveals, everything else marks vulnerable). */
export function towerAura(element: Element, tier: Tier, kind: NodeKind): Aura | null {
  const t = tier; // 1..3 — auras strengthen with tier
  if (kind === NodeKind.Structure) {
    return { kind: 'buff', radius: PYLON_RADIUS, amount: fxRatio(15 + 10 * t, 100) }; // +25% … +45% ally damage
  }
  if (kind === NodeKind.Active) {
    if (element === Element.Ice) return { kind: 'slow', radius: EMITTER_RADIUS, amount: fxRatio(20 + 10 * t, 100) }; // 30%…50% slow
    if (element === Element.Light) return { kind: 'detect', radius: EMITTER_RADIUS + (FX_ONE >> 1), amount: 0 }; // reveal field
    return { kind: 'vulnerable', radius: EMITTER_RADIUS, amount: fxRatio(10 + 5 * t, 100) }; // +15%…+25% damage taken
  }
  return null;
}

export function towerStats(element: Element, tier: Tier, kind: NodeKind): TowerStats {
  const dps = fxMul(DPS_TIER_BASE[tier], KIND_DPS_FRAC[kind]);
  const range = RANGE_TIER[tier];
  const flags: TowerFlags = {
    // §3.3: Sonic/Zap style nodes hit fliers; Light reveals (detection); Fire/Zap splash; Ice slows.
    antiAir: element === Element.Sonic || element === Element.Zap,
    detection: element === Element.Light || element === Element.Dark, // Radiance reveals; Umbra sees in the dark

    splash: element === Element.Fire ? fxRatio(1, 2) : element === Element.Zap ? fxRatio(1, 3) : 0,
    slow: element === Element.Ice ? fxRatio(1, 2) : 0,
    // Resonance shatters wards & hushes healers; Umbra harvests power from its own kills.
    disrupt: element === Element.Sonic,
    harvest: element === Element.Dark,
    // Pyromancy burns (lingering DoT); Geomancy channels through adjacent walls; Umbra's wards
    // grow in ruin, gaining damage with every kill they land.
    burn: element === Element.Fire ? fxRatio(1, 2) : 0, //     50% of dps as a 2s burn
    wallAmp: element === Element.Earth ? fxRatio(3, 10) : 0, // +30% damage per adjacent wall
    ramp: element === Element.Dark ? fxRatio(6, 100) : 0, //   +6% damage per kill landed
    breakerBane: element === Element.Earth ? fxRatio(3, 5) : 0, // +60% damage vs Breakers (Geomancy's nemesis)
  };
  const priority = flags.antiAir ? TargetPriority.Flying : TargetPriority.First;
  return { dps, range, flags, priority, aura: towerAura(element, tier, kind) };
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
    flags: { flier: false, stealth: false, breaker: false, regen: 0, ward: 0, haste: 0, ...flags },
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
    // Support summons: fragile-ish, slow, valuable to focus — they multiply a whole push.
    case Trait.Warden: return base(28, [7, 10], 8, { ward: fxRatio(35, 100) }); //  -35% dmg to nearby allies
    case Trait.Totem: return base(22, [7, 10], 7, { haste: fxRatio(40, 100) }); //  +40% speed to nearby allies
  }
}

/** Point cost of a mob group = per-mob cost × count (budget accounting, §3.4). */
export function groupCost(trait: Trait, count: number): number {
  return mobStats(trait).cost * count;
}

/**
 * Attacker point budget B(wave, diff) (§3.4). SUPER-LINEAR in the wave and scaled by Rank,
 * so the assault outpaces the player's income: bounties refund only a FRACTION of a mob's
 * cost, and the stipend is small, so a linearly-growing budget would let a clearing player
 * compound past the threat. The quadratic term is the difficulty ramp.
 */
export function budgetFor(wave: number, diff = 3): number {
  const base = 34 + 15 * wave + 4 * wave * wave; // e.g. w1 53, w5 209, w10 584
  const diffMul = 0.62 + 0.13 * diff; //            R1 0.75 · R3 1.01 · R5 1.27
  return Math.round(base * diffMul);
}

// ---- late-wave escalation --------------------------------------------------------------
// The attacker's per-wave point budget grows quadratically, but its spawn THROUGHPUT (group
// sizes, group count) was capped at early-wave values — so past ~w5 the budget was almost
// entirely unspendable and a strong board faced a fixed trickle forever. These scalars let
// the assault's body-count, toughness, and bite grow with the wave so the budget becomes
// real and any fixed board is eventually overwhelmed. Ramp starts after w4: early waves are
// unchanged. Toughness (not sheer count) is the main lever, so a big wave arrives as fewer,
// spongier bodies — bounded for render/perf — rather than an un-renderable swarm.
function waveRamp(wave: number): number { return Math.max(0, wave - 4); }

/** Multiplier on the attacker's group-size caps (more bodies per group, capped for perf). */
export function waveCountScale(wave: number): number {
  return Math.min(3, 1 + Math.floor(waveRamp(wave) / 7)); // w4:1 w11:2 w18+:3
}
/** Extra spawn groups an opener/commit may field at higher waves (a wider assault). */
export function waveGroupBonus(wave: number): number {
  return Math.min(2, Math.floor(waveRamp(wave) / 10)); // w4:0 w14:1 w24+:2
}
/** Toughness multiplier applied to spawned-mob HP — the primary late-wave threat lever. */
export function waveMobScale(wave: number): Fx {
  return Math.round((1 + 0.18 * waveRamp(wave)) * FX_ONE); // w10:2.1× w30:5.7× w70:12.9×
}
/** Gentle growth on the Core damage a leaked mob deals — late leaks bite harder. */
export function waveLeakScale(wave: number): Fx {
  return Math.round((1 + 0.05 * waveRamp(wave)) * FX_ONE); // w30:2.3× w70:4.3×
}

/** Fraction of a slain mob's point cost paid back to the player as bounty. Below 1 so a
 *  full clear does NOT refund the attacker's whole budget — the core lever for the ramp. */
export const BOUNTY_FRAC = 0.6;

/** Kill bounty for a mob (§3.4) — a fraction of its point cost, at least 1. */
export function bounty(trait: Trait): number {
  return Math.max(1, Math.round(mobStats(trait).cost * BOUNTY_FRAC));
}

/** Umbra's harvest: when a Dark ward lands the killing blow it reaps extra power (bounty),
 *  the mechanical form of "turn kills to power" — Dark's build-cost is repaid in economy. */
export const DARK_KILL_BONUS = 0.5;
export function harvestBonus(trait: Trait): number {
  return Math.max(1, Math.round(bounty(trait) * DARK_KILL_BONUS));
}

/** The wave a threat type becomes available to the attacker at Rank 3. Composition escalates
 *  (ground first; air, stealth, breakers, menders later) so the opener isn't an unanswerable
 *  first-wave air-rush — you get time to tech the counters as the roster opens up. */
const TRAIT_UNLOCK: Record<Trait, number> = {
  [Trait.Grunt]: 1, [Trait.Swarm]: 1, [Trait.Tank]: 2, [Trait.Runner]: 2,
  [Trait.Flier]: 4, [Trait.Shielded]: 5, [Trait.Totem]: 5, [Trait.Shade]: 6, [Trait.Breaker]: 6,
  [Trait.Warden]: 7, [Trait.Mender]: 7,
};

/** Is `trait` available to the attacker on `wave` at `diff`? Higher Rank opens it earlier
 *  (a gentle ±1-wave spread across Ranks, not a swing that makes R5 a first-wave everything). */
export function traitUnlocked(trait: Trait, wave: number, diff = 3): boolean {
  return wave >= Math.max(1, TRAIT_UNLOCK[trait] + Math.floor((3 - diff) / 2));
}

// ---- in-wave player verbs (§2) ----------------------------------------------------

export const VERB_RADIUS: Fx = fx(2); // effect radius in cells (euclidean, compared squared)
export const OVERCHARGE_MULT: Fx = fx(3); // towers in range fire ×3 while active
export const OVERCHARGE_SECS: Fx = fx(3);
export const REVEAL_SECS: Fx = fx(4);
export const REINFORCE_HP: Fx = WALL_HP; // restore a wall to full
export const VERB_CHARGES = 2; // taps per wave (design §2: "1–2 cheap tactical taps")
