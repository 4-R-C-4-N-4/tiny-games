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

/** A Threshold "Pact": a permanent boon in exchange for entering hexed. */
export interface PactOption {
  label: string;
  manaBonus: number;
  hpBonus: number;
  ward: number;
  hexPotency: number;
  hexTurns: number;
}

/** A Threshold "Study": pay HP up front to learn about the coming boss. */
export interface StudyOption {
  label: string;
  hpCost: number;
  /** How many of the boss's words to reveal (0 = none, just the policy read). */
  wordCount: number;
}

/** Rolled once per floor so Pact/Study aren't the same two buttons every
 * single time — still small, hand-authored pools (variety from rolling,
 * not from bespoke-per-floor authoring). */
export const PACT_OPTIONS: PactOption[] = [
  { label: 'Pact: +4 max mana, enter hexed', manaBonus: 4, hpBonus: 0, ward: 0, hexPotency: 7, hexTurns: 3 },
  { label: 'Blood Pact: +8 max HP, enter hexed harder', manaBonus: 0, hpBonus: 8, ward: 0, hexPotency: 10, hexTurns: 2 },
  { label: 'Ward Pact: enter shielded, enter hexed lightly', manaBonus: 0, hpBonus: 0, ward: 10, hexPotency: 5, hexTurns: 4 },
];

export const STUDY_OPTIONS: StudyOption[] = [
  { label: 'Study: −5 max HP, read the boss', hpCost: 5, wordCount: 5 },
  { label: 'Deep Study: −8 max HP, read everything', hpCost: 8, wordCount: 99 },
  { label: 'Glance: −2 max HP, sense its nature', hpCost: 2, wordCount: 0 },
];

export interface FloorSpec {
  index: number; // 1-based; 8 = the Summit
  archetype: Archetype;
  theme: Theme;
  /** Leyline floors amplify one channel for both sides. */
  channel?: Channel;
  name: string;
  inscription: string;
  ruleText: string;
  pact: PactOption;
  study: StudyOption;
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

// Pure mood — no mechanical information lives here. The rule text below
// already states the exact mechanic AND names the exact theme where it
// matters ("Words of tide are amplified"); forcing the same theme word into
// a second, differently-worded sentence just produced confusing near-
// duplicate explanations ("curses find no purchase in the tide" reading
// like a second, competing account of what Fading does). The floor NAME
// already carries the theme too, so the inscription's only job is mood.
const INSCRIPTIONS: Record<Archetype, () => string> = {
  domain: () => 'The spire dreams here, and does not want to wake.',
  taboo: () => 'Some words are forbidden in this court, and have been for a very long time.',
  drain: () => 'Old words linger in this air, unwilling to fade.',
  echo: () => 'Say nothing here you are not prepared to hear again.',
  leyline: () => 'Power gathers here, restless and eager to be spent.',
  silence: () => 'Something about this place swallows sound whole.',
  bloodprice: () => 'This altar has always demanded more than it gives.',
  bulwark: () => 'Old wards linger in these stones, waiting to be called on again.',
  fading: () => 'Nothing unpleasant seems to last very long here.',
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
  pact: PactOption = PACT_OPTIONS[0],
  study: StudyOption = STUDY_OPTIONS[0],
): FloorSpec {
  const partial = { archetype, theme, channel };
  return {
    index,
    archetype,
    theme,
    channel,
    name: NAMES[archetype](theme),
    inscription: INSCRIPTIONS[archetype](),
    ruleText: ruleText(partial),
    pact,
    study,
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
    const pact = PACT_OPTIONS[Math.floor(rng() * PACT_OPTIONS.length)];
    const study = STUDY_OPTIONS[Math.floor(rng() * STUDY_OPTIONS.length)];
    floors.push(makeFloor(i, archetype, takeTheme(), channel, pact, study));
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
