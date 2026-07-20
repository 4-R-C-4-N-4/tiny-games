import { CHANNELS, type Channel, type ChannelMix, type Scorer, type SpellProfile } from './types.ts';

// The real scorer: 80k-word lexicon of int8 PCA-reduced GloVe vectors plus a
// tiny distilled MLP head, packed into lexicon.bin by train/export_assets.py.
// Every formula here is pinned to the python exporter via golden fixtures.
//
// Any shape-valid word is castable, not just dictionary entries. A word not
// in the lexicon is decomposed into real word fragments by dynamic-programming
// segmentation (same idea as "wordninja"), and its spell profile is read off
// a length-weighted blend of those fragments' embeddings — so "frostbane"
// genuinely reads as frost+bane, run through the exact same head as any real
// word. This also means fatigue still works on invented reskins ("killzorp"
// embeds near "kill" and fatigues against it). A word with zero recognizable
// fragments gets a low, fixed rarity — babble is weak, not a shortcut around
// learning real vocabulary.

interface ScoringParams {
  temperature: number;
  zipfZero: number;
  zipfRange: number;
  powerBase: number;
  powerRarity: number;
  potencyFloor: number;
  costBase: number;
  costPurity: number;
  zipfScale: number;
  simFloor: number;
  simRange: number;
}

interface Header {
  count: number;
  dims: number;
  hidden: number;
  channels: string[];
  scoring: ScoringParams;
  anchorNames: string[];
  anchorScales: number[];
  sections: Record<string, { offset: number; length: number }>;
}

/** A resolved word: a unit-length embedding plus how it was derived. */
interface Resolved {
  unit: Float32Array;
  rarity: number;
  roots: string[];
  improvised: boolean;
}

const WORD_SHAPE = /^[a-z]{2,24}$/;
const SEGMENT_MIN_FRAGMENT = 4;
const SEGMENT_MAX_FRAGMENT = 15;
const SEGMENT_GAP_PENALTY = 3.0;
const NEOLOGISM_NOVELTY_BONUS = 0.15;

function geluTanh(x: number): number {
  return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x * x * x)));
}

function normalize(word: string): string {
  return word.trim().toLowerCase();
}

function normalizeInPlace(v: Float32Array): Float32Array {
  let norm = 0;
  for (let k = 0; k < v.length; k++) norm += v[k] * v[k];
  norm = Math.sqrt(norm) || 1;
  for (let k = 0; k < v.length; k++) v[k] /= norm;
  return v;
}

function cosine(va: ArrayLike<number>, vb: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let k = 0; k < va.length; k++) {
    dot += va[k] * vb[k];
    na += va[k] * va[k];
    nb += vb[k] * vb[k];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

/** Deterministic pseudo-random unit vector — the "babble" fallback direction. */
function hashVector(word: string, dims: number): Float32Array {
  let seed = 0;
  for (let i = 0; i < word.length; i++) seed = (seed * 31 + word.charCodeAt(i)) >>> 0;
  let x = seed || 1;
  const out = new Float32Array(dims);
  for (let k = 0; k < dims; k++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[k] = (x / 0x100000000) * 2 - 1;
  }
  return normalizeInPlace(out);
}

export class ModelScorer implements Scorer {
  private readonly index = new Map<string, number>();
  private readonly profileCache = new Map<string, SpellProfile>();
  private readonly vectorCache = new Map<string, Resolved>();

  private constructor(
    private readonly header: Header,
    private readonly vecs: Int8Array,
    private readonly zipf: Uint8Array,
    private readonly w1: Float32Array,
    private readonly b1: Float32Array,
    private readonly w2: Float32Array,
    private readonly b2: Float32Array,
    readonly anchors: Map<string, Float32Array>,
    vocab: string[],
  ) {
    vocab.forEach((w, i) => this.index.set(w, i));
  }

  static fromBuffer(buf: ArrayBuffer): ModelScorer {
    const view = new DataView(buf);
    const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
    if (magic !== 'LEXO') throw new Error('not a lexicon.bin');
    const version = view.getUint32(4, true);
    if (version !== 1) throw new Error(`unsupported lexicon version ${version}`);
    const headerLen = view.getUint32(8, true);
    const base = 12 + headerLen;
    const header: Header = JSON.parse(
      new TextDecoder().decode(new Uint8Array(buf, 12, headerLen)),
    );
    const s = header.sections;
    const at = (name: string) => {
      const sec = s[name];
      if (!sec) throw new Error(`missing section ${name}`);
      return { start: base + sec.offset, length: sec.length };
    };

    const vocabSec = at('vocab');
    const vocab = new TextDecoder()
      .decode(new Uint8Array(buf, vocabSec.start, vocabSec.length))
      .split('\n');

    const vecSec = at('vectors');
    const vecs = new Int8Array(buf, vecSec.start, vecSec.length);
    const zipfSec = at('zipf');
    const zipf = new Uint8Array(buf, zipfSec.start, zipfSec.length);

    const headSec = at('head');
    const { dims, hidden } = header;
    const nOut = header.channels.length;
    const headFloats = new Float32Array(buf.slice(headSec.start, headSec.start + headSec.length));
    let o = 0;
    const take = (n: number) => headFloats.subarray(o, (o += n));
    const w1 = take(hidden * dims);
    const b1 = take(hidden);
    const w2 = take(nOut * hidden);
    const b2 = take(nOut);

    const anchorSec = at('anchors');
    const anchorFloats = new Float32Array(
      buf.slice(anchorSec.start, anchorSec.start + anchorSec.length),
    );
    const anchors = new Map<string, Float32Array>();
    header.anchorNames.forEach((name, i) => {
      anchors.set(name, anchorFloats.subarray(i * dims, (i + 1) * dims));
    });

    return new ModelScorer(header, vecs, zipf, w1, b1, w2, b2, anchors, vocab);
  }

  static async fromUrl(url: string): Promise<ModelScorer> {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`lexicon fetch failed: ${resp.status}`);
    return ModelScorer.fromBuffer(await resp.arrayBuffer());
  }

  get wordCount(): number {
    return this.header.count;
  }

  knows(word: string): boolean {
    return WORD_SHAPE.test(normalize(word));
  }

  private rarityOf(zipfIndex: number): number {
    const p = this.header.scoring;
    const z = this.zipf[zipfIndex] / p.zipfScale;
    return Math.min(1, Math.max(0, (p.zipfZero - z) / p.zipfRange));
  }

  private unitOf(vocabIndex: number): Float32Array {
    const { dims } = this.header;
    const v = this.vecs.subarray(vocabIndex * dims, (vocabIndex + 1) * dims);
    const out = new Float32Array(dims);
    for (let k = 0; k < dims; k++) out[k] = v[k] / 127;
    return out;
  }

  /**
   * Best dictionary-word decomposition of a string via DP segmentation:
   * maximize sum of (Zipf frequency × length) over matched fragments,
   * penalizing uncovered characters. Mirrors train/eval's segmentation logic.
   */
  private segment(w: string): Array<{ frag: string; index: number | null }> {
    const n = w.length;
    const score = new Float64Array(n + 1).fill(-Infinity);
    const back = new Int32Array(n + 1).fill(-1);
    score[0] = 0;
    const zipfScale = this.header.scoring.zipfScale;
    for (let i = 1; i <= n; i++) {
      for (let j = Math.max(0, i - SEGMENT_MAX_FRAGMENT); j < i; j++) {
        const flen = i - j;
        const frag = w.slice(j, i);
        const idx = flen >= SEGMENT_MIN_FRAGMENT ? this.index.get(frag) : undefined;
        const s =
          idx !== undefined
            ? score[j] + (this.zipf[idx] / zipfScale) * flen
            : score[j] - SEGMENT_GAP_PENALTY * flen;
        if (s > score[i]) {
          score[i] = s;
          back[i] = j;
        }
      }
    }
    const frags: Array<{ frag: string; index: number | null }> = [];
    let i = n;
    while (i > 0) {
      const j = back[i];
      const frag = w.slice(j, i);
      const idx = frag.length >= SEGMENT_MIN_FRAGMENT ? (this.index.get(frag) ?? null) : null;
      frags.unshift({ frag, index: idx });
      i = j;
    }
    return frags;
  }

  private resolve(w: string): Resolved {
    const cached = this.vectorCache.get(w);
    if (cached) return cached;

    const exact = this.index.get(w);
    let resolved: Resolved;
    if (exact !== undefined) {
      resolved = { unit: this.unitOf(exact), rarity: this.rarityOf(exact), roots: [], improvised: false };
    } else {
      const matched = this.segment(w).filter(
        (s): s is { frag: string; index: number } => s.index !== null,
      );
      if (matched.length > 0) {
        const { dims } = this.header;
        const blend = new Float32Array(dims);
        let totalLen = 0;
        let raritySum = 0;
        for (const { frag, index } of matched) {
          const v = this.unitOf(index);
          const flen = frag.length;
          for (let k = 0; k < dims; k++) blend[k] += v[k] * flen;
          raritySum += this.rarityOf(index) * flen;
          totalLen += flen;
        }
        normalizeInPlace(blend);
        const rarity = Math.min(1, raritySum / totalLen + NEOLOGISM_NOVELTY_BONUS);
        resolved = { unit: blend, rarity, roots: matched.map((m) => m.frag), improvised: true };
      } else {
        resolved = { unit: hashVector(w, this.header.dims), rarity: 0, roots: [], improvised: true };
      }
    }
    this.vectorCache.set(w, resolved);
    return resolved;
  }

  /** Raw 0-10 channel scores from the distilled head, given a unit input vector. */
  private rawScores(unit: Float32Array): number[] {
    const { dims, hidden } = this.header;
    const h = new Float32Array(hidden);
    for (let j = 0; j < hidden; j++) {
      let acc = this.b1[j];
      const row = j * dims;
      for (let k = 0; k < dims; k++) acc += this.w1[row + k] * unit[k];
      h[j] = geluTanh(acc);
    }
    const out: number[] = [];
    for (let c = 0; c < CHANNELS.length; c++) {
      let acc = this.b2[c];
      const row = c * hidden;
      for (let j = 0; j < hidden; j++) acc += this.w2[row + j] * h[j];
      out.push((1 / (1 + Math.exp(-acc))) * 10);
    }
    return out;
  }

  score(word: string): SpellProfile {
    const w = normalize(word);
    const cached = this.profileCache.get(w);
    if (cached) return cached;
    if (!WORD_SHAPE.test(w)) throw new Error(`unknown word: ${w}`);
    const p = this.header.scoring;
    const { unit, rarity, roots, improvised } = this.resolve(w);

    const raw = this.rawScores(unit);
    const maxRaw = Math.max(...raw);
    const exps = raw.map((r) => Math.exp((r - maxRaw) / p.temperature));
    const sum = exps.reduce((a, b) => a + b, 0);
    const mix = Object.fromEntries(
      CHANNELS.map((c, ci) => [c, exps[ci] / sum]),
    ) as ChannelMix;

    let dominant: Channel = CHANNELS[0];
    for (const c of CHANNELS) if (mix[c] > mix[dominant]) dominant = c;

    const potency = Math.min(1, Math.max(0, maxRaw / 10));
    const power = Math.round(
      (p.powerBase + p.powerRarity * rarity) * (p.potencyFloor + (1 - p.potencyFloor) * potency),
    );
    const purity = mix[dominant];
    const cost = Math.max(1, Math.round(power * (p.costBase + p.costPurity * purity)));

    const profile: SpellProfile = {
      word: w,
      mix,
      dominant,
      rarity,
      power,
      cost,
      improvised,
      roots: roots.length ? roots : undefined,
    };
    this.profileCache.set(w, profile);
    return profile;
  }

  /**
   * Embedding cosine, calibrated for fatigue: raw cosines put synonyms around
   * 0.45-0.6, so (cos - simFloor)/simRange stretches synonyms toward 1 and
   * squashes unrelated words to 0. Works for improvised words too, via the
   * same resolved (real-or-synthesized) vector — a reskin like "killzorp"
   * still reads as similar to "kill" and fatigues against it.
   */
  similarity(a: string, b: string): number {
    const wa = normalize(a);
    const wb = normalize(b);
    if (wa === wb) return 1;
    if (!WORD_SHAPE.test(wa) || !WORD_SHAPE.test(wb)) return 0;
    const cos = cosine(this.resolve(wa).unit, this.resolve(wb).unit);
    const p = this.header.scoring;
    return Math.min(1, Math.max(0, (cos - p.simFloor) / p.simRange));
  }

  /**
   * Calibrated cosine of a word against a shipped anchor centroid, normalized
   * by the anchor's own-member mean so diffuse anchors aren't penalized.
   */
  anchorAffinity(word: string, anchor: string): number {
    const w = normalize(word);
    const c = this.anchors.get(anchor);
    if (!c || !WORD_SHAPE.test(w)) return 0;
    const cos = cosine(this.resolve(w).unit, c);
    const p = this.header.scoring;
    const raw = Math.min(1, Math.max(0, (cos - p.simFloor) / p.simRange));
    const scale = this.header.anchorScales[this.header.anchorNames.indexOf(anchor)] || 1;
    return Math.min(1, raw / scale);
  }
}
