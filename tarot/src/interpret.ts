import type { SpreadResult } from './types';
import { DeterministicRandom, POSITION_MEANINGS, seedFromString } from './engine';
import { computeSynergies } from './synergy';

// The oracle: SmolLM2-360M-Instruct running fully in-browser via
// transformers.js (WebGPU when available, WASM otherwise). Weights are
// fetched once on first use (~250MB, q4) and cached by the browser, so
// later readings work offline. The CDN import stays out of the bundle —
// the game itself remains a tiny static page.
const MODEL_ID = 'HuggingFaceTB/SmolLM2-360M-Instruct';
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6';

export type ProgressFn = (msg: string) => void;
export type TokenFn = (text: string) => void;

// The model runs inside a dedicated Web Worker — loading AND token
// generation happen off the main thread, so the page stays responsive
// during inference (WASM generation on the main thread trips the
// browser's "Page Unresponsive" watchdog). The worker is created from a
// blob so the single-file build needs no separate worker asset; it keeps
// the pipeline in memory between readings.
const WORKER_SRC = `
const post = (m) => self.postMessage(m);
let pipe = null;
let TextStreamerCls = null;
let loadedModel = null;
self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== 'generate') return;
  try {
    if (!pipe || loadedModel !== msg.model) {
      post({ type: 'progress', text: 'summoning the oracle…' });
      const tf = await import(msg.cdn);
      let device = 'wasm';
      try { if (await navigator.gpu?.requestAdapter()) device = 'webgpu'; } catch {}
      const fileProgress = new Map();
      pipe = await tf.pipeline('text-generation', msg.model, {
        dtype: device === 'webgpu' ? 'q4f16' : 'q4',
        device,
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            fileProgress.set(p.file, p.loaded / p.total);
            let sum = 0; fileProgress.forEach((v) => { sum += v; });
            post({ type: 'progress', text: 'downloading the oracle (' + device + ') · ' + Math.round((sum / fileProgress.size) * 100) + '%' });
          }
        },
      });
      TextStreamerCls = tf.TextStreamer;
      loadedModel = msg.model;
    }
    post({ type: 'progress', text: 'the oracle considers…' });
    const streamer = new TextStreamerCls(pipe.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (t) => post({ type: 'token', text: t }),
    });
    await pipe(msg.messages, {
      max_new_tokens: 420,
      do_sample: true,
      temperature: 0.7,
      top_p: 0.9,
      repetition_penalty: 1.15,
      streamer,
    });
    post({ type: 'done' });
  } catch (err) {
    pipe = null;
    post({ type: 'error', message: String((err && err.message) || err) });
  }
};
`;

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    const blob = new Blob([WORKER_SRC], { type: 'text/javascript' });
    worker = new Worker(URL.createObjectURL(blob), { type: 'module' });
  }
  return worker;
}

function spreadLines(spread: SpreadResult): string {
  const positionMeanings = POSITION_MEANINGS[spread.type];
  return spread.cards.map(({ card, position, isReversed }, i) => {
    const meaning = isReversed ? card.meaningReversed : card.meaningUpright;
    return `${i + 1}. ${position} — this position shows ${positionMeanings[i]}.\n` +
      `   Card drawn: ${card.name}${isReversed ? ', reversed' : ''} (${meaning.toLowerCase()}). ${card.description}`;
  }).join('\n');
}

export function buildReadingPrompt(spread: SpreadResult, question: string): string {
  const spreadName = spread.type === 'three-card' ? 'past-present-future' : 'Celtic Cross';
  const notes = computeSynergies(spread);
  const patterns = notes.length
    ? `\n\nPatterns across the whole spread:\n${notes.map((n) => `- ${n}`).join('\n')}`
    : '';
  return `${question.trim() ? `My question: ${question.trim()}\n\n` : ''}` +
    `My ${spreadName} spread:\n${spreadLines(spread)}${patterns}\n\nGive me the reading.`;
}

export function interpretSpread(
  spread: SpreadResult,
  question: string,
  onToken: TokenFn,
  onProgress: ProgressFn,
): Promise<string> {
  const messages = [
    {
      role: 'system',
      content: 'You are a thoughtful tarot reader. Weave the drawn cards into one flowing, grounded reading of 2-3 short paragraphs: plain prose, no lists, no headings. Read each card through the lens of its position — the same card means different things as an obstacle than as an outcome. Honor the listed patterns across the spread; they are the reading\'s undercurrent. Connect the cards to each other and end with practical advice. Tarot is a mirror for reflection, not fortune-telling — never predict specific events.',
    },
    {
      role: 'user',
      content: buildReadingPrompt(spread, question),
    },
  ];
  const w = getWorker();
  // ?model= lets dev/test runs swap in a smaller model
  const model = new URLSearchParams(location.search).get('model') ?? MODEL_ID;
  return new Promise<string>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      switch (e.data?.type) {
        case 'progress': onProgress(e.data.text); break;
        case 'token': onToken(e.data.text); break;
        case 'done': cleanup(); resolve(model.split('/').pop() ?? model); break;
        case 'error': cleanup(); reject(new Error(e.data.message)); break;
      }
    };
    const onErr = (e: ErrorEvent) => { cleanup(); reject(e.error ?? new Error(e.message || 'oracle worker failed')); };
    const cleanup = () => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage({ type: 'generate', cdn: TRANSFORMERS_CDN, model, messages });
  });
}

// Deterministic offline fallback: same spread, same words.
const VERBS = ['speaks of', 'points toward', 'carries', 'asks you to sit with', 'brings'];
const BRIDGES = ['From there,', 'Beneath that,', 'Alongside it,', 'And yet,', 'In answer,'];

export function composeFallback(spread: SpreadResult, question: string): string {
  const rng = new DeterministicRandom(seedFromString(spread.seed + '::oracle'));
  const positionMeanings = POSITION_MEANINGS[spread.type];
  const parts: string[] = [];
  spread.cards.forEach(({ card, position, isReversed }, i) => {
    const meaning = (isReversed ? card.meaningReversed : card.meaningUpright).toLowerCase();
    const lead = i === 0
      ? `In the ${position.toLowerCase()} position — ${positionMeanings[i]} —`
      : `${BRIDGES[rng.nextInt(0, BRIDGES.length - 1)]} in the ${position.toLowerCase()} position (${positionMeanings[i]}),`;
    parts.push(`${lead} ${card.name}${isReversed ? ' reversed' : ''} ${VERBS[rng.nextInt(0, VERBS.length - 1)]} ${meaning}.`);
  });
  const currents = computeSynergies(spread);
  const close = question.trim()
    ? `Hold your question — “${question.trim()}” — against these images and notice which one answers first.`
    : 'Notice which of these images tugs hardest; that is where your attention wants to go.';
  return `${parts.join(' ')}${currents.length ? ` ${currents.join(' ')}` : ''} ${close}`;
}
