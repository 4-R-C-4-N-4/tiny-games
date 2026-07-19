import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADJECTIVE_POOL, draftOffer } from './adjectives.ts';
import { Duel } from './duel.ts';
import { generateSpire, makeFloor, evaluateWord, THEMES } from './floors.ts';
import { ModelScorer } from './model-scorer.ts';
import { ROSTER, makeMirror } from './opponents.ts';
import { SpireRun } from './run.ts';
import { performRite, dominantStat, STATS } from './stats.ts';
import { StubScorer } from './stub-scorer.ts';

const BIN = fileURLToPath(new URL('../web/public/lexicon.bin', import.meta.url));
const present = existsSync(BIN);
const model = present
  ? (() => {
      const buf = readFileSync(BIN);
      return ModelScorer.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    })()
  : null;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('floor generation', () => {
  it('rolls 7 floors + the Summit with constraints', () => {
    for (let seed = 1; seed < 30; seed++) {
      const floors = generateSpire(rng(seed));
      expect(floors).toHaveLength(8);
      expect(floors[7].archetype).toBe('mirror');
      expect(floors.some((f) => f.archetype === 'taboo')).toBe(true);
      for (let i = 1; i < 7; i++) {
        expect(floors[i].archetype, `seed ${seed} floor ${i}`).not.toBe(floors[i - 1].archetype);
      }
      const themes = floors.map((f) => f.theme);
      expect(new Set(themes).size).toBe(themes.length);
    }
  });

  it('names and rule text are populated', () => {
    const floors = generateSpire(rng(5));
    for (const f of floors) {
      expect(f.name).toMatch(/^The /);
      expect(f.ruleText.length).toBeGreaterThan(10);
      expect(f.inscription.length).toBeGreaterThan(10);
    }
  });
});

describe.skipIf(!model)('spire systems on the real model', () => {
  const scorer = model!;

  it('all roster wordlists are castable in the shipped lexicon', () => {
    for (const opp of ROSTER) {
      for (const w of opp.words) {
        expect(scorer.knows(w), `${opp.name}: ${w}`).toBe(true);
      }
    }
    for (const a of ADJECTIVE_POOL) {
      expect(scorer.knows(a), `adjective: ${a}`).toBe(true);
    }
  });

  it('all themes ship as anchors', () => {
    for (const t of THEMES) {
      expect(scorer.anchors.get(`themes:${t}`), t).toBeDefined();
    }
  });

  it('the rite maps an aggressive self-description to ferocity', () => {
    const r = performRite(scorer, ['ruthless', 'savage', 'burning', 'fierce', 'merciless']);
    expect(dominantStat(r.stats)).toBe('ferocity');
  });

  it('synonym-stacking collapses: varied picks beat a synonym pile', () => {
    const pile = performRite(scorer, ['cruel', 'vicious', 'brutal', 'savage', 'ruthless']);
    const varied = performRite(scorer, ['savage', 'cunning', 'steadfast', 'serene', 'arcane']);
    const total = (s: Record<string, number>) => STATS.reduce((a, k) => a + s[k], 0);
    expect(total(varied.stats)).toBeGreaterThan(total(pile.stats));
    expect(pile.weights.slice(1).some((w) => w < 0.5)).toBe(true);
  });

  it('the flaw hollows its own stat and deepens the rest', () => {
    const base = performRite(scorer, ['savage', 'cunning', 'steadfast', 'serene', 'arcane']);
    const flawed = performRite(scorer, ['savage', 'cunning', 'steadfast', 'serene', 'arcane'], 'cowardly');
    expect(flawed.flawStat).not.toBeNull();
    const fs = flawed.flawStat!;
    expect(flawed.stats[fs]).toBeLessThan(base.stats[fs]);
    const other = STATS.find((s) => s !== fs)!;
    expect(flawed.stats[other]).toBeGreaterThanOrEqual(base.stats[other]);
  });

  it('domain floors amplify on-theme words in the preview', () => {
    const floor = makeFloor(1, 'domain', 'bone');
    const onTheme = evaluateWord(scorer, floor, 'skull');
    const offTheme = evaluateWord(scorer, floor, 'honey');
    expect(onTheme.amp).toBeGreaterThan(offTheme.amp);
    expect(onTheme.amp).toBeGreaterThan(1.2);
  });

  it('taboo floors flag forbidden words and backfire the cast', () => {
    const floor = makeFloor(3, 'taboo', 'frost');
    expect(evaluateWord(scorer, floor, 'blizzard').tabooed).toBe(true);
    expect(evaluateWord(scorer, floor, 'sword').tabooed).toBe(false);

    const d = new Duel(scorer, ROSTER[0], 1, { floor });
    const hpBefore = d.player.hp;
    const enemyBefore = d.enemy.hp;
    const events = d.castPlayer('blizzard') ?? [];
    const cast = events.find((e) => e.kind === 'cast');
    expect(cast && 'tabooed' in cast && cast.tabooed).toBe(true);
    expect(d.enemy.hp).toBe(enemyBefore);
    expect(d.player.hp).toBeLessThanOrEqual(hpBefore);
  });

  it('echo floors return half the damage to the caster', () => {
    const floor = makeFloor(6, 'echo', 'glass');
    const d = new Duel(scorer, ROSTER[0], 1, { floor });
    const hpBefore = d.player.hp;
    const events = d.castPlayer('inferno') ?? [];
    const echo = events.find((e) => e.kind === 'echo');
    expect(echo).toBeDefined();
    expect(d.player.hp).toBeLessThan(hpBefore);
  });

  it('ferocity raises player damage output', () => {
    const meek = new Duel(scorer, ROSTER[0], 1, {
      stats: { ferocity: 0.1, guile: 0.5, stone: 0.5, grace: 0.5, resonance: 0.5 },
    });
    const fierce = new Duel(scorer, ROSTER[0], 1, {
      stats: { ferocity: 1, guile: 0.5, stone: 0.5, grace: 0.5, resonance: 0.5 },
    });
    const dmg = (d: Duel) => {
      const evs = d.castPlayer('inferno') ?? [];
      const c = evs.find((e) => e.kind === 'cast');
      return c && 'damage' in c ? c.damage : 0;
    };
    expect(dmg(fierce)).toBeGreaterThan(dmg(meek));
  });

  it('resonance discounts rare words', () => {
    const dull = new Duel(scorer, ROSTER[0], 1, {
      stats: { ferocity: 0.5, guile: 0.5, stone: 0.5, grace: 0.5, resonance: 0 },
    });
    const attuned = new Duel(scorer, ROSTER[0], 1, {
      stats: { ferocity: 0.5, guile: 0.5, stone: 0.5, grace: 0.5, resonance: 1 },
    });
    expect(attuned.preview('conflagration')!.cost).toBeLessThan(
      dull.preview('conflagration')!.cost,
    );
  });

  it('a full seeded run can be played to the Summit', () => {
    const run = new SpireRun(scorer, 7);
    run.completeRite(run.offer().slice(0, 5), 'clumsy');
    const words = [
      'inferno', 'mirror', 'balm', 'tempest', 'venom', 'granite', 'wither',
      'radiance', 'quake', 'frostbite', 'ember', 'serpent', 'anthem', 'rust',
      'lullaby', 'gale', 'thorn', 'beacon', 'plague', 'dawn',
    ];
    let wi = 0;
    let guard = 0;
    while (run.phase !== 'ascended' && run.phase !== 'fallen' && guard++ < 400) {
      if (run.phase === 'threshold') {
        run.enterFloor();
        continue;
      }
      const duel = run.duel!;
      // Cheat the duel to a close so we exercise the whole spire quickly.
      const word = words[wi++ % words.length];
      if (duel.preview(word)?.affordable) run.castPlayer(word);
      else duel.player.mana = duel.player.maxMana;
      if (run.phase === 'duel') run.enemyTurn();
      if (run.phase === 'duel') duel.enemy.hp = Math.max(0, duel.enemy.hp - 15);
      if (run.phase === 'duel' && duel.enemy.hp === 0) {
        // force resolution on next player action
        duel.player.mana = duel.player.maxMana;
        run.castPlayer(words[wi++ % words.length]);
      }
      if (run.phase === 'duel') duel.player.hp = duel.player.maxHp; // keep alive
    }
    expect(run.phase).toBe('ascended');
    expect(run.history.length).toBeGreaterThan(8);
  });

  it('the Mirror casts only from the player history', () => {
    const mirror = makeMirror(['inferno', 'balm', 'mirror']);
    const d = new Duel(scorer, mirror, 3);
    d.castPlayer('granite');
    const events = d.enemyTurn();
    const cast = events.find((e) => e.kind === 'cast');
    if (cast && 'word' in cast) {
      expect(['inferno', 'balm', 'mirror']).toContain(cast.word);
    }
  });

  it('leaning one theme all run walks into a pre-warded boss', () => {
    const varied = new SpireRun(scorer, 3);
    const monotone = new SpireRun(scorer, 3);
    for (const w of ['inferno', 'granite', 'lullaby', 'venom', 'mirror', 'tempest', 'balm', 'rust', 'quake', 'anthem'])
      varied.history.push(w);
    for (const w of ['burn', 'fire', 'flame', 'blaze', 'scorch', 'inferno', 'ember', 'ignite', 'char', 'singe'])
      monotone.history.push(w);
    expect(monotone.historyConcentration()).toBeGreaterThan(varied.historyConcentration());
  });
});

describe('spire systems on the stub (offline fallback)', () => {
  const scorer = new StubScorer();

  it('rite + draft still function', () => {
    const offer = draftOffer(rng(1));
    expect(offer).toHaveLength(12);
    const r = performRite(scorer, offer.slice(0, 5));
    expect(Object.values(r.stats).every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('a run can be constructed and entered', () => {
    const run = new SpireRun(scorer, 2);
    run.completeRite(run.offer().slice(0, 5));
    const duel = run.enterFloor();
    expect(duel.floor).not.toBeNull();
    expect(run.phase).toBe('duel');
  });
});
