import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ModelScorer } from './model-scorer.ts';
import { CHANNELS } from './types.ts';
import golden from './model-scorer.golden.json';

const BIN = fileURLToPath(new URL('../web/public/lexicon.bin', import.meta.url));
const present = existsSync(BIN);

// The asset is committed; skipping only softens fresh checkouts mid-pipeline.
describe.skipIf(!present)('ModelScorer', () => {
  const buf = readFileSync(BIN);
  const scorer = ModelScorer.fromBuffer(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );

  it('loads the packed lexicon', () => {
    expect(scorer.wordCount).toBeGreaterThan(50000);
    expect(scorer.knows('kill')).toBe(true);
    expect(scorer.knows('conflagration')).toBe(true);
    // Any shape-valid word is castable now — "knows" just means "has a shape".
    expect(scorer.knows('zzzzzz')).toBe(true);
    expect(scorer.knows('a')).toBe(false);
    expect(scorer.knows('42')).toBe(false);
    expect(scorer.knows('word salad')).toBe(false);
  });

  it('matches the python golden profiles exactly where integral, closely where float', () => {
    for (const g of golden.profiles) {
      const p = scorer.score(g.word);
      expect(p.dominant, g.word).toBe(g.dominant);
      expect(p.power, g.word).toBe(g.power);
      expect(p.cost, g.word).toBe(g.cost);
      expect(p.rarity, g.word).toBeCloseTo(g.rarity, 4);
      for (const c of CHANNELS) {
        expect(p.mix[c], `${g.word}.${c}`).toBeCloseTo(g.mix[c], 4);
      }
    }
  });

  it('matches golden similarities', () => {
    for (const s of golden.similarity) {
      expect(scorer.similarity(s.a, s.b), `${s.a}~${s.b}`).toBeCloseTo(s.value, 4);
    }
  });

  it('similarity behaves like semantics: synonyms > related > unrelated', () => {
    expect(scorer.similarity('kill', 'murder')).toBeGreaterThan(0.6);
    expect(scorer.similarity('frost', 'ice')).toBeGreaterThan(0.3);
    expect(scorer.similarity('kill', 'murder')).toBeGreaterThan(
      scorer.similarity('kill', 'mirror'),
    );
    expect(scorer.similarity('honey', 'anvil')).toBeLessThan(0.05);
    expect(scorer.similarity('kill', 'kill')).toBe(1);
  });

  it('is deterministic and cached', () => {
    expect(scorer.score('winter')).toEqual(scorer.score('winter'));
  });

  it('ships stat and theme anchors', () => {
    expect(scorer.anchors.get('stats:ferocity')).toBeDefined();
    expect(scorer.anchors.get('themes:bone')).toBeDefined();
  });

  it('dictionary words are never marked improvised', () => {
    expect(scorer.score('inferno').improvised).toBe(false);
    expect(scorer.score('inferno').roots).toBeUndefined();
  });

  it('decomposes a portmanteau into its real roots', () => {
    const p = scorer.score('frostbane');
    expect(p.improvised).toBe(true);
    expect(p.roots).toEqual(['frost', 'bane']);
  });

  it('a decomposed neologism reads as a blend of its roots channels', () => {
    const frost = scorer.score('frost');
    const bane = scorer.score('bane');
    const blend = scorer.score('frostbane');
    // The blend should land closer to each root's profile than to an
    // unrelated word — it's not just falling back to noise.
    const dist = (a: typeof frost, b: typeof frost) =>
      CHANNELS.reduce((s, c) => s + Math.abs(a.mix[c] - b.mix[c]), 0);
    const unrelated = scorer.score('spreadsheet');
    expect(Math.min(dist(blend, frost), dist(blend, bane))).toBeLessThan(dist(blend, unrelated));
  });

  it('pure gibberish is weak, deterministic babble — not a power shortcut', () => {
    const gib = scorer.score('qzxvvkplor');
    expect(gib.improvised).toBe(true);
    expect(gib.roots).toBeUndefined();
    expect(gib.rarity).toBe(0);
    // Weak: no worse than a common real word like "kill" (also rarity 0).
    expect(gib.power).toBeLessThanOrEqual(scorer.score('kill').power);
    expect(scorer.score('qzxvvkplor')).toEqual(gib); // deterministic
  });

  it('an invented reskin of a real word still fatigues against it', () => {
    const d = scorer.score('killzorp');
    expect(d.roots).toEqual(['kill']);
    expect(scorer.similarity('killzorp', 'kill')).toBeGreaterThan(0.5);
  });
});

if (!present) {
  it('lexicon.bin missing — run the train/ pipeline (build_vocab, label_teacher, train_head, export_assets)', () => {
    expect.soft(true).toBe(true);
  });
}
