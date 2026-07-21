import { Duel, type Combatant, type DuelEvent, type CastPreview, type OpponentDef } from '../src/duel.ts';
import { THEME_HUES, type Theme } from '../src/floors.ts';
import { arenaFor } from './arena-render.ts';
import { ModelScorer } from '../src/model-scorer.ts';
import { SpireRun } from '../src/run.ts';
import { STAT_HUES, enemyPalette, playerPalette, type SpriteArt } from '../src/sprites.ts';
import { dominantStat, peakStat, performRite, STATS, type StatName } from '../src/stats.ts';
import { StubScorer } from '../src/stub-scorer.ts';
import { EXPLOIT_FLAVOR } from '../src/truename.ts';
import { CHANNELS, type Channel, type Scorer } from '../src/types.ts';
import { renderGallery } from './gallery.ts';
import { spriteAnim } from './sprite-render.ts';

// Thin shell over SpireRun: the run machine is headless; this file only
// renders phases and forwards input.

// Trimmed from 750ms: the preview no longer goes dark during this window
// (see renderPreview), so a shorter gap still reads as responsive rather
// than rushed — just enough time for the enemy's own cast VFX to land.
const ENEMY_TURN_DELAY_MS = 600;

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
const victory = $('victory');
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
  // The scrying glass stays live even while the enemy acts — duel.preview()
  // is a pure read, so there's no reason composing your next word should go
  // dark for the ~0.5s the enemy takes. Only the actual cast is gated.
  const duel = activeDuelForPreview();
  const p: CastPreview | null = duel ? duel.preview(input.value) : null;
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
  const silenced = !!p && p.floor.channelAmp[p.profile.dominant] === 0;
  $('preview').classList.toggle('backfire', !!p?.floor.tabooed || !!p?.floor.healInverted);
  $('preview').classList.toggle('silenced', silenced);
  if (p?.floor.tabooed) {
    warn.textContent = '⚠ forbidden here — this word will turn on you';
    warn.className = 'taboo';
  } else if (p?.floor.healInverted) {
    warn.textContent = '⚠ healing is cursed here — this word will wound you instead';
    warn.className = 'healinvert';
  } else if (silenced) {
    warn.textContent = '◦ that channel is silenced here — it will do nothing';
    warn.className = 'muted';
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
  const rootsEl = $('preview-roots');
  if (p && p.profile.improvised) {
    if (p.profile.roots?.length) {
      rootsEl.textContent = `◈ ${p.profile.roots.join(' + ')}`;
      rootsEl.className = 'roots';
    } else {
      rootsEl.textContent = '◇ wild babble — not a real word, and it shows';
      rootsEl.className = '';
    }
  } else {
    rootsEl.textContent = '';
    rootsEl.className = '';
  }
  const inDuel = run.phase === 'duel';
  castBtn.disabled = !inDuel || !p || !p.affordable || enemyThinking;
  castBtn.textContent = shortfall > 0 ? `Need ${shortfall} ✦` : 'Cast';
  castBtn.classList.toggle('short', shortfall > 0);
}

function statusLine(c: Combatant, exploit?: StatName | null): string {
  const parts: string[] = [];
  if (c.ward > 0) parts.push(`🛡 ${c.ward}`);
  if (c.hex) parts.push(`☠ ${c.hex.potency} (${c.hex.turns}t)`);
  // Persistent reminder of what a name-knowing boss is reading, not just a
  // one-off log line — the exploited stat drives its choices every turn.
  if (exploit) parts.push(`🗝 ${STAT_ABBR[exploit]}`);
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
  $('enemy-status').textContent = enemy ? statusLine(enemy, duel?.nameExploit) : '';
  const player = duel?.player;
  $('player-hp').style.width = player
    ? `${(100 * player.hp) / player.maxHp}%`
    : `${(100 * run.playerHp) / run.playerMaxHp}%`;
  $('player-mana').style.width = player
    ? `${(100 * player.mana) / player.maxMana}%`
    : '100%';
  $('player-status').textContent = player ? statusLine(player) : '';
  $('player-name').textContent = run.trueName ?? 'The Unnamed';
  $('enemy-thinking').hidden = !(enemyThinking && run.phase === 'duel');
}

const RITE_THEME: Theme = 'starlight';
let arenaTheme: Theme | null = null;

function setArenaTheme(theme: Theme): void {
  if (theme === arenaTheme) return;
  arenaTheme = theme;
  const layers = arenaFor(theme);
  $('arena-ground').style.backgroundImage = `url(${layers.ground})`;
  const far = $('arena-far');
  far.style.backgroundImage = `url(${layers.farDressing})`;
  far.style.setProperty('--tile-w', `${layers.farTileWidth}px`);
  const near = $('arena-near');
  near.style.backgroundImage = `url(${layers.nearDressing})`;
  near.style.setProperty('--tile-w', `${layers.nearTileWidth}px`);
}

function renderFloorBanner(): void {
  if (run.phase === 'rite') {
    $('floor-name').textContent = 'The Spire';
    $('floor-rule').textContent = `${wordCountLabel()} — name yourself`;
    document.getElementById('stage')!.classList.remove('themed');
    setArenaTheme(RITE_THEME);
    return;
  }
  const floor = run.currentFloorSafe();
  if (!floor) return;
  $('floor-name').textContent = `${floor.index}/8 · ${floor.name}`;
  $('floor-rule').textContent = floor.ruleText;
  const stage = document.getElementById('stage')!;
  stage.classList.add('themed');
  stage.style.setProperty('--floor-hue', String(THEME_HUES[floor.theme]));
  setArenaTheme(floor.theme);
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
      if (e.selfHarm > 0) parts.push(`— cursed mercy — ${e.selfHarm} self-inflicted`);
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
      return `${e.actor} speaks your True Name — ${run.trueName ?? 'it knows you'} — ${EXPLOIT_FLAVOR[e.exploitedStat]}.`;
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
    if (profile.improvised) word.title = profile.roots?.length ? profile.roots.join(' + ') : 'wild babble';
    row.appendChild(word);
    if (profile.improvised) {
      const badge = document.createElement('i');
      badge.className = 'g-improvised';
      badge.textContent = profile.roots?.length ? '◈' : '◇';
      row.appendChild(badge);
    }
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
  victory.hidden = run.phase !== 'cleared';
  $('grimoire').hidden = true;
  const gbtn = $('grimoire-btn');
  gbtn.hidden = run.phase === 'rite';
  gbtn.textContent = `📖 ${new Set(run.history).size}`;
  overlay.hidden = !(run.phase === 'fallen' || run.phase === 'ascended');
  if (run.phase === 'threshold') renderThreshold();
  if (run.phase === 'cleared') renderVictoryScreen();
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
  renderQuickcast();
}

/** Fills the gap between the arena and compose: tap a discovered word to
 * reuse it instead of retyping. Dims words currently fatigued so a tap
 * doesn't waste a turn on a word that'll fizzle. */
function renderQuickcast(): void {
  const list = $('quickcast-list');
  const label = $('quickcast-label');
  list.replaceChildren();

  const seen = new Set<string>();
  const words: string[] = [];
  for (let i = run.history.length - 1; i >= 0 && words.length < 40; i--) {
    const w = run.history[i];
    if (seen.has(w)) continue;
    seen.add(w);
    words.push(w);
  }

  label.hidden = words.length === 0;
  if (words.length === 0) {
    const empty = document.createElement('span');
    empty.id = 'quickcast-empty';
    empty.textContent = 'Cast a word and it appears here for quick reuse.';
    list.appendChild(empty);
    return;
  }

  const duel = activeDuelForPreview();
  for (const w of words) {
    if (!scorer.knows(w)) continue;
    const profile = scorer.score(w);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'qc-chip';
    const eff = duel?.preview(w)?.effectiveness ?? 1;
    if (eff < 0.5) chip.classList.add('fatigued');
    const dot = document.createElement('i');
    dot.className = 'qc-dot';
    dot.style.background = CHANNEL_COLORS[profile.dominant];
    chip.append(dot, document.createTextNode(w));
    chip.addEventListener('click', () => {
      input.value = w;
      renderPreview();
      input.focus();
    });
    list.appendChild(chip);
  }
}

/** The feel-good beat between winning a duel and the next Threshold — names
 * the boss you just beat outright, rather than cutting straight to the next
 * floor's setup with no acknowledgment. */
function renderVictoryScreen(): void {
  const boss = run.lastDefeated;
  const holder = $('victory-sprite');
  if (!boss || boss.art === 'player') {
    holder.replaceChildren();
    return;
  }
  // The floor just cleared, not the (already-advanced) upcoming one — so the
  // boss renders in the theme it actually fought under.
  const clearedFloor = run.floors[run.lastDefeatedFloorIndex - 1];
  const hue = THEME_HUES[clearedFloor.theme];
  const el = spriteAnim(boss.art, enemyPalette(boss.art, hue), enemyPalette(boss.art, hue, 1));
  if (holder.firstChild !== el) holder.replaceChildren(el);
  $('victory-title').textContent = `Floor ${run.lastDefeatedFloorIndex} cleared`;
  $('victory-sub').textContent = `You defeated ${boss.name}. Its casts fall silent — the spire remembers this.`;
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
  // Pact/Study vary per floor now (floors.ts:PACT_OPTIONS/STUDY_OPTIONS) —
  // no longer the same two static buttons on every single Threshold.
  $('pact-btn').textContent = floor.pact.label;
  $('study-btn').textContent = floor.study.label;
  $<HTMLButtonElement>('pact-btn').classList.toggle('used', run.pactArmed);
  $<HTMLButtonElement>('study-btn').classList.toggle('used', !!run.studyReport);
}

// ---------- rite ----------

const picked = new Set<string>();
let lastRiteStats: Record<string, number> | null = null;

const STAT_ABBR: Record<StatName, string> = {
  ferocity: 'FER',
  guile: 'GUI',
  stone: 'STO',
  grace: 'GRA',
  resonance: 'RES',
};

/** Green (weak pull) -> purple (strong, decisive pull), so the handful of
 * genuinely "meh" words in the offer visibly stand out from the rest. */
function qualityColor(value: number): string {
  const hue = 140 + 140 * Math.min(1, Math.max(0, value));
  return `hsl(${hue} 55% 60%)`;
}

/** Cached per rendered offer so repeated re-renders (every click) don't
 * re-run anchor-affinity lookups for all 12 words each time. */
let riteOfferPeaks: Map<string, { stat: StatName; value: number }> | null = null;

function renderRiteChoices(): void {
  const box = $('rite-choices');
  box.replaceChildren();
  const offer = run.offer();
  riteOfferPeaks ??= new Map(offer.map((w) => [w, peakStat(scorer, w)]));
  for (const adj of offer) {
    const { stat, value } = riteOfferPeaks.get(adj)!;
    const color = qualityColor(value);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'adj-chip' + (picked.has(adj) ? ' picked' : '');
    chip.style.setProperty('--chip-color', color);
    chip.append(adj + ' ');
    const tag = document.createElement('i');
    tag.className = 'adj-stat';
    tag.textContent = STAT_ABBR[stat];
    chip.appendChild(tag);
    chip.addEventListener('click', () => {
      if (picked.has(adj)) picked.delete(adj);
      else if (picked.size < 5) picked.add(adj);
      renderRiteChoices();
      renderRiteStats();
    });
    box.appendChild(chip);
  }
  $('rite-count').textContent = `${picked.size} chosen (up to 5)`;
}

function renderRiteStats(): void {
  const flaw = $<HTMLInputElement>('flaw-input').value.trim();
  const stats =
    picked.size > 0
      ? performRite(scorer, [...picked], flaw && scorer.knows(flaw) ? flaw : undefined).stats
      : null;
  for (const stat of STATS) {
    const row = document.querySelector<HTMLElement>(`.rite-stat[data-stat="${stat}"]`);
    if (!row) continue;
    const value = stats ? stats[stat] : 0.5;
    const fill = row.querySelector<HTMLElement>('.rs-fill')!;
    fill.style.width = `${Math.round(value * 100)}%`;
    const prev = lastRiteStats?.[stat];
    row.classList.toggle('rising', prev !== undefined && value > prev + 0.01);
  }
  lastRiteStats = stats ? { ...stats } : null;
}

$('flaw-input').addEventListener('input', renderRiteStats);

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

// Streak travel time — must match the CSS default (--streak-ms) so the
// impact beat (burst/shake/number) is scheduled to land exactly when the
// projectile visually arrives, not before.
const STREAK_MS = 180;

/** Damage magnitude -> visual intensity, clamped so tiny/huge hits both read clearly. */
function magFor(value: number, ref = 12): number {
  return Math.min(1.9, Math.max(0.6, 0.6 + (value / ref) * 0.8));
}

function vfxBurst(target: HTMLElement, color: string, mag = 1): void {
  const b = document.createElement('div');
  b.className = 'vfx-burst';
  b.style.setProperty('--vfx-color', color);
  b.style.setProperty('--mag', String(mag));
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

function vfxShake(target: HTMLElement, mag = 1): void {
  target.classList.remove('shaking');
  target.style.setProperty('--mag', String(mag));
  void target.offsetWidth; // restart the animation
  target.classList.add('shaking');
}

function playCastVfx(e: DuelEvent): void {
  if (e.kind === 'drain') {
    const el = combatantEl(e.actor);
    vfxFloat(el, `−${e.drain} ☠`, CHANNEL_COLORS.hex);
    vfxShake(el, magFor(e.drain, 8));
    return;
  }
  if (e.kind === 'echo') {
    const el = combatantEl(e.actor);
    const mag = magFor(e.damage);
    vfxFloat(el, `−${e.damage} ⟲`, CHANNEL_COLORS.damage);
    vfxBurst(el, CHANNEL_COLORS.damage, mag);
    vfxShake(el, mag);
    return;
  }
  if (e.kind === 'truename') {
    const el = combatantEl('player');
    vfxBurst(el, CHANNEL_COLORS.hex, 1.4);
    vfxShake(el, 1.4);
    return;
  }
  if (e.kind !== 'cast') return;
  const caster = combatantEl(e.actor);
  const target = e.tabooed ? caster : otherEl(e.actor);
  // Beat 1 (instant, t=0): the wind-up — your input's immediate confirmation.
  vfxLunge(e.actor);
  if (e.tabooed) vfxTabooFlash();

  // Beat 2 (instant): self-effects have no travel distance — ward blooms and
  // heal motes rise on the caster right away, no reason to wait.
  if (e.wardGained > 0) {
    vfxRing(caster);
    vfxFloat(caster, `🛡 +${e.wardGained}`, CHANNEL_COLORS.ward);
  }
  if (e.healed > 0) {
    vfxSpawn(caster, 'vfx-mote', 4, 1000);
    vfxFloat(caster, `+${e.healed}`, CHANNEL_COLORS.heal);
  }
  if (e.selfHarm > 0) {
    const mag = magFor(e.selfHarm);
    vfxBurst(caster, CHANNEL_COLORS.damage, mag);
    vfxFloat(caster, `−${e.selfHarm}`, CHANNEL_COLORS.damage);
    vfxShake(caster, mag);
  }

  // Beat 3 (delayed to STREAK_MS): effects landing ON the target — damage
  // and hex both travel, so their payoff (burst/shake/tendrils/numbers) is
  // scheduled to land exactly when the streak visually arrives, not before.
  const hasImpact = e.damage > 0 || e.absorbed > 0 || e.hexApplied > 0;
  if (hasImpact) vfxStreak(target, e.actor !== 'player');
  if (e.damage > 0 || e.absorbed > 0) {
    const mag = magFor(e.damage || e.absorbed);
    setTimeout(() => {
      if (e.damage > 0) {
        vfxBurst(target, CHANNEL_COLORS.damage, mag);
        vfxFloat(target, `−${e.damage}`, CHANNEL_COLORS.damage);
        vfxShake(target, mag);
      }
    }, STREAK_MS);
  }
  if (e.hexApplied > 0) {
    setTimeout(() => {
      vfxSpawn(target, 'vfx-tendril', 3, 900);
      vfxFloat(target, `☠ +${e.hexApplied}`, CHANNEL_COLORS.hex);
    }, STREAK_MS);
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

$('victory-continue').addEventListener('click', () => {
  run.acknowledgeVictory();
  render();
});

// ---------- boot ----------

function startRun(): void {
  run = new SpireRun(scorer, (Math.random() * 2 ** 31) | 0);
  picked.clear();
  lastRiteStats = null;
  riteOfferPeaks = null;
  practiceDuel = null;
  enemyThinking = false;
  log.replaceChildren();
  input.value = '';
  $<HTMLInputElement>('flaw-input').value = '';
  renderRiteChoices();
  renderRiteStats();
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
