import { describe, expect, it } from 'vitest';
import { computeSynergies } from './synergy';
import { buildReadingPrompt, composeFallback } from './interpret';
import { FULL_DECK, MAJOR_ARCANA, MINOR_ARCANA } from './data';
import { getSpread, POSITION_MEANINGS, SPREAD_POSITIONS } from './engine';
import type { SpreadResult, TarotCard } from './types';

function byId(id: string): TarotCard {
  const card = FULL_DECK.find((c) => c.id === id);
  if (!card) throw new Error(`no card ${id}`);
  return card;
}

function makeSpread(ids: string[], reversed: boolean[] = []): SpreadResult {
  const type = ids.length === 3 ? 'three-card' : 'celtic-cross';
  return {
    type,
    seed: '42',
    reversalsAllowed: true,
    cards: ids.map((id, i) => ({
      card: byId(id),
      position: SPREAD_POSITIONS[type][i],
      isReversed: reversed[i] ?? false,
    })),
  };
}

describe('FULL_DECK', () => {
  it('holds all 78 cards with unique ids and names', () => {
    expect(FULL_DECK.length).toBe(78);
    expect(MAJOR_ARCANA.length).toBe(22);
    expect(MINOR_ARCANA.length).toBe(56);
    expect(new Set(FULL_DECK.map((c) => c.id)).size).toBe(78);
    expect(new Set(FULL_DECK.map((c) => c.name)).size).toBe(78);
  });

  it('has 14 cards per minor suit', () => {
    for (const suit of ['wands', 'cups', 'swords', 'pentacles'] as const) {
      expect(MINOR_ARCANA.filter((c) => c.suit === suit).length).toBe(14);
    }
  });

  it('leaves no meaning or description empty', () => {
    for (const card of FULL_DECK) {
      expect(card.meaningUpright.length, card.id).toBeGreaterThan(0);
      expect(card.meaningReversed.length, card.id).toBeGreaterThan(0);
      expect(card.description.length, card.id).toBeGreaterThan(0);
    }
  });
});

describe('computeSynergies', () => {
  it('flags three of a suit in a three-card spread', () => {
    const notes = computeSynergies(makeSpread(['cups-2', 'cups-5', 'cups-9']));
    expect(notes.join(' ')).toMatch(/Cups/);
    expect(notes.join(' ')).toMatch(/emotion/);
  });

  it('flags repeated ranks, majors included (three Threes)', () => {
    const notes = computeSynergies(makeSpread(['wands-3', 'cups-3', '3']));
    const joined = notes.join(' ');
    expect(joined).toMatch(/Threes/);
    expect(joined).toMatch(/The Empress/);
    expect(joined).toMatch(/growth/);
  });

  it('does not mix court ranks with high majors (Justice is not a Page)', () => {
    const notes = computeSynergies(makeSpread(['wands-11', 'cups-11', '11']));
    const joined = notes.join(' ');
    expect(joined).toMatch(/two Pages/i);
    expect(joined).not.toMatch(/Justice/);
  });

  it('flags a majors-dominated spread', () => {
    const notes = computeSynergies(makeSpread(['0', '13', '16']));
    expect(notes.join(' ')).toMatch(/Major Arcana/);
  });

  it('flags an all-minors spread as practical', () => {
    const notes = computeSynergies(makeSpread(['wands-1', 'cups-6', 'swords-9']));
    expect(notes.join(' ')).toMatch(/No Major Arcana/);
  });

  it('flags heavy reversal and all-upright spreads', () => {
    expect(computeSynergies(makeSpread(['wands-1', 'cups-6', 'swords-9'], [true, true, true])).join(' '))
      .toMatch(/reversed/);
    expect(computeSynergies(makeSpread(['0', 'cups-6', 'swords-9'], [false, false, false])).join(' '))
      .toMatch(/upright/);
  });

  it('stays silent about orientation when reversals are disabled', () => {
    const spread = makeSpread(['0', 'cups-6', 'swords-9'], [false, false, false]);
    spread.reversalsAllowed = false;
    expect(computeSynergies(spread).join(' ')).not.toMatch(/upright|reversed/);
  });

  it('is quiet on a spread with nothing notable', () => {
    // one major, mixed suits, mixed ranks, mixed orientation
    const notes = computeSynergies(makeSpread(['0', 'cups-6', 'swords-9'], [true, false, false]));
    expect(notes.length).toBe(0);
  });
});

describe('buildReadingPrompt', () => {
  it('places each card in its position context with background', () => {
    const spread = makeSpread(['wands-3', 'cups-3', '3'], [false, true, false]);
    const prompt = buildReadingPrompt(spread, 'should I take the job?');
    expect(prompt).toContain('My question: should I take the job?');
    expect(prompt).toContain(`Past — this position shows ${POSITION_MEANINGS['three-card'][0]}`);
    expect(prompt).toContain('Three of Cups, reversed');
    expect(prompt).toContain(byId('wands-3').description);
    expect(prompt).toContain('Patterns across the whole spread:');
    expect(prompt).toMatch(/Threes/);
  });

  it('covers all ten celtic cross positions', () => {
    const spread = getSpread(FULL_DECK, 'celtic-cross', 7);
    const prompt = buildReadingPrompt(spread, '');
    for (const meaning of POSITION_MEANINGS['celtic-cross']) {
      expect(prompt).toContain(meaning);
    }
  });
});

describe('composeFallback', () => {
  it('mentions position meanings and currents', () => {
    const spread = makeSpread(['cups-2', 'cups-5', 'cups-9']);
    const text = composeFallback(spread, '');
    expect(text).toContain(POSITION_MEANINGS['three-card'][0]);
    expect(text).toMatch(/Cups/);
  });
});
