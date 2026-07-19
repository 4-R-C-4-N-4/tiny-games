import type { OpponentDef } from './duel.ts';

// Each enemy = a wordlist + a policy + a portrait. Zero extra ML per enemy —
// they cast through the same scorer the player uses. The policy on the def is
// a default; SpireRun overrides it with the floor tier's policy.

export const NECROMANCER: OpponentDef = {
  name: 'The Necromancer',
  sprite: '💀',
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
  maxHp: 50,
  policy: 'random',
  words: [
    'storm', 'lightning', 'thunder', 'gale', 'tempest', 'squall', 'hail',
    'cyclone', 'monsoon', 'downpour', 'maelstrom', 'deluge', 'zephyr',
    'whirlwind', 'thunderbolt',
  ],
};

export const ROSTER: OpponentDef[] = [NECROMANCER, HIEROPHANT, STORM_CALLER];

/** The Summit: casts exclusively from the player's own run history. */
export function makeMirror(history: string[]): OpponentDef {
  return {
    name: 'The Mirror',
    sprite: '🪞',
    maxHp: 70,
    policy: 'mirror',
    words: [...new Set(history)],
  };
}
