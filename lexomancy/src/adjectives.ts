// The rite draft pool: hand-picked adjectives spanning the five stats, with
// enough near-synonym clusters that the diminishing-returns lesson can land.
// Drafts offer 12; the player picks 5 plus writes one free-form flaw.

export const ADJECTIVE_POOL: string[] = [
  // ferocity-leaning
  'ruthless', 'savage', 'burning', 'fierce', 'wrathful', 'relentless', 'feral',
  'brutal', 'furious', 'merciless', 'vicious', 'untamed', 'bloodthirsty', 'raging',
  // guile-leaning
  'cunning', 'sly', 'crafty', 'devious', 'wily', 'scheming', 'shrewd',
  'calculating', 'secretive', 'elusive', 'treacherous', 'subtle',
  // stone-leaning
  'patient', 'unyielding', 'steadfast', 'enduring', 'immovable', 'rooted',
  'stalwart', 'resolute', 'stubborn', 'unshakable', 'abiding', 'firm',
  // grace-leaning
  'gentle', 'serene', 'tender', 'luminous', 'merciful', 'kind', 'radiant',
  'compassionate', 'calm', 'nurturing', 'verdant', 'mild',
  // resonance-leaning
  'learned', 'ancient', 'strange', 'arcane', 'curious', 'attuned', 'scholarly',
  'obscure', 'esoteric', 'haunted', 'eldritch', 'deep',
];

/** Seeded 12-card offer. Uses a caller-supplied rng so runs are reproducible. */
export function draftOffer(rng: () => number, size = 12): string[] {
  const pool = [...ADJECTIVE_POOL];
  const offer: string[] = [];
  while (offer.length < size && pool.length > 0) {
    const i = Math.floor(rng() * pool.length);
    offer.push(pool.splice(i, 1)[0]);
  }
  return offer;
}
