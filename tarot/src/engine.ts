import type { TarotCard, SpreadType, SpreadResult } from './types';

export class DeterministicRandom {
  private seed: number;
  constructor(seed: number) { this.seed = seed % 4294967296; }
  next(): number { this.seed = (this.seed * 1664525 + 1013904223) % 4294967296; return this.seed / 4294967296; }
  nextInt(min: number, max: number): number { return Math.floor(this.next() * (max - min + 1)) + min; }
}

export function seedFromString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export const SPREAD_POSITIONS: Record<SpreadType, string[]> = {
  'three-card': ['Past', 'Present', 'Future'],
  'celtic-cross': [
    'Situation', 'Challenge', 'Crown', 'Past', 'Foundation',
    'Near Future', 'Self', 'Environment', 'Hopes & Fears', 'Outcome',
  ],
};

// What each position asks of the card that lands there — indexed in
// parallel with SPREAD_POSITIONS.
export const POSITION_MEANINGS: Record<SpreadType, string[]> = {
  'three-card': [
    'the roots of the matter, influences that shaped where you are',
    'where things stand right now',
    'the direction things are heading if the current course holds',
  ],
  'celtic-cross': [
    'the heart of the matter, where you stand now',
    'what crosses you — the immediate obstacle or tension',
    'your conscious aim, the best that can be hoped for here',
    'recent influences that are now fading',
    'the root of the situation, what lies beneath awareness',
    'what approaches in the near term',
    'your own attitude and how you see yourself in this',
    'the people and circumstances surrounding the matter',
    'what you secretly hope for — or dread',
    'where it all resolves if nothing changes course',
  ],
};

export function getSpread(deck: TarotCard[], type: SpreadType, seedValue: number, allowReversals = true): SpreadResult {
  const rng = new DeterministicRandom(seedValue);
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const cards = SPREAD_POSITIONS[type].map((position, i) => {
    // Always consume the rng draw so toggling reversals never changes
    // which cards appear — only their orientation.
    const reversedRoll = rng.next() > 0.5;
    return {
      card: shuffled[i],
      position,
      isReversed: allowReversals && reversedRoll,
    };
  });
  return { type, cards, seed: seedValue.toString(), reversalsAllowed: allowReversals };
}
