import type { OpponentDef } from './duel.ts';

// Each enemy = a wordlist + a policy + a portrait. Zero extra ML per enemy —
// they cast through the same scorer the player uses. The policy on the def is
// a default; SpireRun overrides it with the floor tier's policy.

export const NECROMANCER: OpponentDef = {
  name: 'The Necromancer',
  sprite: '💀',
  art: 'necromancer',
  maxHp: 55,
  policy: 'random',
  words: [
    'bone', 'grave', 'shade', 'blight', 'plague', 'wraith', 'marrow', 'crypt',
    'husk', 'gloom', 'rot', 'wither', 'curse', 'ossuary', 'sepulchre',
  ],
};

export const HIEROPHANT: OpponentDef = {
  name: 'The Hierophant',
  sprite: '🕯️',
  art: 'hierophant',
  maxHp: 60,
  policy: 'random',
  words: [
    'hymn', 'psalm', 'litany', 'blessing', 'chalice', 'incense', 'shrine',
    'relic', 'halo', 'absolve', 'anoint', 'sanctuary', 'vestment', 'censer',
    'benediction',
  ],
};

export const STORM_CALLER: OpponentDef = {
  name: 'The Storm-Caller',
  sprite: '🌩️',
  art: 'stormcaller',
  maxHp: 50,
  policy: 'random',
  words: [
    'storm', 'lightning', 'thunder', 'gale', 'tempest', 'squall', 'hail',
    'cyclone', 'monsoon', 'downpour', 'maelstrom', 'deluge', 'zephyr',
    'whirlwind', 'thunderbolt',
  ],
};

export const WYRM: OpponentDef = {
  name: 'The Wyrm',
  sprite: '🐉',
  art: 'dragon',
  maxHp: 65,
  policy: 'random',
  words: [
    'dragon', 'flame', 'fang', 'talon', 'scale', 'wing', 'hoard', 'smoke',
    'cavern', 'roar', 'serpent', 'molten', 'greed', 'inferno', 'ember',
  ],
};

export const ROSTER: OpponentDef[] = [NECROMANCER, HIEROPHANT, STORM_CALLER, WYRM];

/** The Summit: casts exclusively from the player's own run history. */
export function makeMirror(history: string[]): OpponentDef {
  return {
    name: 'The Mirror',
    sprite: '🪞',
    art: 'mirror',
    maxHp: 70,
    policy: 'mirror',
    words: [...new Set(history)],
  };
}
