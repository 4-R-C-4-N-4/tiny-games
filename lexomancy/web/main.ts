import { Duel, type Combatant, type DuelEvent } from '../src/duel.ts';
import { ModelScorer } from '../src/model-scorer.ts';
import { NECROMANCER } from '../src/opponents.ts';
import { StubScorer } from '../src/stub-scorer.ts';
import { CHANNELS, type Scorer } from '../src/types.ts';

const ENEMY_TURN_DELAY_MS = 750;

// The real lexicon loads async (~7MB, cached). Until it lands — or if it
// can't — the stub keeps the game playable.
let scorer: Scorer = new StubScorer();

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
const bars = Object.fromEntries(CHANNELS.map((c) => [c, $(`bar-${c}`)]));

let duel = newDuel();
let enemyThinking = false;

function newDuel(): Duel {
  // Non-deterministic seed is fine at the app boundary; the engine stays pure.
  return new Duel(scorer, NECROMANCER, (Math.random() * 2 ** 31) | 0);
}

function setLexiconStatus(text: string): void {
  $('floor-rule').textContent = text;
}

async function loadLexicon(): Promise<void> {
  setLexiconStatus('the lexicon awakens…');
  try {
    const model = await ModelScorer.fromUrl('./lexicon.bin');
    scorer = model;
    duel = newDuel();
    log.replaceChildren();
    renderCombatants();
    renderPreview();
    setLexiconStatus(`${(model.wordCount / 1000).toFixed(0)}k words known — speak`);
  } catch (err) {
    console.warn('lexicon unavailable, staying on stub scorer', err);
    setLexiconStatus('practice grounds — stub lexicon');
  }
}

function rarityLabel(r: number): string {
  if (r < 0.2) return 'common';
  if (r < 0.45) return 'uncommon';
  if (r < 0.7) return 'rare';
  return 'arcane';
}

function renderPreview(): void {
  const p = enemyThinking ? null : duel.preview(input.value);
  for (const c of CHANNELS) {
    bars[c].style.width = p ? `${Math.round(p.profile.mix[c] * 100)}%` : '0%';
  }
  if (p) {
    const fatigued = p.effectiveness < 0.98;
    $('preview-rarity').textContent =
      `${rarityLabel(p.profile.rarity)} · power ${p.profile.power}` +
      (fatigued ? ` → ${p.effectivePower} (fatigued)` : '');
    $('preview-cost').textContent = `cost ${p.profile.cost} ✦`;
  } else {
    $('preview-rarity').textContent = '—';
    $('preview-cost').textContent = '—';
  }
  castBtn.disabled = !p || !p.affordable || enemyThinking;
}

function statusLine(c: Combatant): string {
  const parts: string[] = [];
  if (c.ward > 0) parts.push(`🛡 ${c.ward}`);
  if (c.hex) parts.push(`☠ ${c.hex.potency} (${c.hex.turns}t)`);
  return parts.join('  ');
}

function renderCombatants(): void {
  $('enemy-name').textContent = duel.opponent.name;
  $('enemy-sprite').textContent = duel.opponent.sprite;
  $('enemy-hp').style.width = `${(100 * duel.enemy.hp) / duel.enemy.maxHp}%`;
  $('enemy-status').textContent = statusLine(duel.enemy);
  $('player-hp').style.width = `${(100 * duel.player.hp) / duel.player.maxHp}%`;
  $('player-mana').style.width = `${(100 * duel.player.mana) / duel.player.maxMana}%`;
  $('player-status').textContent = statusLine(duel.player);
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
    case 'falter':
      return `${e.actor} falters, gathering mana…`;
    case 'defeat':
      return e.loser === 'player' ? 'You fall.' : `${e.loser} is undone.`;
  }
}

function showEvents(events: DuelEvent[]): void {
  for (const e of events) pushLog(describe(e));
  renderCombatants();
  if (duel.winner) {
    $('overlay-text').textContent =
      duel.winner === 'player'
        ? `${duel.opponent.name} is undone. The spire’s next floor awaits — soon.`
        : 'Your words fail you. The spire keeps your name.';
    overlay.hidden = false;
  }
}

input.addEventListener('input', renderPreview);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (enemyThinking || duel.winner) return;
  const events = duel.castPlayer(input.value);
  if (!events) return;
  input.value = '';
  showEvents(events);
  renderPreview();
  if (duel.winner) return;

  enemyThinking = true;
  renderPreview();
  setTimeout(() => {
    showEvents(duel.enemyTurn());
    enemyThinking = false;
    renderPreview();
    input.focus();
  }, ENEMY_TURN_DELAY_MS);
});

$('restart-btn').addEventListener('click', () => {
  duel = newDuel();
  enemyThinking = false;
  overlay.hidden = true;
  log.replaceChildren();
  input.value = '';
  renderCombatants();
  renderPreview();
  input.focus();
});

renderCombatants();
renderPreview();
void loadLexicon();
