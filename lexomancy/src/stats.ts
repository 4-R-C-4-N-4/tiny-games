import type { Scorer } from './types.ts';

// The Self-Naming Rite: adjectives → stats, via the same anchor machinery as
// everything else. Near-synonym picks collapse with diminishing returns — the
// anti-dump-stat mechanic that teaches fatigue before the first duel.

export const STATS = ['ferocity', 'guile', 'stone', 'grace', 'resonance'] as const;
export type StatName = (typeof STATS)[number];
export type Stats = Record<StatName, number>;

export const NEUTRAL_STATS: Stats = {
  ferocity: 0.5,
  guile: 0.5,
  stone: 0.5,
  grace: 0.5,
  resonance: 0.5,
};

/** Divisor mapping summed weighted affinities to the 0..1 stat range. */
const RAW_SCALE = 2.0;
const FLAW_MALUS = 0.75;
const FLAW_BONUS_BASE = 0.06;
const FLAW_BONUS_RARITY = 0.1;

export interface RiteResult {
  stats: Stats;
  /** Marginal weight each pick contributed (1 = fresh, ~0 = redundant synonym). */
  weights: number[];
  flawStat: StatName | null;
  flawBonus: number;
}

export function statAffinity(scorer: Scorer, word: string, stat: StatName): number {
  return scorer.anchorAffinity(word, `stats:${stat}`);
}

/**
 * Score a drafted self-description. Each pick's contribution is weighted by
 * how different it is from every earlier pick (squared similarity, so true
 * synonyms collapse hard while merely-related words survive).
 */
export function performRite(scorer: Scorer, picks: string[], flaw?: string): RiteResult {
  const weights: number[] = [];
  const raw: Stats = { ferocity: 0, guile: 0, stone: 0, grace: 0, resonance: 0 };

  picks.forEach((pick, i) => {
    let overlap = 0;
    for (let j = 0; j < i; j++) {
      const sim = scorer.similarity(pick, picks[j]);
      overlap = Math.max(overlap, sim * sim);
    }
    const weight = 1 - overlap;
    weights.push(weight);
    for (const stat of STATS) raw[stat] += weight * statAffinity(scorer, pick, stat);
  });

  const stats = { ...raw };
  for (const stat of STATS) stats[stat] = Math.min(1, raw[stat] / RAW_SCALE);

  let flawStat: StatName | null = null;
  let flawBonus = 0;
  if (flaw && scorer.knows(flaw)) {
    flawStat = STATS[0];
    for (const stat of STATS) {
      if (statAffinity(scorer, flaw, stat) > statAffinity(scorer, flaw, flawStat)) flawStat = stat;
    }
    // The flaw hollows its own stat and deepens the rest — rarer flaws, spoken
    // more precisely, grant more.
    flawBonus = FLAW_BONUS_BASE + FLAW_BONUS_RARITY * scorer.score(flaw).rarity;
    for (const stat of STATS) {
      stats[stat] =
        stat === flawStat ? stats[stat] * FLAW_MALUS : Math.min(1, stats[stat] + flawBonus);
    }
  }

  return { stats, weights, flawStat, flawBonus };
}

/** Dominant stat — drives the player sprite palette and True Name later. */
export function dominantStat(stats: Stats): StatName {
  let best: StatName = STATS[0];
  for (const s of STATS) if (stats[s] > stats[best]) best = s;
  return best;
}
