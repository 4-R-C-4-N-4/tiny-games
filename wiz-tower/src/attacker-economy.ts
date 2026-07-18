/**
 * AttackerEconomy — Phase 6 Slice 2: the attacker's cross-wave build order.
 *
 * Instead of spending exactly `budgetFor()` every wave, the attacker can BANK part of its
 * income for a lighter wave now and RELEASE the hoard for a heavier SPIKE later — the
 * rush-vs-greed tempo decision. This is the first genuinely strategic lever (a learned policy
 * will optimize *when* to save and *when* to spike), and it reads as tempo: breather waves
 * punctuated by massed assaults.
 *
 * It only REDISTRIBUTES the per-wave budget, plus a small compounding "tech" bonus for having
 * invested (each spike permanently lifts income a little) — so it adds timing depth without
 * inflating raw difficulty. Fully deterministic: no rng, decisions come from the caller's hint
 * and the bank level.
 */
export type EconHint = 'spike' | 'save' | undefined;

/** Waves before the economy engages — the opening waves are left at their base budget. */
const WARMUP = 3;
const SAVE_FRAC = 0.28; //        default slice of income banked on a non-spike wave
const SAVE_FRAC_HARD = 0.4; //    a 'save' hint banks more aggressively (deliberate teching)
const TECH_GROWTH = 0.04; //      permanent income lift per spike released (compounding)

export class AttackerEconomy {
  private bank = 0;
  private spikes = 0;
  lastWasSpike = false;

  get banked(): number { return this.bank; }
  /** How many spikes released so far — the attacker's "tech level". */
  get techLevel(): number { return this.spikes; }

  /**
   * The assault budget to field this wave. `income` is the wave's base budget (`budgetFor`).
   * `hint` steers the build order: 'save' banks harder, 'spike' releases the hoard now, and
   * undefined auto-releases once the bank has grown past a wave's income.
   */
  nextAssault(wave: number, income: number, hint: EconHint): number {
    if (wave < WARMUP) { this.lastWasSpike = false; return income; }
    const base = income * (1 + TECH_GROWTH * this.spikes); // a little permanent growth for having teched
    const spike = hint === 'spike' || (hint !== 'save' && this.bank >= income);
    if (spike && this.bank > 0) {
      // Release at most one wave's worth at a time — a spike is a heavy wave (≤ ~2× income),
      // not an unbounded dump, so it stays dramatic without a perf/​difficulty cliff.
      const released = Math.min(this.bank, income);
      this.bank -= released;
      this.spikes += 1;
      this.lastWasSpike = true;
      return Math.round(base + released);
    }
    const save = (hint === 'save' ? SAVE_FRAC_HARD : SAVE_FRAC) * income;
    this.bank += save;
    this.lastWasSpike = false;
    return Math.round(base - save);
  }
}
