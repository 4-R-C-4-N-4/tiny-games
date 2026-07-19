import { CHANNELS, type Channel, type ChannelMix, type Scorer, type SpellProfile } from './types.ts';

// Placeholder for the real embedding+head scorer. Two tiers:
//  1. A hand-authored seed lexicon so canonical spell-words read correctly in demos.
//  2. A deterministic hash fallback for everything else — arbitrary but stable, so
//     the "same word, same spell" contract holds even before the model exists.
// The interface (types.Scorer) is the contract the real model must satisfy; the UI
// and duel loop never know which backend they're talking to.

/** Raw channel affinities (pre-softmax) and rarity for hand-seeded words. */
type SeedEntry = { d: number; x: number; w: number; h: number; rarity: number };

const SEED: Record<string, SeedEntry> = {
  // damage ladder (rarity is the power knob — "kill is a cantrip")
  kill: { d: 0.9, x: 0.2, w: 0.0, h: 0.0, rarity: 0.05 },
  burn: { d: 0.8, x: 0.3, w: 0.0, h: 0.0, rarity: 0.1 },
  fire: { d: 0.75, x: 0.1, w: 0.1, h: 0.1, rarity: 0.05 },
  smite: { d: 0.9, x: 0.1, w: 0.1, h: 0.1, rarity: 0.45 },
  immolate: { d: 0.95, x: 0.25, w: 0.0, h: 0.0, rarity: 0.7 },
  conflagration: { d: 1.0, x: 0.2, w: 0.0, h: 0.0, rarity: 0.9 },
  // hex
  curse: { d: 0.15, x: 0.9, w: 0.0, h: 0.0, rarity: 0.15 },
  rot: { d: 0.4, x: 0.8, w: 0.0, h: 0.0, rarity: 0.3 },
  wither: { d: 0.3, x: 0.85, w: 0.0, h: 0.0, rarity: 0.5 },
  malediction: { d: 0.1, x: 1.0, w: 0.0, h: 0.0, rarity: 0.9 },
  // ward
  shield: { d: 0.0, x: 0.0, w: 0.9, h: 0.1, rarity: 0.1 },
  wall: { d: 0.05, x: 0.0, w: 0.85, h: 0.0, rarity: 0.05 },
  mirror: { d: 0.0, x: 0.1, w: 0.95, h: 0.05, rarity: 0.3 },
  bulwark: { d: 0.05, x: 0.0, w: 1.0, h: 0.05, rarity: 0.75 },
  // heal
  heal: { d: 0.0, x: 0.0, w: 0.1, h: 0.9, rarity: 0.05 },
  mend: { d: 0.0, x: 0.0, w: 0.1, h: 0.85, rarity: 0.3 },
  dawn: { d: 0.0, x: 0.0, w: 0.4, h: 0.75, rarity: 0.35 },
  balm: { d: 0.0, x: 0.0, w: 0.15, h: 0.9, rarity: 0.6 },
  panacea: { d: 0.0, x: 0.1, w: 0.1, h: 1.0, rarity: 0.9 },
  // notable hybrids
  storm: { d: 0.7, x: 0.3, w: 0.2, h: 0.0, rarity: 0.25 },
  winter: { d: 0.5, x: 0.5, w: 0.3, h: 0.0, rarity: 0.3 },
  gravity: { d: 0.6, x: 0.4, w: 0.2, h: 0.0, rarity: 0.45 },
  rust: { d: 0.45, x: 0.7, w: 0.0, h: 0.0, rarity: 0.4 },
  // necromancer lexicon (decay/death, hex-leaning)
  bone: { d: 0.5, x: 0.5, w: 0.2, h: 0.0, rarity: 0.15 },
  grave: { d: 0.3, x: 0.7, w: 0.2, h: 0.0, rarity: 0.2 },
  shade: { d: 0.25, x: 0.7, w: 0.3, h: 0.0, rarity: 0.35 },
  blight: { d: 0.45, x: 0.85, w: 0.0, h: 0.0, rarity: 0.55 },
  plague: { d: 0.5, x: 0.8, w: 0.0, h: 0.0, rarity: 0.4 },
  wraith: { d: 0.55, x: 0.6, w: 0.1, h: 0.0, rarity: 0.6 },
  marrow: { d: 0.3, x: 0.55, w: 0.1, h: 0.25, rarity: 0.55 },
  crypt: { d: 0.15, x: 0.5, w: 0.6, h: 0.0, rarity: 0.45 },
  husk: { d: 0.35, x: 0.6, w: 0.25, h: 0.0, rarity: 0.5 },
  gloom: { d: 0.2, x: 0.75, w: 0.2, h: 0.0, rarity: 0.4 },
  ossify: { d: 0.4, x: 0.5, w: 0.5, h: 0.0, rarity: 0.8 },
  sepulchre: { d: 0.2, x: 0.6, w: 0.55, h: 0.0, rarity: 0.85 },
};

/** Softmax temperature: lower = sharper channel separation. Tuned by feel. */
const TEMPERATURE = 0.25;
const MIN_WORD = 2;
const MAX_WORD = 24;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic uniform in [0,1) from a string key. */
function unit(key: string): number {
  return fnv1a(key) / 0x100000000;
}

function softmax(raw: number[], temperature: number): number[] {
  const m = Math.max(...raw);
  const exps = raw.map((v) => Math.exp((v - m) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function normalize(word: string): string {
  return word.trim().toLowerCase();
}

export class StubScorer implements Scorer {
  knows(word: string): boolean {
    const w = normalize(word);
    return w.length >= MIN_WORD && w.length <= MAX_WORD && /^[a-z]+$/.test(w);
  }

  /**
   * Stub similarity: cosine of the two channel mixes, with exact repeats pinned
   * to 1. Approximates semantic fatigue as *channel* fatigue — repeating a
   * channel tires it. The real embedding cosine will distinguish true synonyms
   * ("kill"/"murder") from same-channel-different-theme words.
   */
  similarity(a: string, b: string): number {
    const wa = normalize(a);
    const wb = normalize(b);
    if (wa === wb) return 1;
    const ma = this.score(wa).mix;
    const mb = this.score(wb).mix;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (const c of CHANNELS) {
      dot += ma[c] * mb[c];
      na += ma[c] * ma[c];
      nb += mb[c] * mb[c];
    }
    return dot / Math.sqrt(na * nb);
  }

  score(word: string): SpellProfile {
    const w = normalize(word);
    const seed = SEED[w];

    const raw: number[] = seed
      ? [seed.d, seed.x, seed.w, seed.h]
      : CHANNELS.map((c) => unit(`${w}:${c}`));

    // Fallback rarity: length as a crude frequency proxy, jittered so equal-length
    // words don't tier identically. Replaced by the real Zipf table later.
    const rarity = seed
      ? seed.rarity
      : Math.min(1, Math.max(0, (w.length - 3) / 10 + (unit(`${w}:rarity`) - 0.5) * 0.2));

    const mixArr = softmax(raw, TEMPERATURE);
    const mix = Object.fromEntries(CHANNELS.map((c, i) => [c, mixArr[i]])) as ChannelMix;

    let dominant: Channel = CHANNELS[0];
    for (const c of CHANNELS) if (mix[c] > mix[dominant]) dominant = c;

    // Rarity is the power knob (word rarity as loot).
    const power = Math.round(6 + 14 * rarity);

    // Purity surcharge: pure spikes cost more per point of power than hybrids.
    const purity = mix[dominant];
    const cost = Math.max(1, Math.round(power * (0.35 + 0.65 * purity)));

    return { word: w, mix, dominant, rarity, power, cost };
  }
}
