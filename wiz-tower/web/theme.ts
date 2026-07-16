/** Presentation-only: element colors, and glyphs for elements/traits. Kept out of src/
 *  (the sim is headless and must not depend on rendering). */
import { Element } from '../src/element.ts';
import { Trait } from '../src/types.ts';

export const ELEMENT_COLOR: Record<Element, string> = {
  [Element.Fire]: '#ff5a4d',
  [Element.Ice]: '#4fc3ff',
  [Element.Earth]: '#c39a5a',
  [Element.Sonic]: '#c86bff',
  [Element.Zap]: '#ffd23f',
  [Element.Light]: '#f2f0d8',
  [Element.Dark]: '#8b6cff',
};

export const ELEMENT_EMOJI: Record<Element, string> = {
  [Element.Fire]: '🔥', [Element.Ice]: '❄️', [Element.Earth]: '🪨', [Element.Sonic]: '🔊',
  [Element.Zap]: '⚡', [Element.Light]: '✨', [Element.Dark]: '🌑',
};

/** Single-letter trait tag drawn on mobs, plus a relative body radius (cell fraction). */
export const TRAIT_TAG: Record<Trait, string> = {
  [Trait.Grunt]: 'G', [Trait.Swarm]: 's', [Trait.Tank]: 'T', [Trait.Runner]: 'R',
  [Trait.Flier]: 'F', [Trait.Shade]: 'H', [Trait.Shielded]: 'D', [Trait.Mender]: 'M',
  [Trait.Breaker]: 'B',
};

export const TRAIT_RADIUS: Record<Trait, number> = {
  [Trait.Grunt]: 0.28, [Trait.Swarm]: 0.18, [Trait.Tank]: 0.4, [Trait.Runner]: 0.24,
  [Trait.Flier]: 0.28, [Trait.Shade]: 0.26, [Trait.Shielded]: 0.3, [Trait.Mender]: 0.28,
  [Trait.Breaker]: 0.26,
};
