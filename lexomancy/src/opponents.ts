import type { OpponentDef } from './duel.ts';

// Each enemy = a wordlist + a policy + a portrait. Zero extra ML per enemy —
// they cast through the same scorer the player uses.

export const NECROMANCER: OpponentDef = {
  name: 'The Necromancer',
  sprite: '💀',
  maxHp: 55,
  policy: 'random',
  words: [
    'bone',
    'grave',
    'shade',
    'blight',
    'plague',
    'wraith',
    'marrow',
    'crypt',
    'husk',
    'gloom',
    'rot',
    'wither',
    'curse',
    'ossuary',
    'sepulchre',
  ],
};
