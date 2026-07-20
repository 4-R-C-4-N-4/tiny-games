export const CHANNELS = ['damage', 'hex', 'ward', 'heal'] as const;
export type Channel = (typeof CHANNELS)[number];

export type ChannelMix = Record<Channel, number>;

/** A word's full spell reading — deterministic: same word, same profile, always. */
export interface SpellProfile {
  word: string;
  /** Softmax-sharpened channel mix; sums to 1. */
  mix: ChannelMix;
  /** Dominant channel (largest mix component). */
  dominant: Channel;
  /** 0 (everyday word) .. 1 (deep-lexicon rarity). */
  rarity: number;
  /** Total spell magnitude before splitting across channels; scales with rarity. */
  power: number;
  /** Mana cost. Pure words cost more per point of power than hybrids. */
  cost: number;
  /** True if this word isn't a dictionary entry — a decomposed or babbled neologism. */
  improvised: boolean;
  /** Real word fragments a non-dictionary word decomposed into, if any. */
  roots?: string[];
}

export interface Scorer {
  score(word: string): SpellProfile;
  /** True if the word is castable at all — valid shape. Any shape-valid word
   * is castable now: dictionary words score normally, everything else is an
   * improvised neologism (decomposed from real roots, or weak babble). */
  knows(word: string): boolean;
  /**
   * Semantic similarity in [0,1] — drives fatigue. The real model uses embedding
   * cosine; stubs may approximate.
   */
  similarity(a: string, b: string): number;
  /**
   * Affinity in [0,1] of a word to a shipped anchor ("stats:ferocity",
   * "themes:bone"). Powers the Self-Naming Rite and floor domains/taboos.
   */
  anchorAffinity(word: string, anchor: string): number;
}
