import { describe, expect, it } from 'vitest';
import { cardScan } from './scans';
import { FULL_DECK } from './data';

describe('cardScan', () => {
  it('has a bundled 1909 scan for every card in the deck', () => {
    for (const card of FULL_DECK) {
      expect(cardScan(card), card.id).toBeTruthy();
    }
  });

  it('returns null for an unknown card id', () => {
    expect(cardScan({ ...FULL_DECK[0], id: 'nonsense-99' })).toBeNull();
  });
});
