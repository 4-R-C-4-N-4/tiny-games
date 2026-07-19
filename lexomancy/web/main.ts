import { Duel, type Combatant, type DuelEvent, type CastPreview } from '../src/duel.ts';
import { THEME_HUES } from '../src/floors.ts';
import { ModelScorer } from '../src/model-scorer.ts';
import { SpireRun } from '../src/run.ts';
import { dominantStat, type StatName } from '../src/stats.ts';
import { StubScorer } from '../src/stub-scorer.ts';
import { CHANNELS, type Scorer } from '../src/types.ts';

// Thin shell over SpireRun: the run machine is headless; this file only
// renders phases and forwards input.

const ENEMY_TURN_DELAY_MS = 750;

let scorer: Scorer = new StubScorer();
let run: SpireRun;
let enemyThinking = false;
/** Throwaway duel for threshold practice previews under the coming floor's law. */
let practiceDuel: Duel | null = null;

const EPITHETS: Record<StatName, string> = {
  ferocity: 'The Fierce',
  guile: 'The Veiled',
  stone: 'The Unmoved',
  grace: 'The Gentle',
  resonance: 'The Learned',
};

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
  $('preview-cost').textContent = p ? `cost ${p.cost} ✦` : '—';
  $('preview').classList.toggle('tabooed', !!p?.floor.tabooed);
  if (p?.floor.tabooed) {
    warn.textContent = '⚠ forbidden here — this word will turn on you';
    warn.className = 'taboo';
  } else if (p && p.floor.amp > 1.1) {
    warn.textContent = `✦ the floor favors this word — ×${p.floor.amp.toFixed(2)}`;
    warn.className = 'amped';
  } else {
    warn.textContent = '';
    warn.className = '';
  }
  const inDuel = run.phase === 'duel';
  castBtn.disabled = !inDuel || !p || !p.affordable || enemyThinking;
}

function statusLine(c: Combatant): string {
  const parts: string[] = [];
  if (c.ward > 0) parts.push(`🛡 ${c.ward}`);
  if (c.hex) parts.push(`☠ ${c.hex.potency} (${c.hex.turns}t)`);
  return parts.join('  ');
}

function renderCombatants(): void {
  const duel = run.duel;
  const boss = run.phase === 'duel' && duel ? duel.opponent : run.currentBossSafe();
  $('enemy-name').textContent = boss?.name ?? '…';
  $('enemy-sprite').textContent = boss?.sprite ?? '';
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
  $('player-name').textContent = run.rite ? EPITHETS[dominantStat(run.stats)] : 'The Unnamed';
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
    case 'defeat':
      return e.loser === 'player' ? 'You fall.' : `${e.loser} is undone.`;
  }
}

// ---------- phase rendering ----------

function render(): void {
  rite.hidden = run.phase !== 'rite';
  threshold.hidden = run.phase !== 'threshold';
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

function showEvents(events: DuelEvent[]): void {
  for (const e of events) pushLog(describe(e));
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
  $('floor-rule').textContent = 'the lexicon awakens…';
  try {
    scorer = await ModelScorer.fromUrl('./lexicon.bin');
  } catch (err) {
    console.warn('lexicon unavailable, staying on stub scorer', err);
  }
  startRun();
}

void boot();
