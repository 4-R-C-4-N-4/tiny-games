import { CHANNELS, type Channel, type ChannelMix, type Scorer, type SpellProfile } from './types.ts';

// The real scorer: 80k-word lexicon of int8 PCA-reduced GloVe vectors plus a
// tiny distilled MLP head, packed into lexicon.bin by train/export_assets.py.
// Every formula here is pinned to the python exporter via golden fixtures.

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
  sections: Record<string, { offset: number; length: number }>;
}

function geluTanh(x: number): number {
  return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x * x * x)));
}

function normalize(word: string): string {
  return word.trim().toLowerCase();
}

export class ModelScorer implements Scorer {
  private readonly index = new Map<string, number>();
  private readonly cache = new Map<string, SpellProfile>();

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
    return this.index.has(normalize(word));
  }

  private vector(i: number): Int8Array {
    const { dims } = this.header;
    return this.vecs.subarray(i * dims, (i + 1) * dims);
  }

  /** Raw 0-10 channel scores from the distilled head. */
  private rawScores(i: number): number[] {
    const { dims, hidden } = this.header;
    const v = this.vector(i);
    const h = new Float32Array(hidden);
    for (let j = 0; j < hidden; j++) {
      let acc = this.b1[j];
      const row = j * dims;
      for (let k = 0; k < dims; k++) acc += (this.w1[row + k] * v[k]) / 127;
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
    const cached = this.cache.get(w);
    if (cached) return cached;
    const i = this.index.get(w);
    if (i === undefined) throw new Error(`unknown word: ${w}`);
    const p = this.header.scoring;

    const raw = this.rawScores(i);
    const maxRaw = Math.max(...raw);
    const exps = raw.map((r) => Math.exp((r - maxRaw) / p.temperature));
    const sum = exps.reduce((a, b) => a + b, 0);
    const mix = Object.fromEntries(
      CHANNELS.map((c, ci) => [c, exps[ci] / sum]),
    ) as ChannelMix;

    let dominant: Channel = CHANNELS[0];
    for (const c of CHANNELS) if (mix[c] > mix[dominant]) dominant = c;

    const z = this.zipf[i] / p.zipfScale;
    const rarity = Math.min(1, Math.max(0, (p.zipfZero - z) / p.zipfRange));
    const potency = Math.min(1, Math.max(0, maxRaw / 10));
    const power = Math.round(
      (p.powerBase + p.powerRarity * rarity) * (p.potencyFloor + (1 - p.potencyFloor) * potency),
    );
    const purity = mix[dominant];
    const cost = Math.max(1, Math.round(power * (p.costBase + p.costPurity * purity)));

    const profile: SpellProfile = { word: w, mix, dominant, rarity, power, cost };
    this.cache.set(w, profile);
    return profile;
  }

  /**
   * Embedding cosine, calibrated for fatigue: raw cosines put synonyms around
   * 0.45-0.6, so (cos - simFloor)/simRange stretches synonyms toward 1 and
   * squashes unrelated words to 0.
   */
  similarity(a: string, b: string): number {
    const ia = this.index.get(normalize(a));
    const ib = this.index.get(normalize(b));
    if (ia === undefined || ib === undefined) return 0;
    if (ia === ib) return 1;
    const va = this.vector(ia);
    const vb = this.vector(ib);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let k = 0; k < va.length; k++) {
      dot += va[k] * vb[k];
      na += va[k] * va[k];
      nb += vb[k] * vb[k];
    }
    const cos = dot / Math.sqrt(na * nb);
    const p = this.header.scoring;
    return Math.min(1, Math.max(0, (cos - p.simFloor) / p.simRange));
  }
}
