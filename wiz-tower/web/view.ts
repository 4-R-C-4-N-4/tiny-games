/**
 * GameView — the browser consumer. It renders the Game on a canvas and wires touch/mouse
 * controls; the sim stays headless (this is the only file that knows about pixels). Board →
 * canvas (atmosphere, arcane Core, sigil-stone towers, per-trait mob silhouettes, beams,
 * particles); HUD, palette, controls, codex → DOM.
 */
import { fxToFloat } from '../src/fx.ts';
import { Element, ELEMENT_NAMES, N_ELEMENTS } from '../src/element.ts';
import { Trait, Tier, NodeKind, OccKind, type Cell, type Mob, type Tower } from '../src/types.ts';
import { WALL_COST, WALL_HP, towerCost, towerStats, tierGateCost, attuneCost } from '../src/config.ts';
import { Game, type Opponent, type Personality, type Recap } from '../src/game.ts';
import type { Opener } from '../src/wave.ts';
import {
  ELEMENT_COLOR, ELEMENT_EMOJI, ELEMENT_ARCANA, ELEMENT_FLAVOR, TRAIT_SHAPE, TRAIT_RADIUS,
  creatureName, TRAIT_ROLE, TRAIT_CREATURE, TRAIT_COUNTER, type MobShape,
} from './theme.ts';
import { Effects } from './effects.ts';

type Tool = { kind: 'wall' } | { kind: 'sell' } | { kind: 'tower'; element: Element };

const CELL = 46; // css px per cell
const TAU = Math.PI * 2;

export class GameView {
  private game!: Game;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private tool: Tool | null = null;
  private verbTool: 'overcharge' | 'reveal' | 'reinforce' | null = null;
  private tier: Tier = Tier.T1;
  private speed = 1;
  private acc = 0;
  private lastT = 0;
  private time = 0;
  private readonly reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private effects = new Effects(this.reduced);
  private started = false;
  private classChoice: Element | null = null; // no discipline pre-selected — you must choose
  private diffChoice = 3;
  private opponentChoice: Opponent = 'search';
  private personalityChoice: Personality = 'balanced';
  private seed = 1n;

  // per-frame effect bookkeeping
  private prevMobs = new Map<number, { x: number; y: number; color: string }>();
  private prevWalls = new Map<number, number>(); // cell index → wall HP (Fx), for breach FX
  private prevCoreHp = 0;
  private fireTimers = new Map<number, number>();
  private moteTimer = 0;
  private hover: Cell | null = null;

  private el: Record<string, HTMLElement> = {};
  private paletteButtons: { node: HTMLButtonElement; refresh: () => void }[] = [];
  private controlsKey = '';
  private overShown = false;

  constructor(private root: HTMLElement) {
    this.buildDom();
    this.showStart();
    requestAnimationFrame(this.frame);
  }

  // ---- DOM scaffolding ------------------------------------------------------------

  private buildDom(): void {
    this.root.innerHTML = `
      <div class="wt">
        <header class="wt-top">
          <img class="wt-mark" src="./art/affinity-sigil.svg" alt="" />
          <div class="wt-brand"><span class="wt-title">WIZ<i>·</i>TOWER</span><span class="wt-sub">arcane affinity defense</span></div>
          <button class="wt-codexbtn" id="newrun" title="New run — choose a discipline" hidden>↺</button>
          <button class="wt-codexbtn" id="codexbtn" title="Affinity codex">✦</button>
        </header>
        <div id="start" class="wt-start"></div>
        <div id="play" class="wt-play" hidden>
          <div class="wt-hud">
            <span id="currency" class="wt-cur"></span>
            <div class="wt-core" id="coremeter"><div id="corefill" class="wt-corefill"></div><span id="corelabel"></span></div>
            <span id="wavelabel" class="wt-wave"></span>
          </div>
          <div class="wt-board-wrap">
            <canvas id="board"></canvas>
            <div id="overlay" class="wt-overlay"></div>
            <div id="codex" class="wt-codex"></div>
          </div>
          <div id="telegraph" class="wt-telegraph"></div>
          <div id="palette" class="wt-palette"></div>
          <div id="controls" class="wt-controls"></div>
        </div>
      </div>`;
    const byId = (id: string) => this.root.querySelector<HTMLElement>('#' + id)!;
    for (const id of ['start', 'play', 'currency', 'corefill', 'corelabel', 'wavelabel', 'overlay', 'codex', 'telegraph', 'palette', 'controls']) {
      this.el[id] = byId(id);
    }
    this.canvas = byId('board') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.addEventListener('pointerdown', (e) => this.onBoardClick(e));
    this.canvas.addEventListener('pointermove', (e) => { this.hover = this.cellAt(e); });
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; });
    byId('codexbtn').onclick = () => this.toggleCodex();
    byId('newrun').onclick = () => this.showStart();
  }

  // ---- discipline-select start screen ---------------------------------------------

  private showStart(): void {
    this.started = false;
    this.classChoice = null;
    this.el.play.hidden = true;
    (this.root.querySelector('#newrun') as HTMLElement).hidden = true;
    const s = this.el.start;
    s.hidden = false;
    s.innerHTML = `
      <p class="wt-tag">Bind the wards. Scry the summoner. Hold the Heartstone.</p>
      <h2 class="wt-h2">Choose your discipline</h2>
      <div class="wt-classes" id="classes"></div>
      <div class="wt-startopts" id="startopts"></div>
      <button class="wt-primary wt-begin" id="begin" disabled>Choose a discipline to begin</button>`;
    this.buildClassCards();
    this.buildStartOpts();
    const begin = s.querySelector<HTMLButtonElement>('#begin')!;
    begin.onclick = () => { if (this.classChoice !== null) this.startRun(); };
  }

  private buildClassCards(): void {
    const wrap = this.el.start.querySelector<HTMLElement>('#classes')!;
    wrap.innerHTML = '';
    for (let e = 0; e < N_ELEMENTS; e++) {
      const el = e as Element;
      const card = document.createElement('button');
      card.className = 'wt-class';
      card.style.setProperty('--el', ELEMENT_COLOR[el]);
      card.innerHTML = `<canvas width="40" height="40"></canvas>
        <div class="wt-class-t"><b>${ELEMENT_ARCANA[el]}</b><span>${ELEMENT_NAMES[el]}</span><em>${ELEMENT_FLAVOR[el]}</em></div>`;
      card.onclick = () => this.chooseClass(el);
      wrap.appendChild(card);
      const cv = card.querySelector('canvas')!;
      const dpr = window.devicePixelRatio || 1;
      cv.width = 40 * dpr; cv.height = 40 * dpr;
      const cx = cv.getContext('2d')!;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.translate(20, 20); cx.shadowColor = ELEMENT_COLOR[el]; cx.shadowBlur = 8;
      drawElementGlyph(cx, el, 11, ELEMENT_COLOR[el]);
    }
  }

  private chooseClass(el: Element): void {
    this.classChoice = el;
    for (const c of this.el.start.querySelectorAll('.wt-class')) c.classList.remove('sel');
    (this.el.start.querySelectorAll('.wt-class')[el] as HTMLElement).classList.add('sel');
    const begin = this.el.start.querySelector<HTMLButtonElement>('#begin')!;
    begin.disabled = false;
    begin.textContent = `Begin as a ${ELEMENT_ARCANA[el]} adept`;
  }

  private buildStartOpts(): void {
    const opts = this.el.start.querySelector<HTMLElement>('#startopts')!;
    opts.innerHTML = '';
    const group = (label: string, items: [string, string, () => void, boolean][]) => {
      const row = document.createElement('div'); row.className = 'wt-optrow';
      const l = document.createElement('span'); l.className = 'wt-lbl'; l.textContent = label; row.appendChild(l);
      for (const [text, title, on, sel] of items) {
        const b = document.createElement('button'); b.className = 'wt-chip' + (sel ? ' sel' : ''); b.textContent = text; b.title = title;
        b.onclick = () => { on(); this.buildStartOpts(); }; row.appendChild(b);
      }
      opts.appendChild(row);
    };
    group('Rank', ([1, 2, 3, 4, 5] as const).map((d) => [String(d), `difficulty ${d}`, () => { this.diffChoice = d; }, this.diffChoice === d]));
    group('Foe', ([['Search', 'search'], ['Mind', 'strategist'], ['Net', 'model']] as const).map(([t, o]) =>
      [t, o === 'search' ? 'Live branching search (L2)' : o === 'strategist' ? 'Cross-wave strategist (L3) — learns your habits' : 'Distilled tiny net', () => { this.opponentChoice = o; }, this.opponentChoice === o]));
    group('Style', ([['Balanced', 'balanced'], ['Aggressive', 'aggressive'], ['Economic', 'economic'], ['Bluffy', 'bluffy']] as const).map(([t, p]) =>
      [t, `${p} attacker (search foes)`, () => { this.personalityChoice = p; }, this.personalityChoice === p]));
  }

  private startRun(): void {
    this.el.start.hidden = true;
    this.el.play.hidden = false;
    (this.root.querySelector('#newrun') as HTMLElement).hidden = false;
    this.started = true;
    this.newGame();
  }

  private toggleCodex(): void {
    const c = this.el.codex;
    if (c.style.display === 'flex') { c.style.display = 'none'; return; }
    c.style.display = 'flex';
    // Representative element per creature, chosen to show the whole palette.
    const cards: [Trait, Element][] = [
      [Trait.Grunt, Element.Fire], [Trait.Swarm, Element.Zap], [Trait.Tank, Element.Earth],
      [Trait.Runner, Element.Ice], [Trait.Flier, Element.Sonic], [Trait.Shade, Element.Dark],
      [Trait.Shielded, Element.Light], [Trait.Mender, Element.Earth], [Trait.Breaker, Element.Fire],
    ];
    c.innerHTML = `<div class="wt-codex-in">
      <img src="./art/affinity-sigil.svg" alt="Affinity wheel" />
      <p>Each school <b>counters the next</b> around the wheel (1.5×) and is weak to the one before (0.5×). <b>Radiant ⇄ Void</b> answer only each other. Read your foe's colours; conjure against the school they ward weakly.</p>
      <p class="wt-note"><b>Your wards.</b> Your chosen school (★) is pre-attuned — build its wards freely. Any <i>other</i> school needs a one-time <b>🔓 attunement</b> before you can build it (the price rises with each school you add). Ward badges: <b>↑</b> anti-air · <b>◉</b> detection · <b>~</b> slow · <b>✷</b> splash.</p>
      <p class="wt-note"><b>Walls.</b> 🧱 walls funnel the ground path (fliers ignore them). They have HP: blocked mobs only chip them, but <b>Gargoyles (Breakers)</b> smash them fast to breach a shortcut — watch the wall's bar.</p>
      <h3>Bestiary</h3>
      <div class="wt-bestiary">${cards.map(([tr, el]) =>
        `<div class="wt-beast"><canvas width="56" height="56"></canvas><div><b>${creatureName(el, tr)}</b><span>${TRAIT_ROLE[tr]}</span></div></div>`).join('')}</div>
      <button class="wt-ctl" id="codexclose">Close</button></div>`;
    const canvases = c.querySelectorAll('canvas');
    cards.forEach(([tr, el], i) => {
      const cv = canvases[i] as HTMLCanvasElement;
      const dpr = window.devicePixelRatio || 1;
      cv.width = 56 * dpr; cv.height = 56 * dpr;
      const cx = cv.getContext('2d')!;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.translate(28, 30); cx.shadowColor = ELEMENT_COLOR[el]; cx.shadowBlur = 8;
      paintCreature(cx, 15, ELEMENT_COLOR[el], el, tr, 0.7, { warded: true });
    });
    c.querySelector<HTMLButtonElement>('#codexclose')!.onclick = () => { c.style.display = 'none'; };
    c.onclick = (e) => { if (e.target === c) c.style.display = 'none'; };
  }

  private newGame(): void {
    this.seed = (this.seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    this.game = new Game({
      starting: this.classChoice ?? Element.Fire, difficulty: this.diffChoice, seed: this.seed,
      opponent: this.opponentChoice, personality: this.personalityChoice,
    });
    this.tool = { kind: 'wall' };
    this.verbTool = null;
    this.tier = Tier.T1;
    this.speed = 1;
    this.effects = new Effects(this.reduced);
    this.prevMobs.clear();
    this.prevWalls.clear();
    this.fireTimers.clear();
    this.prevCoreHp = fxToFloat(this.game.coreHp());
    this.sizeCanvas();
    this.buildPalette();
    this.controlsKey = '';
    this.overShown = false;
    this.el.overlay.style.display = 'none';
    this.el.codex.style.display = 'none';
  }

  private sizeCanvas(): void {
    const g = this.game.sim.grid;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = g.w * CELL + 'px';
    this.canvas.style.height = g.h * CELL + 'px';
    this.canvas.width = Math.round(g.w * CELL * dpr);
    this.canvas.height = Math.round(g.h * CELL * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private cellAt(e: PointerEvent): Cell {
    const rect = this.canvas.getBoundingClientRect();
    return { x: Math.floor((e.clientX - rect.left) / CELL), y: Math.floor((e.clientY - rect.top) / CELL) };
  }

  // ---- build palette --------------------------------------------------------------

  private buildPalette(): void {
    const p = this.el.palette;
    p.innerHTML = '';
    this.paletteButtons = [];
    const add = (onClick: () => void, refresh: (b: HTMLButtonElement) => void, selected: () => boolean, cls = '') => {
      const b = document.createElement('button');
      b.className = 'wt-tool' + (cls ? ' ' + cls : '');
      b.onclick = onClick;
      p.appendChild(b);
      this.paletteButtons.push({ node: b, refresh: () => { refresh(b); b.classList.toggle('sel', selected()); } });
    };

    add(() => { this.tool = { kind: 'wall' }; },
      (b) => { this.setHTML(b, `🧱<small>${WALL_COST}</small>`); b.disabled = this.game.currency < WALL_COST; },
      () => this.tool?.kind === 'wall');

    for (let e = 0; e < N_ELEMENTS; e++) {
      const el = e as Element;
      add(() => this.onElementTool(el), (b) => this.refreshElementBtn(b, el),
        () => this.tool?.kind === 'tower' && this.tool.element === el, 'wt-elem');
    }

    add(() => { this.tool = { kind: 'sell' }; }, (b) => { this.setHTML(b, '❌'); }, () => this.tool?.kind === 'sell');

    const tierBtn = document.createElement('button');
    tierBtn.className = 'wt-tool wt-tier';
    tierBtn.onclick = () => { this.tier = ((this.tier % 3) + 1) as Tier; this.controlsKey = ''; };
    p.appendChild(tierBtn);
    this.paletteButtons.push({ node: tierBtn, refresh: () => { this.setHTML(tierBtn, `<small>tier</small>T${this.tier}`); } });
  }

  /** Rewrite innerHTML only when it actually changed. Rewriting every frame destroys a
   *  button's child nodes between a pointer-down and pointer-up, eating the click. */
  private setHTML(b: HTMLElement & { _h?: string }, html: string): void {
    if (b._h !== html) { b._h = html; b.innerHTML = html; }
  }

  private refreshElementBtn(b: HTMLButtonElement, el: Element): void {
    const pl = this.game.sim.player;
    const flags = towerStats(el, Tier.T1, NodeKind.Turret).flags;
    const badge = flags.antiAir ? '<i class="wt-cap aa" title="anti-air">↑</i>'
      : flags.detection ? '<i class="wt-cap det" title="detection">◉</i>'
        : flags.slow > 0 ? '<i class="wt-cap slow" title="slow">∼</i>'
          : flags.splash > 0 ? '<i class="wt-cap spl" title="splash">✷</i>' : '';
    b.style.setProperty('--el', ELEMENT_COLOR[el]);
    const home = el === pl.starting;
    b.classList.toggle('wt-home', home);
    b.title = home
      ? `${ELEMENT_NAMES[el]} — your school (pre-attuned, build freely)`
      : pl.attuned[el]
        ? `${ELEMENT_NAMES[el]} ward — ${ELEMENT_ARCANA[el]}${flags.antiAir ? ' · hits fliers' : flags.detection ? ' · reveals shades' : ''}`
        : `Attune ${ELEMENT_NAMES[el]} (${ELEMENT_ARCANA[el]}) — one-time unlock, then build its wards`;
    if (!pl.attuned[el]) {
      const cost = attuneCost(pl.attuneCount);
      this.setHTML(b, `<span class="wt-glyph">${ELEMENT_EMOJI[el]}${badge}</span><small>🔓${cost}</small>`);
      b.disabled = this.game.currency < cost || this.game.state !== 'build';
    } else {
      const cost = this.towerPrice(el);
      this.setHTML(b, `<span class="wt-glyph">${ELEMENT_EMOJI[el]}${badge}</span><small>${cost}</small>`);
      b.disabled = this.tier > pl.depth[el] + 1 || this.game.currency < cost || this.game.state !== 'build';
    }
  }

  private towerPrice(el: Element): number {
    const pl = this.game.sim.player;
    const gate = this.tier > pl.depth[el] ? tierGateCost(el, this.tier, pl.starting) : 0;
    return towerCost(NodeKind.Turret, this.tier) + gate;
  }

  private onElementTool(el: Element): void {
    const pl = this.game.sim.player;
    if (!pl.attuned[el]) { this.game.attune(el); if (pl.attuned[el]) this.tool = { kind: 'tower', element: el }; }
    else this.tool = { kind: 'tower', element: el };
  }

  // ---- input ----------------------------------------------------------------------

  private onBoardClick(e: PointerEvent): void {
    const cell = this.cellAt(e);
    if (!this.game.sim.grid.inBounds(cell)) return;
    if (this.game.state === 'wave') {
      if (this.verbTool && this.game.verb({ kind: this.verbTool, cell })) {
        const c = cellCenter(cell);
        this.effects.cast(c.x, c.y, this.verbTool === 'overcharge' ? '#ffe14d' : this.verbTool === 'reveal' ? '#5fd0ff' : '#8fce77');
        this.verbTool = null;
      }
      return;
    }
    if (this.game.state !== 'build' || !this.tool) return;
    if (this.tool.kind === 'wall') this.game.buildWall(cell);
    else if (this.tool.kind === 'sell') this.game.sell(cell);
    else this.game.buildTower(cell, this.tool.element, this.tier, NodeKind.Turret);
  }

  // ---- controls -------------------------------------------------------------------

  private renderControls(): void {
    const g = this.game;
    const key = g.state === 'build' ? `build:${g.planned}`
      : g.state === 'wave' ? `wave:${this.speed}:${this.verbTool}:${g.verbsLeft}` : 'over';
    if (key === this.controlsKey) return;
    this.controlsKey = key;
    const c = this.el.controls;
    c.innerHTML = '';
    if (g.state === 'build') {
      const plan = this.btn(g.planned ? '👁 Re-scry' : '👁 Scry wave', () => g.planWave());
      const start = this.btn('▶ Begin', () => g.startWave());
      start.classList.add('wt-primary');
      c.append(plan, start);
    } else if (g.state === 'wave') {
      for (const [label, kind, col] of [['⚡', 'overcharge', '#ffe14d'], ['👁', 'reveal', '#5fd0ff'], ['🛡', 'reinforce', '#8fce77']] as const) {
        const b = this.btn(label, () => { this.verbTool = this.verbTool === kind ? null : kind; this.controlsKey = ''; });
        b.classList.add('wt-verb'); b.style.setProperty('--el', col);
        b.disabled = g.verbsLeft <= 0;
        b.classList.toggle('sel', this.verbTool === kind);
        b.title = kind;
        c.appendChild(b);
      }
      const charges = document.createElement('span'); charges.className = 'wt-charges'; charges.textContent = `×${g.verbsLeft}`;
      c.appendChild(charges);
      for (const [label, sp] of [['⏸', 0], ['1×', 1], ['2×', 2], ['4×', 4]] as const) {
        const b = this.btn(label, () => { this.speed = sp; this.controlsKey = ''; });
        b.classList.toggle('sel', this.speed === sp);
        c.appendChild(b);
      }
    }
  }

  private btn(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button'); b.className = 'wt-ctl'; b.textContent = label; b.onclick = onClick; return b;
  }

  // ---- main loop ------------------------------------------------------------------

  private frame = (t: number): void => {
    requestAnimationFrame(this.frame); // keep the loop alive even on the start screen
    const dt = this.lastT ? Math.min(0.05, (t - this.lastT) / 1000) : 0;
    this.lastT = t;
    if (!this.started || !this.game) return; // nothing to animate until a run begins
    this.time += dt;
    if (this.game.state === 'wave' && this.speed > 0) {
      this.acc += dt * 30 * this.speed;
      const steps = Math.min(240, Math.floor(this.acc));
      this.acc -= steps;
      if (steps > 0) this.game.update(steps);
    } else {
      this.acc = 0;
    }
    this.syncEffects(dt);
    this.effects.update(dt);
    this.render();
  };

  /** Diff sim state to spawn juice: death shatters, leak shockwaves, tower-fire beams, motes. */
  private syncEffects(dt: number): void {
    const sim = this.game.sim;
    const live = new Map<number, { x: number; y: number; color: string }>();
    for (const m of sim.liveMobs()) {
      live.set(m.id, { x: fxToFloat(m.pos.x) * CELL, y: fxToFloat(m.pos.y) * CELL, color: ELEMENT_COLOR[m.element] });
    }
    // deaths / leaks: any previously-live mob now gone bursts at its last position
    if (this.game.state !== 'build') {
      for (const [id, p] of this.prevMobs) if (!live.has(id)) this.effects.burst(p.x, p.y, p.color, 1);
    }
    this.prevMobs = live;

    // leak → core shockwave + shake, scaled by damage taken
    const coreHp = fxToFloat(this.game.coreHp());
    if (coreHp < this.prevCoreHp - 0.01) {
      const core = cellCenter(sim.grid.coreCell());
      this.effects.shockwave(core.x, core.y, '#ff5a4d', Math.min(1.6, (this.prevCoreHp - coreHp) / 6));
    }
    this.prevCoreHp = coreHp;

    // wall breaching: chip sparks while a wall takes damage; a debris burst + shake when it
    // shatters — so it's visible that mobs are breaking through, not that it "just dissolves".
    const g0 = sim.grid;
    const nowWalls = new Map<number, number>();
    for (let i = 0; i < g0.cells.length; i++) {
      const occ = g0.cells[i].occ;
      if (occ.kind !== OccKind.Wall) continue;
      nowWalls.set(i, occ.hp);
      const prev = this.prevWalls.get(i);
      if (prev !== undefined && occ.hp < prev - 1) {
        const cx = (i % g0.w + 0.5) * CELL, cy = ((i / g0.w | 0) + 0.5) * CELL;
        this.effects.beam(cx - 4, cy - 4, cx + 4, cy + 4, '#c9c9e0'); // a small stony spark
      }
    }
    if (this.game.state === 'wave') {
      for (const [i, hp] of this.prevWalls) if (!nowWalls.has(i) && hp > 0) {
        const cx = (i % g0.w + 0.5) * CELL, cy = ((i / g0.w | 0) + 0.5) * CELL;
        this.effects.burst(cx, cy, '#a8a8c4', 1.3); this.effects.addShake(3); // wall shattered
      }
    }
    this.prevWalls = nowWalls;

    // tower-fire beams (throttled per tower)
    if (this.game.state === 'wave') {
      for (const t of sim.liveTowers()) {
        const timer = (this.fireTimers.get(t.id) ?? 0) + dt;
        if (timer < 0.08) { this.fireTimers.set(t.id, timer); continue; }
        const target = this.beamTarget(t);
        if (target) {
          const c = cellCenter(t.cell);
          this.effects.beam(c.x, c.y, fxToFloat(target.pos.x) * CELL, fxToFloat(target.pos.y) * CELL, ELEMENT_COLOR[t.element]);
          this.fireTimers.set(t.id, 0);
        } else this.fireTimers.set(t.id, timer);
      }
    }

    // ambient motes
    this.moteTimer += dt;
    if (this.moteTimer > 0.35) {
      this.moteTimer = 0;
      const g = sim.grid;
      this.effects.ambientMote(g.w * CELL, g.h * CELL, ELEMENT_COLOR[Math.floor(Math.random() * N_ELEMENTS) as Element]);
    }
  }

  /** Approx of the sim's acquisition, for drawing a beam (nearest hittable mob in range). */
  private beamTarget(t: Tower): Mob | null {
    const sim = this.game.sim;
    const cx = t.cell.x + 0.5, cy = t.cell.y + 0.5;
    const range = fxToFloat(t.range);
    let best: Mob | null = null, bestD = range * range;
    for (const m of sim.liveMobs()) {
      if (m.flags.flier && !t.flags.antiAir) continue;
      if (m.flags.stealth && !t.flags.detection && !this.revealed(m)) continue;
      const dx = fxToFloat(m.pos.x) - cx, dy = fxToFloat(m.pos.y) - cy;
      const d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = m; }
    }
    return best;
  }

  private revealed(m: Mob): boolean {
    const mx = fxToFloat(m.pos.x), my = fxToFloat(m.pos.y);
    for (const z of this.game.sim.activeEffects()) {
      if (z.kind !== 'reveal') continue;
      const dx = z.x - mx, dy = z.y - my;
      if (dx * dx + dy * dy <= z.r * z.r) return true;
    }
    return false;
  }

  private render(): void {
    const [sx, sy] = this.effects.shakeXY();
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(sx, sy);
    this.drawBoard();
    this.effects.draw(ctx);
    ctx.restore();
    this.drawHud();
    this.drawTelegraph();
    for (const b of this.paletteButtons) b.refresh();
    this.el.palette.style.display = this.game.state === 'build' ? 'flex' : 'none';
    this.renderControls();
    if (this.game.state === 'gameover') this.showGameOver();
  }

  // ---- HUD / DOM text -------------------------------------------------------------

  private drawHud(): void {
    const g = this.game;
    this.el.currency.innerHTML = `<b>◈</b> ${g.currency}`;
    const foe = g.opponent === 'model' ? '🧠 net' : g.opponent === 'strategist' ? '👁 mind' : '🔍 search';
    this.el.wavelabel.textContent = `Wave ${g.wave} · R${g.diff} · ${foe}`;
    const frac = g.coreHpFraction();
    const fill = this.el.corefill as HTMLElement;
    fill.style.width = Math.round(frac * 100) + '%';
    fill.style.background = frac > 0.5 ? 'linear-gradient(90deg,#3ad6a0,#7CFFB2)' : frac > 0.25 ? 'linear-gradient(90deg,#e0a92e,#ffd23f)' : 'linear-gradient(90deg,#c23a2a,#ff5a4d)';
    this.el.corelabel.textContent = `${Math.max(0, Math.round(fxToFloat(g.coreHp())))} / ${Math.round(fxToFloat(g.coreHpMax()))}`;
  }

  private drawTelegraph(): void {
    const t = this.el.telegraph;
    const w = this.game.sim.grid.w;
    t.classList.toggle('wt-scry', this.game.state === 'build' && this.game.planned);
    if (this.game.state === 'build' && this.game.planned) {
      t.style.display = 'block';
      const intent = this.game.attackerIntent;
      this.setHTML(t, (intent ? `<i class="wt-intent">${intent}</i>` : '')
        + '<b>Scried:</b> ' + formatTelegraph(this.game.telegraph, w) + this.threatBrief());
    } else if (this.game.state === 'build' && this.game.lastRecap) {
      t.style.display = 'block';
      this.setHTML(t, formatRecap(this.game.lastRecap, w));
    } else if (this.game.state === 'wave') {
      t.style.display = 'block';
      const n = this.game.verbsLeft;
      const hint = this.verbTool ? `tap the board to <b>${this.verbTool}</b>` : `${n} tactical tap${n === 1 ? '' : 's'} left`;
      this.setHTML(t, `<em>${hint}</em>`);
    } else t.style.display = 'none';
  }

  /** A per-wave "know your foe" brief: each distinct summon type in the scried opener and
   *  how to defend against it. Plain Wisps are only listed if they're the whole wave. */
  private threatBrief(): string {
    const traits = new Set(this.game.telegraph.map((s) => s.group.trait));
    const list = [...traits]
      .filter((tr) => tr !== Trait.Grunt || traits.size === 1)
      .map((tr) => `<div class="wt-threat"><b>${TRAIT_CREATURE[tr]}</b> — ${TRAIT_COUNTER[tr]}</div>`)
      .join('');
    return list ? `<div class="wt-brief">${list}</div>` : '';
  }

  private showGameOver(): void {
    if (this.overShown) return;
    this.overShown = true;
    const o = this.el.overlay;
    o.style.display = 'flex';
    o.innerHTML = `<div class="wt-go"><h2>The Core is shattered</h2>
      <p>You held <b>${this.game.highestWave - 1}</b> wave${this.game.highestWave - 1 === 1 ? '' : 's'}.</p>
      <button class="wt-ctl wt-primary" id="restart">Choose a discipline</button></div>`;
    o.querySelector<HTMLButtonElement>('#restart')!.onclick = () => this.showStart();
  }

  // ---- board rendering ------------------------------------------------------------

  private drawBoard(): void {
    const g = this.game.sim.grid;
    const ctx = this.ctx;
    const W = g.w * CELL, H = g.h * CELL;
    ctx.clearRect(0, 0, W, H);
    this.drawBackground(W, H);

    // buildable tint + spawn rift
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const info = g.cells[y * g.w + x];
      if (info.occ.kind === OccKind.Spawn) {
        ctx.fillStyle = 'rgba(120,60,110,0.18)';
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      } else if (info.buildable && this.hover && this.hover.x === x && this.hover.y === y && this.game.state === 'build') {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
      }
    }

    // walls
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const occ = g.cells[y * g.w + x].occ;
      if (occ.kind === OccKind.Wall) this.drawWall(x, y, fxToFloat(occ.hp) / fxToFloat(WALL_HP));
    }

    // verb zones (under entities) — a spell inscription: rune circle + a central glyph
    for (const z of this.game.sim.activeEffects()) {
      const col = z.kind === 'overcharge' ? '#ffe14d' : '#5fd0ff';
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
      const zx = z.x * CELL, zy = z.y * CELL, zr = z.r * CELL;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = col; ctx.globalAlpha = 0.25 + 0.25 * pulse; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(zx, zy, zr, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.06; ctx.fillStyle = col; ctx.fill();
      // rotating inner summoning ring
      ctx.globalAlpha = 0.3 + 0.2 * pulse; ctx.lineWidth = 1.2;
      ctx.save(); ctx.translate(zx, zy); ctx.rotate(this.time * (z.kind === 'overcharge' ? 1.2 : -0.8));
      ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(0, 0, zr * 0.6, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      // central sigil: an empowering star (overcharge) or a scrying eye (reveal)
      ctx.globalAlpha = 0.6 + 0.4 * pulse;
      if (z.kind === 'overcharge') {
        for (let i = 0; i < 4; i++) { const a = i * TAU / 4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 7, Math.sin(a) * 7); ctx.stroke(); }
      } else {
        ctx.beginPath(); ctx.moveTo(-8, 0); ctx.quadraticCurveTo(0, -5, 8, 0); ctx.quadraticCurveTo(0, 5, -8, 0); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, TAU); ctx.stroke();
      }
      ctx.restore();
      ctx.restore();
    }

    this.drawCore(g.coreCell());

    for (const t of this.game.sim.liveTowers()) this.drawTower(t);
    for (const m of this.game.sim.liveMobs()) this.drawMob(m);
  }

  private drawBackground(W: number, H: number): void {
    const ctx = this.ctx;
    const grad = ctx.createRadialGradient(W / 2, H * 0.42, 20, W / 2, H * 0.42, H * 0.75);
    grad.addColorStop(0, '#12132b');
    grad.addColorStop(0.7, '#0a0a1a');
    grad.addColorStop(1, '#06060f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // ley-line grid, faintly shimmering
    const shimmer = 0.05 + 0.03 * Math.sin(this.time * 1.5);
    ctx.strokeStyle = `rgba(120,120,200,${this.reduced ? 0.06 : shimmer})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += CELL) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += CELL) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  private drawWall(x: number, y: number, frac: number): void {
    const ctx = this.ctx;
    const px = x * CELL + 4, py = y * CELL + 4, s = CELL - 8;
    const lit = 0.55 + 0.45 * Math.max(0.15, frac); // damaged runestone darkens
    const cx = px + s / 2, cy = py + s / 2;
    // carved stone body — a top-lit gradient for depth
    const grad = ctx.createLinearGradient(px, py, px, py + s);
    grad.addColorStop(0, `rgba(126,128,158,${0.9 * lit})`);
    grad.addColorStop(1, `rgba(66,68,96,${0.9 * lit})`);
    ctx.fillStyle = grad;
    roundRect(ctx, px, py, s, s, 6); ctx.fill();
    // beveled inner edge (chiselled) + dark outer seam
    ctx.strokeStyle = `rgba(190,192,225,${0.32 * lit})`; ctx.lineWidth = 1.5;
    roundRect(ctx, px + 2.5, py + 2.5, s - 5, s - 5, 4); ctx.stroke();
    ctx.strokeStyle = 'rgba(16,16,30,0.55)'; ctx.lineWidth = 1;
    roundRect(ctx, px, py, s, s, 6); ctx.stroke();
    // a glowing containment bind-rune etched in the face (pulses; fades as it cracks)
    const glow = (0.32 + 0.18 * Math.sin(this.time * 2 + x * 1.3 + y)) * Math.max(0.18, frac);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = glow;
    ctx.strokeStyle = '#8fa6ff'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.24); ctx.lineTo(cx, cy + s * 0.24);
    ctx.moveTo(cx, cy - s * 0.06); ctx.lineTo(cx + s * 0.17, cy - s * 0.2);
    ctx.moveTo(cx, cy + s * 0.06); ctx.lineTo(cx - s * 0.17, cy + s * 0.2);
    ctx.stroke();
    ctx.restore();
    // fractures deepen as it's chewed down
    if (frac < 0.9) {
      ctx.strokeStyle = `rgba(10,10,20,${0.4 + 0.4 * (1 - frac)})`; ctx.lineWidth = 1 + (1 - frac);
      ctx.beginPath(); ctx.moveTo(px + s * 0.34, py + 1); ctx.lineTo(px + s * 0.52, py + s * 0.55); ctx.lineTo(px + s * 0.36, py + s - 1); ctx.stroke();
      if (frac < 0.55) { ctx.beginPath(); ctx.moveTo(px + s - 1, py + s * 0.4); ctx.lineTo(px + s * 0.56, py + s * 0.5); ctx.lineTo(px + s * 0.8, py + s - 1); ctx.stroke(); }
    }
    // integrity bar while damaged
    if (frac < 0.999) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(px, py + s + 1, s, 3);
      ctx.fillStyle = frac > 0.4 ? '#8fd6ff' : '#ff9a4d'; ctx.fillRect(px, py + s + 1, s * frac, 3);
    }
  }

  private drawCore(cell: Cell): void {
    const ctx = this.ctx;
    const c = cellCenter(cell);
    const frac = this.game.coreHpFraction();
    const col = frac > 0.5 ? '#7CFFB2' : frac > 0.25 ? '#ffd23f' : '#ff5a4d';
    const pulse = this.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(this.time * 2.2);
    ctx.save();
    ctx.translate(c.x, c.y);
    // halo
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, CELL * (0.95 + 0.15 * pulse));
    halo.addColorStop(0, col); halo.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.32 + 0.2 * pulse; ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, CELL, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // two counter-rotating rune rings
    for (const [dir, rad, dash] of [[1, 0.52, [4, 7]], [-1, 0.44, [2, 5]]] as const) {
      ctx.save(); ctx.rotate(this.reduced ? 0 : dir * this.time * 0.5);
      ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.4; ctx.setLineDash(dash as unknown as number[]);
      ctx.beginPath(); ctx.arc(0, 0, CELL * rad, 0, TAU); ctx.stroke(); ctx.restore();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // the Heartstone's eye — an arcane lens that reddens as it fails
    const ew = CELL * 0.4, eh = CELL * 0.24;
    ctx.beginPath();
    ctx.moveTo(-ew, 0); ctx.quadraticCurveTo(0, -eh, ew, 0); ctx.quadraticCurveTo(0, eh, -ew, 0); ctx.closePath();
    ctx.fillStyle = '#0a0b18'; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
    // iris + slit pupil
    ctx.fillStyle = col; ctx.globalAlpha = 0.5 + 0.4 * pulse;
    ctx.beginPath(); ctx.arc(0, 0, eh * 0.82, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = '#06060f';
    ctx.beginPath(); ctx.ellipse(0, 0, eh * 0.22, eh * 0.7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc(-eh * 0.25, -eh * 0.25, eh * 0.12, 0, TAU); ctx.fill();
    // fracture lines when the Heart is failing
    if (frac < 0.5) {
      ctx.globalAlpha = 1; ctx.strokeStyle = '#ff5a4d'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ew * 0.3, -eh * 0.6); ctx.lineTo(ew * 0.5, 0); ctx.lineTo(ew * 0.35, eh * 0.7); ctx.stroke();
    }
    ctx.restore();
  }

  private drawTower(t: Tower): void {
    const ctx = this.ctx;
    const c = cellCenter(t.cell);
    const col = ELEMENT_COLOR[t.element];
    const range = fxToFloat(t.range) * CELL;
    const bob = this.reduced ? 0 : Math.sin(this.time * 2 + t.id) * 1.5;
    // range aura when building
    if (this.game.state === 'build') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = col; ctx.globalAlpha = 0.04;
      ctx.beginPath(); ctx.arc(c.x, c.y, range, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.12; ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(c.x, c.y, range, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(c.x, c.y + bob);
    // floating shadow
    ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(0, CELL * 0.36 - bob, CELL * 0.22, CELL * 0.08, 0, 0, TAU); ctx.fill(); ctx.restore();
    // outer binding rune-ring (rotating), the sigil that holds the ward
    const rr = CELL * 0.34;
    ctx.save(); ctx.rotate(this.reduced ? 0 : this.time * 0.6);
    ctx.strokeStyle = col; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 0.8;
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.beginPath(); ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); ctx.lineTo(Math.cos(a) * (rr + 4), Math.sin(a) * (rr + 4)); ctx.stroke(); }
    ctx.restore();
    // bound orb
    ctx.shadowColor = col; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(0, 0, CELL * 0.22, 0, TAU);
    ctx.fillStyle = '#0e0f22'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke();
    ctx.shadowBlur = 0;
    drawElementGlyph(ctx, t.element, CELL * 0.12, col);
    // tier satellites orbiting
    for (let i = 0; i < t.tier; i++) {
      const a = this.time * 1.4 + i * TAU / t.tier;
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(Math.cos(a) * (rr + 3), Math.sin(a) * (rr + 3), 2.2, 0, TAU); ctx.fill();
    }
    // anti-air: a bright up-chevron badge (+ orbiting rune); detection: a scrying-eye badge.
    if (t.flags.antiAir) {
      const a = -this.time * 2.4;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(Math.cos(a) * (rr + 7), Math.sin(a) * (rr + 7), 1.8, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#eaf2ff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-4, -rr - 5); ctx.lineTo(0, -rr - 9); ctx.lineTo(4, -rr - 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4, -rr - 9); ctx.lineTo(0, -rr - 13); ctx.lineTo(4, -rr - 9); ctx.stroke();
    }
    if (t.flags.detection) {
      const a = this.time * 2;
      ctx.strokeStyle = '#ffe8a3'; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, rr - 3, a, a + 1.1); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-5, -rr - 8); ctx.quadraticCurveTo(0, -rr - 12, 5, -rr - 8); ctx.quadraticCurveTo(0, -rr - 4, -5, -rr - 8); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -rr - 8, 1.4, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  private drawMob(m: Mob): void {
    const ctx = this.ctx;
    const x = fxToFloat(m.pos.x) * CELL, y = fxToFloat(m.pos.y) * CELL;
    const r = TRAIT_RADIUS[m.trait] * CELL;
    const col = ELEMENT_COLOR[m.element];
    const flier = m.flags.flier;
    const bob = this.reduced ? 0 : Math.sin(this.time * 4 + m.id) * (flier ? 3 : 1);
    const lift = flier ? 11 : 0; // fliers hover clearly above their ground shadow

    ctx.save();
    ctx.translate(x, y + bob - lift);
    if (flier) { // a ground shadow + a tether line so it reads unmistakably as airborne
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, r * 0.4); ctx.lineTo(0, lift + 4 - bob); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(0, lift + 5 - bob, r * 0.75, r * 0.26, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    const hidden = m.flags.stealth && !this.revealed(m);
    if (hidden) ctx.globalAlpha = 0.36 + 0.12 * Math.sin(this.time * 8 + m.id); // a visible ghost, still untargetable
    ctx.shadowColor = col; ctx.shadowBlur = 10;
    paintCreature(ctx, r, col, m.element, m.trait, this.time + m.id * 0.7, { warded: m.shieldHits > 0 });
    if (hidden) { // a cloaking veil ring — reads as "here but untargetable until revealed"
      ctx.shadowBlur = 0; ctx.globalAlpha = 0.6; ctx.setLineDash([2, 3]);
      ctx.strokeStyle = '#c9a2ff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();

    // HP arc over the head (follows the flier's lift)
    const hp = Math.max(0, fxToFloat(m.hp) / fxToFloat(m.maxHp));
    if (hp < 0.999) {
      ctx.save(); ctx.translate(x, y + bob - lift);
      ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.arc(0, 0, r + 5, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      ctx.strokeStyle = hp > 0.4 ? '#7CFFB2' : '#ff5a4d';
      ctx.beginPath(); ctx.arc(0, 0, r + 5, Math.PI * 1.15, Math.PI * (1.15 + 0.7 * hp)); ctx.stroke();
      ctx.restore();
    }
  }
}

// ---- helpers ----------------------------------------------------------------------

function cellCenter(c: Cell): { x: number; y: number } {
  return { x: c.x * CELL + CELL / 2, y: c.y * CELL + CELL / 2 };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const DARK_INK = '#0c0d1e';

/** Draw a small element rune centred at the origin (used on the bound wardens). */
function drawElementGlyph(ctx: CanvasRenderingContext2D, element: Element, s: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (element) {
    case Element.Fire:
      ctx.beginPath(); ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(s * 0.75, -s * 0.15, s * 0.35, s * 0.7);
      ctx.quadraticCurveTo(s * 0.5, s * 0.1, 0, s * 0.85);
      ctx.quadraticCurveTo(-s * 0.5, s * 0.1, -s * 0.35, s * 0.7);
      ctx.quadraticCurveTo(-s * 0.75, -s * 0.15, 0, -s); ctx.fill();
      break;
    case Element.Ice:
      for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(-Math.cos(a) * s, -Math.sin(a) * s); ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s); ctx.stroke(); }
      break;
    case Element.Earth:
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0); ctx.closePath(); ctx.fill();
      break;
    case Element.Sonic:
      for (const rr of [0.55, 0.95]) { ctx.beginPath(); ctx.arc(-s * 0.3, 0, s * rr, -0.7, 0.7); ctx.stroke(); }
      break;
    case Element.Zap:
      ctx.beginPath(); ctx.moveTo(s * 0.3, -s); ctx.lineTo(-s * 0.4, s * 0.1); ctx.lineTo(s * 0.05, s * 0.1); ctx.lineTo(-s * 0.3, s); ctx.lineTo(s * 0.5, -s * 0.2); ctx.lineTo(0, -s * 0.2); ctx.closePath(); ctx.fill();
      break;
    case Element.Light:
      ctx.beginPath(); ctx.arc(0, 0, s * 0.4, 0, TAU); ctx.fill();
      for (let i = 0; i < 8; i++) { const a = i * TAU / 8; ctx.beginPath(); ctx.moveTo(Math.cos(a) * s * 0.6, Math.sin(a) * s * 0.6); ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s); ctx.stroke(); }
      break;
    case Element.Dark:
      ctx.beginPath(); ctx.arc(s * 0.2, 0, s, Math.PI * 0.5, Math.PI * 1.5);
      ctx.arc(-s * 0.15, 0, s * 0.85, Math.PI * 1.5, Math.PI * 0.5, true); ctx.closePath(); ctx.fill();
      break;
  }
  ctx.restore();
}

/**
 * Draw a conjured creature centred at the current origin. Shared by the board (per mob)
 * and the bestiary. Each mechanical trait manifests as an archetype (wisp/golem/wraith/…);
 * element supplies the colour and a small material accent so a "Void Wraith" and an
 * "Ember Wraith" read as the same beast woven from different magic.
 */
function paintCreature(
  ctx: CanvasRenderingContext2D, r: number, color: string, element: Element, trait: Trait,
  t: number, opts: { warded?: boolean } = {},
): void {
  const shape: MobShape = TRAIT_SHAPE[trait];
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  const eye = (x: number, y: number, s: number, bright = false) => {
    ctx.save(); ctx.shadowBlur = 0; ctx.fillStyle = bright ? '#fff' : DARK_INK;
    ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill(); ctx.restore();
  };

  switch (shape) {
    case 'wisp': { // a floating spirit with a wavering tail and a single eye
      const sway = Math.sin(t * 3) * r * 0.18;
      ctx.beginPath();
      ctx.moveTo(-r * 0.78, r * 0.1);
      ctx.quadraticCurveTo(-r * 0.85, -r * 0.9, sway, -r * 1.25);
      ctx.quadraticCurveTo(r * 0.85, -r * 0.9, r * 0.78, r * 0.1);
      ctx.arc(0, r * 0.1, r * 0.78, 0, Math.PI);
      ctx.closePath(); ctx.fill();
      eye(0, -r * 0.05, r * 0.26); eye(-r * 0.08, -r * 0.12, r * 0.09, true);
      break;
    }
    case 'swarm': { // a cluster of conjured sparks
      for (let i = 0; i < 5; i++) {
        const a = t * 2 + i * TAU / 5, px = Math.cos(a) * r * 0.85, py = Math.sin(a * 1.3) * r * 0.65, s = r * 0.5;
        ctx.beginPath();
        ctx.moveTo(px, py - s); ctx.lineTo(px + s * 0.28, py - s * 0.28); ctx.lineTo(px + s, py);
        ctx.lineTo(px + s * 0.28, py + s * 0.28); ctx.lineTo(px, py + s); ctx.lineTo(px - s * 0.28, py + s * 0.28);
        ctx.lineTo(px - s, py); ctx.lineTo(px - s * 0.28, py - s * 0.28); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'golem': { // a hulking elemental construct with runic seams
      ctx.beginPath();
      const pts = [[-1, -0.75], [-0.55, -0.95], [0.6, -0.9], [1, -0.5], [0.95, 0.7], [0.5, 0.95], [-0.6, 0.9], [-1, 0.55]];
      pts.forEach(([px, py], i) => ctx[i ? 'lineTo' : 'moveTo'](px * r, py * r));
      ctx.closePath(); ctx.fill();
      ctx.save(); ctx.shadowBlur = 0; ctx.strokeStyle = DARK_INK; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-r * 0.2, -r * 0.9); ctx.lineTo(0, -r * 0.1); ctx.lineTo(-r * 0.3, r * 0.9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.5, -r * 0.6); ctx.lineTo(r * 0.1, 0); ctx.stroke(); ctx.restore();
      eye(-r * 0.34, -r * 0.12, r * 0.15, true); eye(r * 0.34, -r * 0.12, r * 0.15, true);
      break;
    }
    case 'dart': { // a low, fast hound with a motion streak
      ctx.save(); ctx.shadowBlur = 0; ctx.globalAlpha *= 0.35;
      ctx.beginPath(); ctx.moveTo(-r * 0.4, -r * 1.4); ctx.lineTo(r * 0.4, -r * 1.4); ctx.lineTo(0, -r * 0.2); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(0, r * 1.15); ctx.lineTo(-r * 0.7, -r * 0.2); ctx.lineTo(-r * 0.28, -r * 0.05);
      ctx.lineTo(0, -r * 0.7); ctx.lineTo(r * 0.28, -r * 0.05); ctx.lineTo(r * 0.7, -r * 0.2);
      ctx.closePath(); ctx.fill();
      eye(0, r * 0.35, r * 0.12);
      break;
    }
    case 'wing': { // a winged drake — wings, serpent body, small head, tail
      const flap = Math.sin(t * 10) * 0.35;
      ctx.save(); ctx.globalAlpha *= 0.85;
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(0, -r * 0.1);
        ctx.quadraticCurveTo(s * r * 1.5, -r * (0.9 + flap), s * r * 1.7, -r * 0.1 + flap * r);
        ctx.quadraticCurveTo(s * r * 1.1, r * 0.1, 0, r * 0.25); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.42, r * 0.62, 0, 0, TAU); ctx.fill(); // body
      ctx.beginPath(); ctx.moveTo(0, r * 0.5); ctx.lineTo(-r * 0.3, r * 0.9); ctx.lineTo(r * 0.3, r * 0.9); ctx.closePath(); ctx.fill(); // head
      eye(-r * 0.12, r * 0.7, r * 0.07, true); eye(r * 0.12, r * 0.7, r * 0.07, true);
      break;
    }
    case 'shade': { // a hooded wraith with glowing eyes and a tattered hem
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.25);
      ctx.quadraticCurveTo(r * 0.95, -r * 0.6, r * 0.8, r * 0.5);
      for (let i = 3; i >= -3; i--) { const px = (i / 3) * r * 0.8, py = r * (0.55 + 0.28 * (i & 1) + 0.1 * Math.sin(t * 4 + i)); ctx.lineTo(px, py); }
      ctx.quadraticCurveTo(-r * 0.95, -r * 0.6, 0, -r * 1.25);
      ctx.closePath(); ctx.fill();
      eye(-r * 0.24, -r * 0.35, r * 0.11, true); eye(r * 0.24, -r * 0.35, r * 0.11, true);
      break;
    }
    case 'ward': { // a warded sentinel eye
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.72, r * 0.5, 0, 0, TAU); ctx.fill();
      ctx.save(); ctx.shadowBlur = 0; ctx.fillStyle = DARK_INK;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, TAU); ctx.fill(); ctx.restore();
      eye(0, 0, r * 0.12, true);
      if (opts.warded) {
        ctx.save(); ctx.shadowBlur = 0; ctx.globalAlpha *= 0.9; ctx.strokeStyle = '#8fd6ff'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) { const a = t + i * TAU / 6, rr = r + 3; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.stroke(); ctx.restore();
      }
      break;
    }
    case 'rune': { // a robed acolyte with a healing halo
      ctx.beginPath(); ctx.moveTo(0, -r * 0.15); ctx.lineTo(-r * 0.9, r); ctx.lineTo(r * 0.9, r); ctx.closePath(); ctx.fill(); // robe
      ctx.beginPath(); ctx.arc(0, -r * 0.5, r * 0.4, 0, TAU); ctx.fill(); // hood
      ctx.save(); ctx.shadowBlur = 0; ctx.fillStyle = DARK_INK; ctx.beginPath(); ctx.arc(0, -r * 0.5, r * 0.26, 0, TAU); ctx.fill(); ctx.restore();
      ctx.save(); ctx.shadowBlur = 0; ctx.globalAlpha *= 0.5; ctx.strokeStyle = '#9fe38a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, -r * 0.5, r * 0.62 + 3 * Math.sin(t * 4), 0, TAU); ctx.stroke(); ctx.restore();
      break;
    }
    default: { // 'maul' — a hunched, horned gargoyle
      ctx.beginPath();
      ctx.moveTo(-r, r * 0.7); ctx.lineTo(-r * 0.8, -r * 0.2);
      ctx.lineTo(-r * 0.5, -r * 0.5); ctx.lineTo(-r * 0.2, -r * 0.85); ctx.lineTo(0, -r * 0.45);
      ctx.lineTo(r * 0.2, -r * 0.85); ctx.lineTo(r * 0.5, -r * 0.5);
      ctx.lineTo(r * 0.8, -r * 0.2); ctx.lineTo(r, r * 0.7);
      ctx.closePath(); ctx.fill();
      eye(-r * 0.28, -r * 0.15, r * 0.12); eye(r * 0.28, -r * 0.15, r * 0.12);
      break;
    }
  }

  elementAccent(ctx, r, element, color, t);
}

/** A small element-material flourish over a creature's body. */
function elementAccent(ctx: CanvasRenderingContext2D, r: number, element: Element, color: string, t: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowBlur = 0;
  ctx.fillStyle = color; ctx.strokeStyle = color;
  if (element === Element.Fire) { // ember tongues rising
    for (const s of [-1, 1]) {
      const fl = Math.sin(t * 9 + s) * r * 0.15;
      ctx.globalAlpha = 0.5; ctx.beginPath();
      ctx.moveTo(s * r * 0.35, -r * 1.0); ctx.quadraticCurveTo(s * r * 0.55 + fl, -r * 1.45, s * r * 0.25, -r * 1.6);
      ctx.quadraticCurveTo(s * r * 0.15, -r * 1.3, s * r * 0.35, -r * 1.0); ctx.fill();
    }
  } else if (element === Element.Zap) { // a crackle
    ctx.globalAlpha = 0.6 * (0.5 + 0.5 * Math.sin(t * 20)); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.8); ctx.lineTo(-r * 0.1, -r * 0.3); ctx.lineTo(-r * 0.35, -r * 0.1); ctx.lineTo(r * 0.4, r * 0.5); ctx.stroke();
  } else if (element === Element.Ice) { // a frost sparkle
    ctx.globalAlpha = 0.55; ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) { const a = t * 0.5 + i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(-Math.cos(a) * r * 0.5, -Math.sin(a) * r * 0.5); ctx.lineTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5); ctx.stroke(); }
  } else if (element === Element.Light) { // a soft corona
    ctx.globalAlpha = 0.3 + 0.15 * Math.sin(t * 3); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.1, 0, TAU); ctx.stroke();
  } else if (element === Element.Sonic) { // a resonance ripple
    ctx.globalAlpha = 0.3; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, r * (0.9 + 0.3 * ((t * 0.7) % 1)), 0, TAU); ctx.stroke();
  } else if (element === Element.Dark) { // a void core
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.7; ctx.fillStyle = '#05030f';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

const side = (x: number, w: number) => (x < w / 3 ? 'left' : x >= (2 * w) / 3 ? 'right' : 'centre');

function counterHint(trait: Trait): string {
  if (trait === Trait.Flier) return ' <b class="wt-warn">↑ needs anti-air</b>';
  if (trait === Trait.Shade) return ' <b class="wt-warn">◉ needs detection</b>';
  return '';
}

function formatTelegraph(opener: Opener, w: number): string {
  return opener
    .map((s) => `${s.group.count}× ${ELEMENT_EMOJI[s.group.element]} ${creatureName(s.group.element, s.group.trait)}${counterHint(s.group.trait)} <em>(${side(s.x, w)})</em>`)
    .join(', ') || '(nothing)';
}

function formatRecap(recap: Recap, w: number): string {
  const reserve = recap.committed.flat()
    .map((c) => `${c.group.count}× ${ELEMENT_EMOJI[c.group.element]} ${creatureName(c.group.element, c.group.trait)}${c.kind === 'breach' ? ' ⚒' : ''} <em>(${side(c.x, w)})</em>`)
    .join(', ') || 'nothing (held back)';
  const leaked = Math.round(fxToFloat(recap.metrics.leakedHp));
  return `<b>Wave ${recap.wave}:</b> scried ${formatTelegraph(recap.telegraph, w)} · reserve struck ${reserve} · leaked ${leaked}${recap.metrics.breaches ? ` · ${recap.metrics.breaches} breach` : ''}`;
}
