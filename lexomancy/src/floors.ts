import { CHANNELS, type Channel, type Scorer } from './types.ts';

// Floors are hand-authored mechanic skeletons (archetypes) filled with
// generated semantic content (theme anchors shipped in lexicon.bin).
// archetype × theme at run start = large variety from small content.

export type Archetype =
  | 'domain'
  | 'taboo'
  | 'drain'
  | 'echo'
  | 'leyline'
  | 'silence'
  | 'bloodprice'
  | 'bulwark'
  | 'fading'
  | 'mirror';

/** Mirrors the themes in train/data/anchor-words.json (shipped as anchors). */
export const THEMES = [
  'bone', 'tide', 'ash', 'clockwork', 'honey', 'frost', 'storm', 'garden',
  'venom', 'choir', 'iron', 'moth', 'blood', 'salt', 'root', 'lantern',
  'silk', 'plague', 'dream', 'hunger', 'glass', 'ruin', 'starlight', 'ember',
  'mirror', 'thunder',
] as const;
export type Theme = (typeof THEMES)[number];

export interface FloorSpec {
  index: number; // 1-based; 8 = the Summit
  archetype: Archetype;
  theme: Theme;
  /** Leyline floors amplify one channel for both sides. */
  channel?: Channel;
  name: string;
  inscription: string;
  ruleText: string;
}

export const SPIRE_HEIGHT = 8; // 7 rolled floors + the Summit

const TABOO_THRESHOLD = 0.42;
const DOMAIN_AMP = 0.5; // amp = 1 + DOMAIN_AMP * affinity
const LEYLINE_AMP = 1.4;
/** Shield both duelists start a Bulwark floor with. */
export const BULWARK_START_WARD = 12;

/** Difficulty-tiered archetype pools. Bulwark/Fading are low-risk flavor
 * (a pacing change, not a punishment) so they can appear from floor 1;
 * Bloodprice punishes an instinct (healing) a first-time player wouldn't
 * expect, so it's held back to floor 4+. */
const TIER_POOLS: Record<number, Archetype[]> = {
  1: ['domain', 'leyline', 'bulwark', 'fading'],
  2: ['domain', 'leyline', 'drain', 'bulwark', 'fading'],
  3: ['domain', 'taboo', 'drain', 'leyline', 'silence', 'bulwark'],
  4: ['domain', 'taboo', 'drain', 'leyline', 'silence', 'bloodprice'],
  5: ['taboo', 'drain', 'echo', 'domain', 'silence', 'bloodprice'],
  6: ['taboo', 'drain', 'echo', 'silence', 'bloodprice'],
  7: ['taboo', 'echo', 'domain', 'silence', 'bloodprice'],
};

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

const NAMES: Record<Archetype, (t: Theme) => string> = {
  domain: (t) => `The ${cap(t)} Court`,
  taboo: (t) => `The ${cap(t)}less Court`,
  drain: (t) => `The ${cap(t)} Mire`,
  echo: (t) => `The ${cap(t)} Gallery`,
  leyline: (t) => `The ${cap(t)} Conduit`,
  silence: (t) => `The Muted ${cap(t)}`,
  bloodprice: (t) => `The ${cap(t)} Altar`,
  bulwark: (t) => `The ${cap(t)} Bastion`,
  fading: (t) => `The Fading ${cap(t)}`,
  mirror: () => 'The Summit of the Mirror',
};

const INSCRIPTIONS: Record<Archetype, (t: Theme) => string> = {
  domain: (t) => `Here the spire dreams of ${t}, and rewards those who dream along.`,
  taboo: (t) => `The court has forbidden ${t}. The walls remember why.`,
  drain: (t) => `The air is thick with spent words. They cling like ${t}.`,
  echo: (t) => `Speak carefully. The ${t} remembers your voice.`,
  leyline: (t) => `A vein of raw power runs through the ${t} here.`,
  silence: (t) => `Here the ${t} swallows a color of magic whole.`,
  bloodprice: (t) => `The altar demands payment for mercy. ${cap(t)} does not forgive it freely.`,
  bulwark: (t) => `Both combatants enter this ${t} hall already shielded.`,
  fading: (t) => `Curses find no purchase in the ${t} here; they slip away as quickly as spoken.`,
  mirror: () => 'At the top of the spire there is only yourself.',
};

function ruleText(f: { archetype: Archetype; theme: Theme; channel?: Channel }): string {
  switch (f.archetype) {
    case 'domain':
      return `Words of ${f.theme} are amplified — for both duelists.`;
    case 'taboo':
      return `Words of ${f.theme} turn against their speaker.`;
    case 'drain':
      return 'Fatigue lingers longer here; variety is dearer.';
    case 'echo':
      return 'Every cast echoes back upon its caster at half force.';
    case 'leyline':
      return `The ${f.channel} channel runs hot for both duelists.`;
    case 'silence':
      return `The ${f.channel} channel is silenced here — words of that kind do nothing.`;
    case 'bloodprice':
      return 'Words of healing turn to self-harm — restoration wounds the speaker instead.';
    case 'bulwark':
      return 'You and your foe each begin this floor already warded — break the shield before you can truly hurt them.';
    case 'fading':
      return "Hex fades twice as fast here, and never renews its own clock.";
    case 'mirror':
      return 'The Mirror casts only words you have already cast this run.';
  }
}

export function makeFloor(
  index: number,
  archetype: Archetype,
  theme: Theme,
  channel?: Channel,
): FloorSpec {
  const partial = { archetype, theme, channel };
  return {
    index,
    archetype,
    theme,
    channel,
    name: NAMES[archetype](theme),
    inscription: INSCRIPTIONS[archetype](theme),
    ruleText: ruleText(partial),
  };
}

/** Roll the run's 7 floors + Summit. Guarantees ≥1 taboo, no repeat archetypes back-to-back, unique themes. */
export function generateSpire(rng: () => number): FloorSpec[] {
  const themes = [...THEMES];
  const takeTheme = (): Theme => themes.splice(Math.floor(rng() * themes.length), 1)[0];

  const floors: FloorSpec[] = [];
  let prev: Archetype | null = null;
  for (let i = 1; i <= 7; i++) {
    let pool = TIER_POOLS[i].filter((a) => a !== prev);
    // Guarantee at least one taboo per run.
    if (i === 7 && !floors.some((f) => f.archetype === 'taboo') && prev !== 'taboo') {
      pool = ['taboo'];
    }
    const archetype = pool[Math.floor(rng() * pool.length)];
    const channel =
      archetype === 'leyline' || archetype === 'silence'
        ? CHANNELS[Math.floor(rng() * CHANNELS.length)]
        : undefined;
    floors.push(makeFloor(i, archetype, takeTheme(), channel));
    prev = archetype;
  }
  floors.push(makeFloor(8, 'mirror', takeTheme()));
  return floors;
}

export interface FloorWordEffect {
  /** Multiplier on total effective power (domain floors). */
  amp: number;
  /** Per-channel multiplier (leyline amplifies, silence zeroes); 1 elsewhere. */
  channelAmp: Partial<Record<Channel, number>>;
  /** Word falls in the forbidden region — offense turns on the caster. */
  tabooed: boolean;
  /** Theme affinity that produced the effect (for UI glow intensity). */
  affinity: number;
  /** Bloodprice floors: this word's heal component hurts its caster instead of restoring them. */
  healInverted: boolean;
}

export const NO_FLOOR_EFFECT: FloorWordEffect = {
  amp: 1,
  channelAmp: {},
  tabooed: false,
  affinity: 0,
  healInverted: false,
};

/** The floor's reading of a word — applies to BOTH duelists, and the preview. */
export function evaluateWord(scorer: Scorer, floor: FloorSpec | null, word: string): FloorWordEffect {
  if (!floor) return NO_FLOOR_EFFECT;
  switch (floor.archetype) {
    case 'domain': {
      const a = scorer.anchorAffinity(word, `themes:${floor.theme}`);
      return { ...NO_FLOOR_EFFECT, amp: 1 + DOMAIN_AMP * a, affinity: a };
    }
    case 'taboo': {
      const a = scorer.anchorAffinity(word, `themes:${floor.theme}`);
      return { ...NO_FLOOR_EFFECT, tabooed: a > TABOO_THRESHOLD, affinity: a };
    }
    case 'leyline':
      return {
        ...NO_FLOOR_EFFECT,
        channelAmp: floor.channel ? { [floor.channel]: LEYLINE_AMP } : {},
      };
    case 'silence':
      return {
        ...NO_FLOOR_EFFECT,
        channelAmp: floor.channel ? { [floor.channel]: 0 } : {},
      };
    case 'bloodprice':
      return { ...NO_FLOOR_EFFECT, healInverted: scorer.score(word).mix.heal > 0 };
    default:
      return NO_FLOOR_EFFECT;
  }
}

/** Drain floors slow fatigue recovery: older casts keep more weight. */
export function fatigueRecency(floor: FloorSpec | null): number[] {
  return floor?.archetype === 'drain' ? [1, 0.85, 0.7, 0.55] : [1, 0.75, 0.5, 0.25];
}

/** Theme → hue for background tint and palette swaps (same data, everywhere). */
export const THEME_HUES: Record<Theme, number> = {
  bone: 40, tide: 200, ash: 15, clockwork: 35, honey: 45, frost: 190,
  storm: 220, garden: 110, venom: 90, choir: 270, iron: 210, moth: 60,
  blood: 0, salt: 180, root: 30, lantern: 50, silk: 300, plague: 80,
  dream: 260, hunger: 10, glass: 175, ruin: 25, starlight: 240, ember: 20,
  mirror: 210, thunder: 230,
};
