import './style.css';
import { seedFromString, getSpread, POSITION_MEANINGS } from './engine';
import { FULL_DECK } from './data';
import type { SpreadResult, SpreadType } from './types';
import { cardArt } from './art';
import { cardScan } from './scans';
import { composeFallback, interpretSpread } from './interpret';
import { computeSynergies } from './synergy';
import { loadSettings, saveSettings } from './settings';

const app = document.getElementById('app') as HTMLElement;
const settings = loadSettings();

function mountSettingsPane() {
  const gear = document.createElement('button');
  gear.className = 'fixed top-4 right-4 z-30 w-10 h-10 rounded-full bg-slate-900/90 border border-slate-700 hover:border-indigo-500 text-slate-400 hover:text-slate-200 transition-colors text-lg';
  gear.textContent = '⚙';
  gear.title = 'Settings';
  gear.setAttribute('aria-label', 'Settings');

  const pane = document.createElement('div');
  pane.className = 'fixed top-16 right-4 z-30 w-72 bg-slate-900 border border-slate-700 rounded-xl p-5 shadow-2xl hidden';
  pane.innerHTML = `
    <p class="text-xs text-slate-500 uppercase tracking-widest mb-4">Settings</p>
    <label class="flex items-start gap-3 cursor-pointer select-none">
      <input id="reversals-toggle" type="checkbox" class="mt-1 accent-indigo-500" ${settings.reversals ? 'checked' : ''} />
      <span>
        <span class="block text-sm text-slate-200">Reversed cards</span>
        <span class="block text-xs text-slate-500 mt-1">Cards may land upside down, taking their inverted meaning. Off by default.</span>
      </span>
    </label>
    <p id="settings-hint" class="text-[10px] text-indigo-400 mt-3 hidden">Applies to your next reading.</p>`;

  gear.addEventListener('click', () => pane.classList.toggle('hidden'));
  pane.querySelector<HTMLInputElement>('#reversals-toggle')!.addEventListener('change', (e) => {
    settings.reversals = (e.target as HTMLInputElement).checked;
    saveSettings(settings);
    pane.querySelector('#settings-hint')!.classList.remove('hidden');
  });
  document.body.append(gear, pane);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

interface CardOpts {
  compact?: boolean; // small table-layout card (Celtic Cross): meaning lives in the tooltip
  faceUp?: boolean;  // deal it revealed (staggered auto-flip)
}

function createCardElement(item: SpreadResult['cards'][number], index: number, positionMeaning: string, opts: CardOpts = {}): HTMLElement {
  const meaning = item.isReversed ? item.card.meaningReversed : item.card.meaningUpright;
  const scan = cardScan(item.card);
  const imgClasses = scan ? 'object-contain' : 'object-cover pixelated';

  const cardEl = document.createElement('div');
  cardEl.className = opts.compact
    ? 'perspective w-24 h-44 md:w-32 md:h-56 deal-in'
    : 'perspective w-full h-80 deal-in';

  const inner = document.createElement('div');
  inner.className = 'flip-inner relative w-full h-full cursor-pointer';

  const front = document.createElement('div');
  front.title = positionMeaning;
  const back = document.createElement('div');

  if (opts.compact) {
    front.className = 'flip-face bg-slate-900 border-2 border-indigo-500/40 rounded-lg p-2 flex flex-col items-center justify-center gap-2 shadow-xl';
    front.innerHTML = `
      <div class="text-[8px] text-indigo-400 font-bold uppercase tracking-wider text-center">${item.position}</div>
      <div class="text-3xl select-none">✦</div>`;
    back.className = 'flip-face flip-face--back bg-slate-900 border-2 border-indigo-500 rounded-lg p-2 flex flex-col items-center shadow-xl overflow-hidden';
    back.title = `${item.position} — ${positionMeaning}. ${meaning}`;
    back.innerHTML = `
      <div class="text-[8px] text-indigo-400 uppercase font-bold tracking-wider text-center">${item.position}</div>
      <img src="${scan ?? cardArt(item.card)}" alt="${item.card.name}" class="w-full h-24 md:h-36 my-1 ${imgClasses} ${item.isReversed ? 'rotate-180' : ''}" />
      <h3 class="text-[10px] font-serif text-white leading-tight text-center">${item.card.name}</h3>
      <p class="text-[8px] uppercase tracking-wider ${item.isReversed ? 'text-rose-400' : 'text-indigo-300'}">${item.isReversed ? 'reversed' : 'upright'}</p>`;
  } else {
    front.className = 'flip-face bg-slate-900 border-2 border-indigo-500/40 rounded-xl p-4 flex flex-col items-center justify-center gap-3 shadow-2xl';
    front.innerHTML = `
      <div class="text-xs text-indigo-400 font-bold uppercase tracking-widest">${item.position}</div>
      <div class="text-5xl select-none">✦</div>
      <p class="text-xs text-slate-500">tap to reveal</p>`;
    back.className = 'flip-face flip-face--back bg-slate-900 border-2 border-indigo-500 rounded-xl p-3 flex flex-col shadow-2xl overflow-hidden';
    back.innerHTML = `
      <div class="text-[10px] text-indigo-400 uppercase font-bold tracking-widest" title="${positionMeaning}">${item.position}</div>
      <img src="${scan ?? cardArt(item.card)}" alt="${item.card.name}" class="w-full h-40 rounded-md my-2 ${imgClasses} ${item.isReversed ? 'rotate-180' : ''}" />
      <h3 class="text-base font-serif text-white leading-tight">${item.card.name}</h3>
      <p class="text-[10px] uppercase tracking-widest mt-0.5 ${item.isReversed ? 'text-rose-400' : 'text-indigo-300'}">${item.isReversed ? 'reversed' : 'upright'}</p>
      <p class="text-xs text-slate-300 leading-relaxed mt-1">${meaning}</p>`;
  }

  inner.appendChild(front);
  inner.appendChild(back);
  cardEl.appendChild(inner);
  inner.addEventListener('click', () => inner.classList.add('flipped'));

  setTimeout(() => cardEl.classList.add('dealt'), 60 + index * 90);
  if (opts.faceUp) setTimeout(() => inner.classList.add('flipped'), 400 + index * 140);
  return cardEl;
}

function revealAll() {
  app.querySelectorAll('.flip-inner').forEach((el) => el.classList.add('flipped'));
}

async function runInterpretation(spread: SpreadResult, question: string, panel: HTMLElement) {
  const status = panel.querySelector('.oracle-status') as HTMLElement;
  const out = panel.querySelector('.oracle-out') as HTMLElement;
  out.textContent = '';
  try {
    const model = await interpretSpread(
      spread, question,
      (t) => { out.textContent += t; },
      (m) => { status.textContent = m; },
    );
    status.textContent = `read by ${model}, entirely in your browser`;
  } catch (err) {
    console.warn('oracle failed, falling back', err);
    status.textContent = 'the oracle could not be reached (offline?) — a plainer reading:';
    out.textContent = composeFallback(spread, question);
  }
}

function renderSpread(type: SpreadType, question: string, allowReversals = settings.reversals) {
  const seed = seedFromString(`${todayKey()}::${type}::${question.trim().toLowerCase()}`);
  const spread = getSpread(FULL_DECK, type, seed, allowReversals);

  app.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'text-center mb-10 px-4';
  header.innerHTML = `
    <h1 class="text-4xl md:text-5xl font-serif text-white mb-2">Your Reading</h1>
    <p class="text-indigo-400 tracking-widest uppercase text-xs">${todayKey()}${question.trim() ? ` · “${question.trim()}”` : ''}</p>`;
  app.appendChild(header);

  const positionMeanings = POSITION_MEANINGS[type];
  const card = (i: number, opts: CardOpts = {}) =>
    createCardElement(spread.cards[i], i, positionMeanings[i], opts);

  if (type === 'celtic-cross') {
    // Traditional table layout: the cross of five (Crown above, Past left,
    // Situation center, Near Future right, Foundation below) with the
    // Challenge card laid sideways in its own row between the Situation
    // and the Foundation — all dealt face-up — and the staff of four to
    // the right, face down, read bottom to top.
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-wrap justify-center items-center gap-10 md:gap-16 w-full px-4';

    const cross = document.createElement('div');
    cross.className = 'grid grid-cols-3 gap-3 place-items-center';
    const cell = (i: number, cls: string) => {
      const holder = document.createElement('div');
      holder.className = cls;
      holder.appendChild(card(i, { compact: true, faceUp: true }));
      return holder;
    };
    cross.appendChild(cell(2, 'col-start-2 row-start-1'));  // Crown
    cross.appendChild(cell(3, 'col-start-1 row-start-2'));  // Past
    cross.appendChild(cell(0, 'col-start-2 row-start-2'));  // Situation
    cross.appendChild(cell(5, 'col-start-3 row-start-2'));  // Near Future

    // Challenge, sideways: the holder's height equals the rotated card's
    // visual height (= card width), so the row hugs it snugly.
    const crossing = document.createElement('div');
    crossing.className = 'col-start-2 row-start-3 h-24 md:h-32 flex items-center justify-center rotate-90';
    crossing.appendChild(card(1, { compact: true, faceUp: true }));
    cross.appendChild(crossing);

    cross.appendChild(cell(4, 'col-start-2 row-start-4'));  // Foundation
    wrap.appendChild(cross);

    const staff = document.createElement('div');
    staff.className = 'flex flex-wrap justify-center md:flex-col gap-3';
    for (const i of [9, 8, 7, 6]) staff.appendChild(card(i, { compact: true }));  // Outcome at top … Self at bottom
    wrap.appendChild(staff);
    app.appendChild(wrap);
  } else {
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-4xl px-4';
    spread.cards.forEach((_, i) => grid.appendChild(card(i)));
    app.appendChild(grid);
  }

  const currents = computeSynergies(spread);
  const panel = document.createElement('div');
  panel.className = 'w-full max-w-2xl px-4 mt-10 hidden';
  panel.innerHTML = `
    <div class="bg-slate-900/80 border border-indigo-500/30 rounded-xl p-6">
      ${currents.length ? `
      <div class="mb-4">
        <p class="text-[10px] text-slate-500 uppercase tracking-widest mb-2">currents in this spread</p>
        ${currents.map((n) => `<p class="text-xs text-indigo-300/90 leading-relaxed mb-1">◈ ${n}</p>`).join('')}
      </div>` : ''}
      <p class="oracle-status text-xs text-indigo-400 uppercase tracking-widest mb-3">…</p>
      <p class="oracle-out font-serif text-slate-200 leading-relaxed whitespace-pre-wrap"></p>
    </div>`;
  app.appendChild(panel);

  const controls = document.createElement('div');
  controls.className = 'mt-10 pb-12 flex flex-wrap gap-4 justify-center px-4';
  controls.innerHTML = `
    <button id="reveal-btn" class="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-full transition-all border border-slate-600">${type === 'celtic-cross' ? 'Reveal the Staff' : 'Reveal All'}</button>
    <button id="oracle-btn" class="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-full transition-all font-medium shadow-lg">✨ Interpret Spread</button>
    <button id="reset-btn" class="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-full transition-all border border-slate-600">New Reading</button>`;
  app.appendChild(controls);

  document.getElementById('reveal-btn')?.addEventListener('click', revealAll);
  document.getElementById('reset-btn')?.addEventListener('click', initApp);
  const oracleBtn = document.getElementById('oracle-btn') as HTMLButtonElement;
  oracleBtn.addEventListener('click', () => {
    revealAll();
    oracleBtn.disabled = true;
    oracleBtn.classList.add('opacity-50', 'cursor-not-allowed');
    panel.classList.remove('hidden');
    runInterpretation(spread, question, panel).finally(() => {
      oracleBtn.disabled = false;
      oracleBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    });
  });
}

function initApp() {
  app.innerHTML = `
    <div class="text-center max-w-md mx-auto px-4 w-full">
      <h1 class="text-5xl font-serif text-white mb-3">Tarot</h1>
      <p class="text-slate-400 text-sm mb-8">The deck is bound to the day — same question, same cards.</p>
      <input id="question" type="text" maxlength="120" placeholder="Ask a question (optional)…"
        class="w-full px-5 py-3 mb-6 bg-slate-900 border border-slate-700 focus:border-indigo-500 rounded-full text-center text-slate-100 placeholder-slate-500 outline-none transition-colors" />
      <div class="flex flex-col gap-4 items-center">
        <button id="three-btn" class="w-64 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-full transition-all font-medium shadow-lg">3-Card Spread</button>
        <button id="cross-btn" class="w-64 px-6 py-3 bg-slate-800 hover:bg-slate-700 rounded-full transition-all font-medium border border-slate-600">Celtic Cross</button>
      </div>
      <p class="text-slate-600 text-[10px] mt-10">Card art: Pamela Colman Smith, 1909 Waite–Smith deck (public domain)</p>
    </div>`;
  const question = () => (document.getElementById('question') as HTMLInputElement).value;
  document.getElementById('three-btn')?.addEventListener('click', () => renderSpread('three-card', question()));
  document.getElementById('cross-btn')?.addEventListener('click', () => renderSpread('celtic-cross', question()));
}

// Deep link: ?spread=three-card|celtic-cross&q=your+question&rev=1|0&reveal=1&interpret=1
mountSettingsPane();
const params = new URLSearchParams(location.search);
const spreadParam = params.get('spread');
if (spreadParam === 'three-card' || spreadParam === 'celtic-cross') {
  const revParam = params.get('rev');
  renderSpread(spreadParam, params.get('q') ?? '', revParam !== null ? revParam === '1' : settings.reversals);
  if (params.get('reveal')) revealAll();
  if (params.get('interpret')) document.getElementById('oracle-btn')?.click();
} else {
  initApp();
}
