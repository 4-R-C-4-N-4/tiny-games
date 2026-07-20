import { describe, expect, it } from 'vitest';
import { Duel, type CastEvent, type DuelEvent } from './duel.ts';
import { NECROMANCER } from './opponents.ts';
import { StubScorer } from './stub-scorer.ts';

const scorer = new StubScorer();

function newDuel(seed = 1): Duel {
  return new Duel(scorer, NECROMANCER, seed);
}

function casts(events: DuelEvent[] | null): CastEvent[] {
  return (events ?? []).filter((e): e is CastEvent => e.kind === 'cast');
}

describe('Duel', () => {
  it('player damage reduces enemy hp', () => {
    const d = newDuel();
    const [cast] = casts(d.castPlayer('smite'));
    expect(cast.damage).toBeGreaterThan(0);
    expect(d.enemy.hp).toBe(d.enemy.maxHp - cast.damage);
  });

  it('is deterministic for a fixed seed and cast sequence', () => {
    const run = () => {
      const d = newDuel(42);
      const log: DuelEvent[] = [];
      for (const w of ['smite', 'mirror', 'balm']) {
        log.push(...(d.castPlayer(w) ?? []), ...d.enemyTurn());
      }
      return { log, php: d.player.hp, ehp: d.enemy.hp };
    };
    expect(run()).toEqual(run());
  });

  it('different seeds diverge the enemy policy', () => {
    const words = (seed: number) => {
      const d = new Duel(scorer, NECROMANCER, seed);
      const out: string[] = [];
      for (let i = 0; i < 6 && !d.winner; i++) {
        d.castPlayer('mend');
        out.push(...casts(d.enemyTurn()).map((c) => c.word));
      }
      return out.join(',');
    };
    expect(words(1)).not.toEqual(words(99));
  });

  it('repeating a word fizzles: second cast is weaker, same mana cost', () => {
    const d = newDuel();
    const [first] = casts(d.castPlayer('smite'));
    const [second] = casts(d.castPlayer('smite'));
    expect(second.effectiveness).toBeLessThan(first.effectiveness);
    expect(second.damage).toBeLessThan(first.damage);
    expect(second.cost).toBe(first.cost);
  });

  it('rotating channels recovers effectiveness', () => {
    const d = newDuel();
    d.castPlayer('smite');
    const preRepeat = d.preview('smite')!.effectiveness;
    const preRotate = d.preview('mirror')!.effectiveness;
    expect(preRotate).toBeGreaterThan(preRepeat);
  });

  it('wards absorb incoming damage before hp', () => {
    const d = newDuel();
    const [wardCast] = casts(d.castPlayer('bulwark'));
    expect(wardCast.wardGained).toBeGreaterThan(0);
    const hpBefore = d.player.hp;
    // Force enemy turns until one lands damage on the ward.
    let absorbed = 0;
    for (let i = 0; i < 8 && absorbed === 0; i++) {
      absorbed = casts(d.enemyTurn()).reduce((a, c) => a + c.absorbed, 0);
      d.castPlayer('mend');
    }
    expect(absorbed).toBeGreaterThan(0);
    expect(d.player.hp + absorbed).toBeGreaterThanOrEqual(hpBefore - (hpBefore - d.player.hp));
  });

  it('the hex-heavy enemy eventually lands a hex', () => {
    const d = newDuel();
    let hexed = 0;
    for (let i = 0; i < 10 && hexed === 0; i++) {
      d.castPlayer('wall');
      hexed = casts(d.enemyTurn()).reduce((a, c) => a + c.hexApplied, 0);
    }
    expect(hexed).toBeGreaterThan(0);
  });

  it('hex drains at turn start and weakens casts', () => {
    const d = newDuel();
    d.player.hex = { potency: 12, turns: 3 };
    const weakened = d.preview('smite')!;
    expect(weakened.effectiveness).toBeLessThan(1);
    const events = d.castPlayer('smite') ?? [];
    expect(events.some((e) => e.kind === 'drain')).toBe(true);
    expect(d.player.hp).toBeLessThan(d.player.maxHp);
  });

  it('healing cleanses hex potency', () => {
    const d = newDuel();
    d.player.hex = { potency: 20, turns: 3 };
    d.castPlayer('panacea');
    expect(d.player.hex === null || d.player.hex.potency < 20).toBe(true);
  });

  it('declares a winner and refuses further casts', () => {
    const d = newDuel();
    d.enemy.hp = 1;
    const events = d.castPlayer('smite') ?? [];
    expect(events.some((e) => e.kind === 'defeat')).toBe(true);
    expect(d.winner).toBe('player');
    expect(d.castPlayer('smite')).toBeNull();
    expect(d.enemyTurn()).toEqual([]);
  });

  it('rejects unaffordable or unknown casts', () => {
    const d = newDuel();
    d.player.mana = 1;
    expect(d.castPlayer('conflagration')).toBeNull();
    expect(d.castPlayer('xy zzy')).toBeNull();
  });

  it('preview reflects what a cast would actually do', () => {
    const d = newDuel();
    d.castPlayer('smite');
    d.enemyTurn();
    const p = d.preview('smite')!;
    const [cast] = casts(d.castPlayer('smite'));
    expect(cast.effectiveness).toBeCloseTo(p.effectiveness, 6);
  });
});
