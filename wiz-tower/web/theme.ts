/** Presentation-only tokens: the luminous 7-element palette (the palette IS the affinity
 *  wheel) plus glyphs and per-trait silhouette hints. Kept out of src/ — the sim is headless
 *  and must not depend on rendering. */
import { Element } from '../src/element.ts';
import { Trait } from '../src/types.ts';

/** Core element hues, tuned for glow on arcane void. Matches web/public/art/affinity-sigil.svg. */
export const ELEMENT_COLOR: Record<Element, string> = {
  [Element.Fire]: '#ff6b4a',
  [Element.Ice]: '#5fd0ff',
  [Element.Earth]: '#8fce77',
  [Element.Sonic]: '#c17bff',
  [Element.Zap]: '#ffe14d',
  [Element.Light]: '#ffe8a3',
  [Element.Dark]: '#6d5cff',
};

/** A darker shade of each hue, for depth/fills. */
export const ELEMENT_DARK: Record<Element, string> = {
  [Element.Fire]: '#5c1e14',
  [Element.Ice]: '#123a52',
  [Element.Earth]: '#1f3f1c',
  [Element.Sonic]: '#33184d',
  [Element.Zap]: '#4d3f0d',
  [Element.Light]: '#4d431f',
  [Element.Dark]: '#1f1a4d',
};

export const ELEMENT_EMOJI: Record<Element, string> = {
  [Element.Fire]: '🔥', [Element.Ice]: '❄️', [Element.Earth]: '🪨', [Element.Sonic]: '🔊',
  [Element.Zap]: '⚡', [Element.Light]: '✨', [Element.Dark]: '🌑',
};

/** Silhouette shape per trait — the renderer draws these; identity is shape + element glow. */
export type MobShape = 'wisp' | 'swarm' | 'golem' | 'dart' | 'wing' | 'shade' | 'ward' | 'rune' | 'maul';

export const TRAIT_SHAPE: Record<Trait, MobShape> = {
  [Trait.Grunt]: 'wisp',
  [Trait.Swarm]: 'swarm',
  [Trait.Tank]: 'golem',
  [Trait.Runner]: 'dart',
  [Trait.Flier]: 'wing',
  [Trait.Shade]: 'shade',
  [Trait.Shielded]: 'ward',
  [Trait.Mender]: 'rune',
  [Trait.Breaker]: 'maul',
};

/** Body radius as a fraction of a cell. */
export const TRAIT_RADIUS: Record<Trait, number> = {
  [Trait.Grunt]: 0.28, [Trait.Swarm]: 0.16, [Trait.Tank]: 0.42, [Trait.Runner]: 0.26,
  [Trait.Flier]: 0.3, [Trait.Shade]: 0.28, [Trait.Shielded]: 0.32, [Trait.Mender]: 0.3,
  [Trait.Breaker]: 0.3,
};
