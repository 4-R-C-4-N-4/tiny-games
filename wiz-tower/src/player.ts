/**
 * Player economy + skill-tree state (§3.4), mirrored from `lib.rs`. Owned by the Sim;
 * summarized into a `BuildProfile` for the attacker's observation.
 *
 * `depth[e]` is the highest Tier ordinal unlocked for element e (0 = nothing). Attuning
 * unlocks T1; higher tiers are paid tier-gates. `can_build` checks an already-unlocked
 * tier; {@link PlayerState.buildTower} pays the next gate on demand when you build into it.
 */
import { Element, N_ELEMENTS } from './element.ts';
import { Tier } from './types.ts';
import { attuneCost, tierGateCost } from './config.ts';

export class PlayerState {
  currency: number;
  readonly starting: Element;
  readonly attuned: boolean[];
  readonly depth: number[]; // highest Tier ordinal unlocked per element (0 = none)
  attuneCount: number; // number of EXTRA elements attuned (drives escalation)

  constructor(starting: Element, startCurrency: number) {
    this.starting = starting;
    this.currency = startCurrency;
    this.attuned = new Array(N_ELEMENTS).fill(false);
    this.depth = new Array(N_ELEMENTS).fill(0);
    this.attuneCount = 0;
    // Starting element is pre-attuned with T1 unlocked (expedited path to T2 handled by
    // its waived tier-gate in config.tierGateCost).
    this.attuned[starting] = true;
    this.depth[starting] = Tier.T1;
  }

  attuneCost(_e: Element): number {
    // Escalation depends only on how many elements are already attuned, not which.
    return attuneCost(this.attuneCount);
  }

  tierCost(e: Element, tier: Tier): number {
    return tierGateCost(e, tier, this.starting);
  }

  /** Pay the one-time attunement to unlock a non-starting element's tree at T1. */
  attune(e: Element): boolean {
    if (this.attuned[e]) return false;
    const cost = this.attuneCost(e);
    if (this.currency < cost) return false;
    this.currency -= cost;
    this.attuned[e] = true;
    this.depth[e] = Tier.T1;
    this.attuneCount += 1;
    return true;
  }

  /** True if a tower at this already-unlocked tier could be placed and afforded. */
  canBuild(e: Element, tier: Tier, towerCost: number): boolean {
    return this.attuned[e] && this.depth[e] >= tier && this.currency >= towerCost;
  }

  /**
   * Charge for a tower build, paying the next tier-gate on demand if this build unlocks
   * a new tier (tier must be exactly depth+1 to advance — no skipping). Returns false and
   * charges nothing if unaffordable or illegal. Placement itself is done by the caller.
   */
  chargeBuild(e: Element, tier: Tier, towerCost: number): boolean {
    if (!this.attuned[e]) return false;
    const cur = this.depth[e];
    if (tier > cur + 1) return false; // can't skip a tier
    const gate = tier > cur ? this.tierCost(e, tier) : 0;
    const total = towerCost + gate;
    if (this.currency < total) return false;
    this.currency -= total;
    if (tier > cur) this.depth[e] = tier;
    return true;
  }
}
