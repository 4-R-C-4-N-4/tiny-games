import { Duel, type Combatant, type DuelEvent, type CastPreview, type OpponentDef } from '../src/duel.ts';
import { THEME_HUES } from '../src/floors.ts';
import { ModelScorer } from '../src/model-scorer.ts';
import { SpireRun } from '../src/run.ts';
import { STAT_HUES, enemyPalette, playerPalette, type SpriteArt } from '../src/sprites.ts';
import { dominantStat } from '../src/stats.ts';
import { StubScorer } from '../src/stub-scorer.ts';
import { CHANNELS, type Channel, type Scorer } from '../src/types.ts';
import { renderGallery } from './gallery.ts';
import { spriteAnim } from './sprite-render.ts';

// Thin shell over SpireRun: the run machine is headless; this file only
// renders phases and forwards input.

const ENEMY_TURN_DELAY_MS = 750;

let scorer: Scorer = new StubScorer();
let run: SpireRun;
let enemyThinking = false;
/** Throwaway duel for threshold practice previews under the coming floor's law. */
let practiceDuel: Duel | null = null;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const input = $<HTMLInputElement>('word-input');
const castBtn = $<HTMLButtonElement>('cast-btn');
const form = $<HTMLFormElement>('cast-form');
const log = $('cast-log');
const overlay = $('overlay');
const rite = $('rite');
const threshold = $('threshold');
const bars = Object.fromEntries(CHANNELS.map((c) => [c, $(`bar-${c}`)]));

// ---------- shared rendering ----------

function rarityLabel(r: number): string {
  if (r < 0.2) return 'common';
  if (r < 0.45) return 'uncommon';
  if (r < 0.7) return 'rare';
  return 'arcane';
}

function activeDuelForPreview(): Duel | null {
  if (run.phase === 'duel' && run.duel) return run.duel;
  if (run.phase === 'threshold') {
    practiceDuel ??= new Duel(scorer, run.currentBoss(), 1, {
      stats: run.stats,
      floor: run.currentFloor(),
      playerMaxHp: run.playerMaxHp,
      playerMaxMana: run.playerMaxMana,
    });
    return practiceDuel;
  }
  return null;
}

function renderPreview(): void {
  const duel = activeDuelForPreview();
  const p: CastPreview | null =
    duel && !enemyThinking ? duel.preview(input.value) : null;
  for (const c of CHANNELS) {
    bars[c].style.width = p ? `${Math.round(p.profile.mix[c] * 100)}%` : '0%';
  }
  const warn = $('preview-warn');
  $('preview-rarity').textContent = p
    ? `${rarityLabel(p.profile.rarity)} · power ${p.profile.power}` +
      (p.effectivePower !== p.profile.power ? ` → ${p.effectivePower}` : '')
    : '—';
  const manaPool = duel?.player.mana ?? 0;
  const shortfall = p && !p.affordable ? p.cost - manaPool : 0;
  const costEl = $('preview-cost');
  costEl.textContent = p ? `cost ${p.cost} ✦` : '—';
  costEl.classList.toggle('cost-short', shortfall > 0);
  $('player').classList.toggle('mana-short', shortfall > 0);
  $('preview').classList.toggle('tabooed', !!p?.floor.tabooed);
  if (p?.floor.tabooed) {
    warn.textContent = '⚠ forbidden here — this word will turn on you';
    warn.className = 'taboo';
  } else if (shortfall > 0) {
    warn.textContent = `✦ not enough mana — need ${shortfall} more`;
    warn.className = 'short';
  } else if (p && p.floor.amp > 1.1) {
    warn.textContent = `✦ the floor favors this word — ×${p.floor.amp.toFixed(2)}`;
    warn.className = 'amped';
  } else {
    warn.textContent = '';
    warn.className = '';
  }
  const inDuel = run.phase === 'duel';
  castBtn.disabled = !inDuel || !p || !p.affordable || enemyThinking;
  castBtn.textContent = shortfall > 0 ? `Need ${shortfall} ✦` : 'Cast';
  castBtn.classList.toggle('short', shortfall > 0);
}

function statusLine(c: Combatant): string {
  const parts: string[] = [];
  if (c.ward > 0) parts.push(`🛡 ${c.ward}`);
  if (c.hex) parts.push(`☠ ${c.hex.potency} (${c.hex.turns}t)`);
  return parts.join('  ');
}

function currentThemeHue(): number {
  const floor = run.currentFloorSafe();
  return floor ? THEME_HUES[floor.theme] : 260;
}

function setSprite(holder: HTMLElement, art: SpriteArt | null): void {
  if (!art) {
    holder.replaceChildren();
    return;
  }
  // The Mirror is your reflection — it wears YOUR dominant-stat color.
  const hue = art === 'mirror' ? STAT_HUES[dominantStat(run.stats)] : currentThemeHue();
  const el =
    art === 'player'
      ? spriteAnim('player', playerPalette(dominantStat(run.stats)), playerPalette(dominantStat(run.stats), 1))
      : spriteAnim(art, enemyPalette(art, hue), enemyPalette(art, hue, 1));
  if (holder.firstChild !== el) holder.replaceChildren(el);
}

function renderCombatants(): void {
  const duel = run.duel;
  const boss: OpponentDef | null = run.phase === 'duel' && duel ? duel.opponent : run.currentBossSafe();
  $('enemy-name').textContent = boss?.name ?? '…';
  setSprite($('enemy-sprite'), boss?.art ?? null);
  setSprite($('player-sprite'), 'player');
  const enemy = duel?.enemy;
  $('enemy-hp').style.width = enemy ? `${(100 * enemy.hp) / enemy.maxHp}%` : '100%';
  $('enemy-status').textContent = enemy ? statusLine(enemy) : '';
  const player = duel?.player;
  $('player-hp').style.width = player
    ? `${(100 * player.hp) / player.maxHp}%`
    : `${(100 * run.playerHp) / run.playerMaxHp}%`;
  $('player-mana').style.width = player
    ? `${(100 * player.mana) / player.maxMana}%`
    : '100%';
  $('player-status').textContent = player ? statusLine(player) : '';
  $('player-name').textContent = run.trueName ?? 'The Unnamed';
}

function renderFloorBanner(): void {
  if (run.phase === 'rite') {
    $('floor-name').textContent = 'The Spire';
    $('floor-rule').textContent = `${wordCountLabel()} — name yourself`;
    document.getElementById('stage')!.classList.remove('themed');
    return;
  }
  const floor = run.currentFloorSafe();
  if (!floor) return;
  $('floor-name').textContent = `${floor.index}/8 · ${floor.name}`;
  $('floor-rule').textContent = floor.ruleText;
  const stage = document.getElementById('stage')!;
  stage.classList.add('themed');
  stage.style.setProperty('--floor-hue', String(THEME_HUES[floor.theme]));
}

function wordCountLabel(): string {
  return scorer instanceof ModelScorer
    ? `${(scorer.wordCount / 1000).toFixed(0)}k words known`
    : 'stub lexicon';
}

function pushLog(line: string): void {
  log.querySelector('.latest')?.classList.remove('latest');
  const el = document.createElement('div');
  el.className = 'latest';
  el.textContent = line;
  log.prepend(el);
  while (log.children.length > 2) log.lastChild?.remove();
}

function describe(e: DuelEvent): string {
  switch (e.kind) {
    case 'cast': {
      const who = e.actor === 'player' ? 'You cast' : `${e.actor} casts`;
      const parts = [`${who} “${e.word}”`];
      if (e.tabooed) parts.push('— FORBIDDEN — it turns on its speaker');
      if (e.effectiveness < 0.5) parts.push('(fizzles)');
      if (e.damage > 0) parts.push(`${e.damage} dmg`);
      if (e.absorbed > 0) parts.push(`${e.absorbed} warded`);
      if (e.hexApplied > 0) parts.push(`hex +${e.hexApplied}`);
      if (e.healed > 0) parts.push(`${e.healed} healed`);
      if (e.wardGained > 0) parts.push(`🛡 +${e.wardGained}`);
      return parts.join(' · ');
    }
    case 'drain':
      return `${e.actor === 'player' ? 'You suffer' : `${e.actor} suffers`} ${e.drain} hex drain`;
    case 'echo':
      return `${e.actor === 'player' ? 'Your' : 'Its'} own word echoes back — ${e.damage} dmg`;
    case 'falter':
      return `${e.actor} falters, gathering mana…`;
    case 'truename':
      return `${e.actor} speaks your True Name — ${run.trueName ?? 'it knows you'} — its casts sharpen!`;
    case 'defeat':
      return e.loser === 'player' ? 'You fall.' : `${e.loser} is undone.`;
  }
}

// ---------- phase rendering ----------

// ---------- grimoire ----------

function renderGrimoire(): void {
  const list = $('grimoire-list');
  list.replaceChildren();
  const counts = new Map<string, number>();
  for (const w of run.history) counts.set(w, (counts.get(w) ?? 0) + 1);
  const entries = [...counts.entries()]
    .filter(([w]) => scorer.knows(w))
    .map(([w, n]) => ({ profile: scorer.score(w), n }))
    .sort((a, b) => b.profile.rarity - a.profile.rarity);
  for (const { profile, n } of entries) {
    const row = document.createElement('div');
    row.className = 'grimoire-row';
    const word = document.createElement('span');
    word.className = 'g-word';
    word.textContent = profile.word;
    row.appendChild(word);
    const bars = document.createElement('span');
    bars.className = 'g-bars';
    for (const c of CHANNELS) {
      const bar = document.createElement('i');
      bar.style.height = `${Math.max(2, Math.round(profile.mix[c] * 14))}px`;
      bar.style.background = CHANNEL_COLORS[c];
      bars.appendChild(bar);
    }
    row.appendChild(bars);
    const meta = document.createElement('span');
    meta.className = 'g-meta';
    meta.textContent = `${rarityLabel(profile.rarity)} · pw ${profile.power} · ✦${profile.cost}${n > 1 ? ` · ×${n}` : ''}`;
    row.appendChild(meta);
    list.appendChild(row);
  }
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'rite-sub';
    empty.textContent = 'No words yet. Speak.';
    list.appendChild(empty);
  }
}

$('grimoire-btn').addEventListener('click', () => {
  renderGrimoire();
  $('grimoire').hidden = false;
});

$('grimoire-close').addEventListener('click', () => {
  $('grimoire').hidden = true;
});

function render(): void {
  rite.hidden = run.phase !== 'rite';
  threshold.hidden = run.phase !== 'threshold';
  $('grimoire').hidden = true;
  const gbtn = $('grimoire-btn');
  gbtn.hidden = run.phase === 'rite';
  gbtn.textContent = `📖 ${new Set(run.history).size}`;
  overlay.hidden = !(run.phase === 'fallen' || run.phase === 'ascended');
  if (run.phase === 'threshold') renderThreshold();
  if (run.phase === 'fallen') {
    $('overlay-text').textContent =
      `Your words fail you on floor ${run.currentFloorSafe()?.index ?? '?'}. The spire keeps your name.`;
    $('overlay-btn').textContent = 'Climb again';
  }
  if (run.phase === 'ascended') {
    $('overlay-text').textContent =
      'The Mirror shatters. At the top of the spire there is only yourself — and you have out-worded them.';
    $('overlay-btn').textContent = 'Descend and climb anew';
  }
  renderFloorBanner();
  renderCombatants();
  renderPreview();
}

function renderThreshold(): void {
  const floor = run.currentFloor();
  $('th-name').textContent = `Floor ${floor.index} of 8 — ${floor.name}`;
  $('th-inscription').textContent = floor.inscription;
  $('th-rule').textContent = floor.ruleText;
  const report = $('study-report');
  report.hidden = !run.studyReport;
  if (run.studyReport) {
    report.textContent = `${run.studyReport.bossName}. ${run.studyReport.wordHint} ${run.studyReport.policyHint}`;
  }
  $<HTMLButtonElement>('pact-btn').classList.toggle('used', run.pactArmed);
  $<HTMLButtonElement>('study-btn').classList.toggle('used', !!run.studyReport);
}

// ---------- rite ----------

const picked = new Set<string>();

function renderRiteChoices(): void {
  const box = $('rite-choices');
  box.replaceChildren();
  for (const adj of run.offer()) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'adj-chip' + (picked.has(adj) ? ' picked' : '');
    chip.textContent = adj;
    chip.addEventListener('click', () => {
      if (picked.has(adj)) picked.delete(adj);
      else if (picked.size < 5) picked.add(adj);
      renderRiteChoices();
    });
    box.appendChild(chip);
  }
  $('rite-count').textContent = `${picked.size} / 5 chosen`;
  $<HTMLButtonElement>('begin-run').disabled = picked.size !== 5;
}

$('begin-run').addEventListener('click', () => {
  const flaw = $<HTMLInputElement>('flaw-input').value.trim();
  run.completeRite([...picked], flaw && scorer.knows(flaw) ? flaw : undefined);
  practiceDuel = null;
  render();
});

// ---------- threshold ----------

$('pact-btn').addEventListener('click', () => {
  run.takePact();
  render();
});

$('study-btn').addEventListener('click', () => {
  run.takeStudy();
  render();
});

$('enter-btn').addEventListener('click', () => {
  run.enterFloor();
  practiceDuel = null;
  log.replaceChildren();
  pushLog(`${run.duel!.opponent.name} awaits.`);
  render();
  input.focus();
});

// ---------- duel ----------

// ---------- VFX ----------

const CHANNEL_COLORS: Record<Channel, string> = {
  damage: '#e5484d',
  hex: '#9d5ce5',
  ward: '#4d9de5',
  heal: '#4dc47f',
};

function combatantEl(actor: string): HTMLElement {
  return actor === 'player' ? $('player') : $('enemy');
}

function otherEl(actor: string): HTMLElement {
  return actor === 'player' ? $('enemy') : $('player');
}

function vfxBurst(target: HTMLElement, color: string): void {
  const b = document.createElement('div');
  b.className = 'vfx-burst';
  b.style.setProperty('--vfx-color', color);
  target.appendChild(b);
  b.addEventListener('animationend', () => b.remove());
}

/** Spawn a batch of VFX pixels with staggered delays; self-cleaning. */
function vfxSpawn(target: HTMLElement, className: string, count: number, ttlMs: number): void {
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = className;
    el.style.left = `${25 + Math.random() * 50}%`;
    el.style.animationDelay = `${i * 90}ms`;
    target.appendChild(el);
    setTimeout(() => el.remove(), ttlMs + i * 90);
  }
}

function vfxStreak(target: HTMLElement, fromLeft: boolean): void {
  const s = document.createElement('div');
  s.className = 'vfx-streak' + (fromLeft ? ' from-left' : ' from-right');
  target.appendChild(s);
  s.addEventListener('animationend', () => s.remove());
}

function vfxRing(target: HTMLElement): void {
  const r = document.createElement('div');
  r.className = 'vfx-ring';
  target.appendChild(r);
  r.addEventListener('animationend', () => r.remove());
}

function vfxLunge(actor: string): void {
  const sprite = $(actor === 'player' ? 'player-sprite' : 'enemy-sprite');
  const cls = actor === 'player' ? 'lunge-up' : 'lunge-down';
  sprite.classList.remove('lunge-up', 'lunge-down');
  void sprite.offsetWidth;
  sprite.classList.add(cls);
}

function vfxTabooFlash(): void {
  const battle = $('battle');
  battle.classList.remove('taboo-flash');
  void battle.offsetWidth;
  battle.classList.add('taboo-flash');
}

function vfxFloat(target: HTMLElement, text: string, color: string): void {
  const f = document.createElement('div');
  f.className = 'vfx-float';
  f.style.color = color;
  f.textContent = text;
  target.appendChild(f);
  f.addEventListener('animationend', () => f.remove());
}

function vfxShake(target: HTMLElement): void {
  target.classList.remove('shaking');
  void target.offsetWidth; // restart the animation
  target.classList.add('shaking');
}

function playCastVfx(e: DuelEvent): void {
  if (e.kind === 'drain') {
    vfxFloat(combatantEl(e.actor), `−${e.drain} ☠`, CHANNEL_COLORS.hex);
    return;
  }
  if (e.kind === 'echo') {
    vfxFloat(combatantEl(e.actor), `−${e.damage} ⟲`, CHANNEL_COLORS.damage);
    vfxShake(combatantEl(e.actor));
    return;
  }
  if (e.kind === 'truename') {
    vfxBurst(combatantEl('player'), CHANNEL_COLORS.hex);
    vfxShake(combatantEl('player'));
    return;
  }
  if (e.kind !== 'cast') return;
  const caster = combatantEl(e.actor);
  const target = e.tabooed ? caster : otherEl(e.actor);
  vfxLunge(e.actor);
  if (e.tabooed) {
    vfxTabooFlash();
    vfxBurst(caster, CHANNEL_COLORS.damage);
  }
  // Channel-coded shapes: the VFX literally displays the score vector.
  if (e.damage > 0 || e.absorbed > 0) {
    vfxStreak(target, e.actor !== 'player');
    if (e.damage > 0) {
      vfxFloat(target, `−${e.damage}`, CHANNEL_COLORS.damage);
      vfxShake(target);
    }
  }
  if (e.hexApplied > 0) {
    vfxSpawn(target, 'vfx-tendril', 3, 900);
    vfxFloat(target, `☠ +${e.hexApplied}`, CHANNEL_COLORS.hex);
  }
  if (e.wardGained > 0) {
    vfxRing(caster);
    vfxFloat(caster, `🛡 +${e.wardGained}`, CHANNEL_COLORS.ward);
  }
  if (e.healed > 0) {
    vfxSpawn(caster, 'vfx-mote', 4, 1000);
    vfxFloat(caster, `+${e.healed}`, CHANNEL_COLORS.heal);
  }
}

function showEvents(events: DuelEvent[]): void {
  for (const e of events) {
    pushLog(describe(e));
    playCastVfx(e);
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (enemyThinking || run.phase !== 'duel') return;
  const clearedBefore = run.floorIndex;
  const events = run.castPlayer(input.value);
  if (!events) return;
  input.value = '';
  showEvents(events);
  if (run.floorIndex !== clearedBefore || run.phase !== 'duel') {
    render();
    return;
  }
  enemyThinking = true;
  render();
  setTimeout(() => {
    showEvents(run.enemyTurn());
    enemyThinking = false;
    render();
    if (run.phase === 'duel') input.focus();
  }, ENEMY_TURN_DELAY_MS);
});

input.addEventListener('input', renderPreview);

$('overlay-btn').addEventListener('click', () => {
  startRun();
});

// ---------- boot ----------

function startRun(): void {
  run = new SpireRun(scorer, (Math.random() * 2 ** 31) | 0);
  picked.clear();
  practiceDuel = null;
  enemyThinking = false;
  log.replaceChildren();
  input.value = '';
  renderRiteChoices();
  render();
}

async function boot(): Promise<void> {
  if (new URLSearchParams(location.search).has('gallery')) {
    renderGallery();
    return;
  }
  $('floor-rule').textContent = 'the lexicon awakens…';
  try {
    const embedded = (globalThis as { LEXICON_B64?: string }).LEXICON_B64;
    if (embedded) {
      // Single-file build: the lexicon rides inside the page as base64.
      const raw = atob(embedded);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      scorer = ModelScorer.fromBuffer(bytes.buffer);
    } else {
      scorer = await ModelScorer.fromUrl('./lexicon.bin');
    }
  } catch (err) {
    console.warn('lexicon unavailable, staying on stub scorer', err);
  }
  startRun();
}

void boot();
