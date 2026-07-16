/**
 * Element lattice — design §3.1, mirrored from `lib.rs`. ONE symmetric taxonomy for
 * both attack and defense.
 *
 * Wheel (single-step cycle): Sonic → Earth → Zap → Ice → Fire → Sonic (each beats the
 * next). Light ⇄ Dark are a mutual 1.5× pair and neutral vs the wheel.
 *
 * The index order is FIXED and load-bearing: it indexes the 7 per-element observation
 * channels (`CellFeatures.dps`, `BuildProfile`, `Metrics.dpsUtil`). Do not reorder.
 */
import { FX_ONE, type Fx } from './fx.ts';

export enum Element {
  Fire = 0,
  Ice = 1,
  Earth = 2,
  Sonic = 3,
  Zap = 4,
  Light = 5,
  Dark = 6,
}

export const N_ELEMENTS = 7;

export const ELEMENT_NAMES = ['Fire', 'Ice', 'Earth', 'Sonic', 'Zap', 'Light', 'Dark'] as const;

export const STRONG: Fx = (FX_ONE * 3) / 2; // 1.5× — 1536
export const WEAK: Fx = FX_ONE / 2; //         0.5× — 512
export const NEUTRAL: Fx = FX_ONE; //          1.0× — 1024

/**
 * Wheel adjacency: `BEATS[a] === b` means attacker element `a` counters defender `b`.
 * Sonic>Earth>Zap>Ice>Fire>Sonic. Matches `train.py`'s BEATS map and the §3.1 table.
 */
const BEATS: Record<Element, Element> = {
  [Element.Sonic]: Element.Earth,
  [Element.Earth]: Element.Zap,
  [Element.Zap]: Element.Ice,
  [Element.Ice]: Element.Fire,
  [Element.Fire]: Element.Sonic,
  // Light/Dark are not on the wheel; their matchup is handled below.
  [Element.Light]: Element.Light, // sentinel: never used (Light beats nothing on the wheel)
  [Element.Dark]: Element.Dark,
};

/**
 * The single source of truth for §3.1 effectiveness. `atk` deals to a mob of element
 * `def`. Strong = 1.5×, weak = 0.5×, everything else (including same-element mirror)
 * = 1.0×. Light⇄Dark are mutually strong.
 */
export function typeMult(atk: Element, def: Element): Fx {
  if ((atk === Element.Light && def === Element.Dark) || (atk === Element.Dark && def === Element.Light)) {
    return STRONG;
  }
  // Light/Dark are neutral vs everything else on the wheel (and the sentinel above
  // keeps them from spuriously matching a wheel edge).
  if (atk === Element.Light || atk === Element.Dark || def === Element.Light || def === Element.Dark) {
    return NEUTRAL;
  }
  if (BEATS[atk] === def) return STRONG; // atk counters def
  if (BEATS[def] === atk) return WEAK; //  def counters atk
  return NEUTRAL;
}
