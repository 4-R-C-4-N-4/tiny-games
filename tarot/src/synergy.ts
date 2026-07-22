import type { SpreadResult, Suit } from './types';

// Pre-computed patterns across the whole spread — cheap to derive in code,
// hard for a small LLM to notice on its own. Fed into the prompt and shown
// in the UI as the spread's "currents".

const SUIT_ENERGY: Record<Exclude<Suit, 'major'>, string> = {
  wands: 'fire: will, ambition and creative drive',
  cups: 'water: emotion, relationships and intuition',
  swords: 'air: intellect, conflict and hard truths',
  pentacles: 'earth: work, money, body and material ground',
};

const RANK_THEME: Record<number, string> = {
  1: 'beginnings and raw potential',
  2: 'duality, balance and partnership',
  3: 'growth, creativity and collaboration',
  4: 'stability and structure',
  5: 'conflict, change and upheaval',
  6: 'harmony and restoration',
  7: 'reflection, testing and reassessment',
  8: 'mastery, movement and power',
  9: 'culmination, the last stretch',
  10: 'completion and the turn into something new',
  11: 'messages, students and fresh eyes',
  12: 'pursuit, momentum and quests',
  13: 'mature, nurturing command of their element',
  14: 'authority and decided leadership',
};

const RANK_PLURAL: Record<number, string> = {
  1: 'Aces', 2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives',
  6: 'Sixes', 7: 'Sevens', 8: 'Eights', 9: 'Nines', 10: 'Tens',
  11: 'Pages', 12: 'Knights', 13: 'Queens', 14: 'Kings',
};

const COUNT_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function computeSynergies(spread: SpreadResult): string[] {
  const notes: string[] = [];
  const size = spread.cards.length;
  const cards = spread.cards.map((c) => c.card);

  // Suit dominance among the minors.
  const suitThreshold = Math.max(2, Math.ceil(size * 0.4));
  const suitCounts = new Map<Exclude<Suit, 'major'>, number>();
  for (const card of cards) {
    if (card.suit === 'major') continue;
    suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
  }
  for (const [suit, count] of suitCounts) {
    if (count >= suitThreshold) {
      notes.push(`${COUNT_WORD[count]} of the ${COUNT_WORD[size]} cards are ${suit[0].toUpperCase()}${suit.slice(1)} — the spread leans toward ${SUIT_ENERGY[suit]}.`);
    }
  }

  // Major Arcana density.
  const majors = cards.filter((c) => c.suit === 'major').length;
  if (majors / size >= 0.5) {
    notes.push(`${COUNT_WORD[majors]} of ${COUNT_WORD[size]} cards are Major Arcana — large, archetypal forces are steering this matter, not day-to-day choices.`);
  } else if (majors === 0) {
    notes.push('No Major Arcana appear — this is a practical, everyday matter, fully within your hands.');
  }

  // Repeated ranks: minors always count; majors join for numbers 1–10
  // (e.g. The Empress counts among the Threes).
  const rankCounts = new Map<number, string[]>();
  for (const card of cards) {
    if (card.suit === 'major' && (card.number < 1 || card.number > 10)) continue;
    const names = rankCounts.get(card.number) ?? [];
    names.push(card.name);
    rankCounts.set(card.number, names);
  }
  for (const [rank, names] of rankCounts) {
    if (names.length >= 2) {
      const intensity = names.length >= 3 ? 'an insistent echo' : 'a repeated note';
      notes.push(`${COUNT_WORD[names.length]} ${RANK_PLURAL[rank]} (${names.join(', ')}) — ${intensity} of ${RANK_THEME[rank]}.`);
    }
  }

  // Reversal skew — only meaningful when reversals are in play at all.
  if (spread.reversalsAllowed) {
    const reversed = spread.cards.filter((c) => c.isReversed).length;
    if (reversed / size >= 2 / 3) {
      notes.push(`${COUNT_WORD[reversed]} of ${COUNT_WORD[size]} cards fall reversed — the spread's energy is blocked, delayed or turned inward.`);
    } else if (reversed === 0 && size >= 3) {
      notes.push('Every card falls upright — the energies here flow unobstructed.');
    }
  }

  return notes.map(cap);
}
