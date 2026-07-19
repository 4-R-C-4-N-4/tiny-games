import { CHANNELS, type Channel, type Scorer } from './types.ts';

// Floors are hand-authored mechanic skeletons (archetypes) filled with
// generated semantic content (theme anchors shipped in lexicon.bin).
// archetype × theme at run start = large variety from small content.

export type Archetype = 'domain' | 'taboo' | 'drain' | 'echo' | 'leyline' | 'mirror';

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

/** Difficulty-tiered archetype pools. */
const TIER_POOLS: Record<number, Archetype[]> = {
  1: ['domain', 'leyline'],
  2: ['domain', 'leyline', 'drain'],
  3: ['domain', 'taboo', 'drain', 'leyline'],
  4: ['domain', 'taboo', 'drain', 'leyline'],
  5: ['taboo', 'drain', 'echo', 'domain'],
  6: ['taboo', 'drain', 'echo'],
  7: ['taboo', 'echo', 'domain'],
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
  mirror: () => 'The Summit of the Mirror',
};

const INSCRIPTIONS: Record<Archetype, (t: Theme) => string> = {
  domain: (t) => `Here the spire dreams of ${t}, and rewards those who dream along.`,
  taboo: (t) => `The court has forbidden ${t}. The walls remember why.`,
  drain: (t) => `The air is thick with spent words. They cling like ${t}.`,
  echo: (t) => `Speak carefully. The ${t} remembers your voice.`,
  leyline: (t) => `A vein of raw power runs through the ${t} here.`,
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
      archetype === 'leyline' ? CHANNELS[Math.floor(rng() * CHANNELS.length)] : undefined;
    floors.push(makeFloor(i, archetype, takeTheme(), channel));
    prev = archetype;
  }
  floors.push(makeFloor(8, 'mirror', takeTheme()));
  return floors;
}

export interface FloorWordEffect {
  /** Multiplier on total effective power (domain floors). */
  amp: number;
  /** Per-channel multiplier (leyline floors); 1 elsewhere. */
  channelAmp: Partial<Record<Channel, number>>;
  /** Word falls in the forbidden region — offense turns on the caster. */
  tabooed: boolean;
  /** Theme affinity that produced the effect (for UI glow intensity). */
  affinity: number;
}

export const NO_FLOOR_EFFECT: FloorWordEffect = {
  amp: 1,
  channelAmp: {},
  tabooed: false,
  affinity: 0,
};

/** The floor's reading of a word — applies to BOTH duelists, and the preview. */
export function evaluateWord(scorer: Scorer, floor: FloorSpec | null, word: string): FloorWordEffect {
  if (!floor) return NO_FLOOR_EFFECT;
  switch (floor.archetype) {
    case 'domain': {
      const a = scorer.anchorAffinity(word, `themes:${floor.theme}`);
      return { amp: 1 + DOMAIN_AMP * a, channelAmp: {}, tabooed: false, affinity: a };
    }
    case 'taboo': {
      const a = scorer.anchorAffinity(word, `themes:${floor.theme}`);
      return { amp: 1, channelAmp: {}, tabooed: a > TABOO_THRESHOLD, affinity: a };
    }
    case 'leyline':
      return {
        amp: 1,
        channelAmp: floor.channel ? { [floor.channel]: LEYLINE_AMP } : {},
        tabooed: false,
        affinity: 0,
      };
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
