/**
 * GameView — the browser consumer. It renders the Game on a canvas and wires touch/mouse
 * controls; the sim stays headless (this is the only file that knows about pixels). Board →
 * canvas (atmosphere, arcane Core, sigil-stone towers, per-trait mob silhouettes, beams,
 * particles); HUD, palette, controls, codex → DOM.
 */
import { fxToFloat } from '../src/fx.ts';
import { Element, ELEMENT_NAMES, N_ELEMENTS } from '../src/element.ts';
import { Trait, TRAIT_NAMES, Tier, NodeKind, OccKind, type Cell, type Mob, type Tower } from '../src/types.ts';
import { WALL_COST, WALL_HP, towerCost, tierGateCost, attuneCost } from '../src/config.ts';
import { Game, type Opponent, type Personality, type Recap } from '../src/game.ts';
import type { Opener } from '../src/wave.ts';
import { ELEMENT_COLOR, ELEMENT_EMOJI, TRAIT_SHAPE, TRAIT_RADIUS } from './theme.ts';
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
  private startingChoice: Element = Element.Fire;
  private diffChoice = 3;
  private opponentChoice: Opponent = 'search';
  private personalityChoice: Personality = 'balanced';
  private seed = 1n;

  // per-frame effect bookkeeping
  private prevMobs = new Map<number, { x: number; y: number; color: string }>();
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
    this.newGame();
    requestAnimationFrame(this.frame);
  }

  // ---- DOM scaffolding ------------------------------------------------------------

  private buildDom(): void {
    this.root.innerHTML = `
      <div class="wt">
        <header class="wt-top">
          <img class="wt-mark" src="./art/affinity-sigil.svg" alt="" />
          <div class="wt-brand"><span class="wt-title">WIZ<i>·</i>TOWER</span><span class="wt-sub">arcane affinity defense</span></div>
          <button class="wt-codexbtn" id="codexbtn" title="Affinity codex">✦</button>
        </header>
        <div class="wt-setup" id="setup"></div>
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
      </div>`;
    const byId = (id: string) => this.root.querySelector<HTMLElement>('#' + id)!;
    for (const id of ['setup', 'currency', 'corefill', 'corelabel', 'wavelabel', 'overlay', 'codex', 'telegraph', 'palette', 'controls']) {
      this.el[id] = byId(id);
    }
    this.canvas = byId('board') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.addEventListener('pointerdown', (e) => this.onBoardClick(e));
    this.canvas.addEventListener('pointermove', (e) => { this.hover = this.cellAt(e); });
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; });
    byId('codexbtn').onclick = () => this.toggleCodex();
    this.buildSetup();
  }

  private toggleCodex(): void {
    const c = this.el.codex;
    if (c.style.display === 'flex') { c.style.display = 'none'; return; }
    c.style.display = 'flex';
    c.innerHTML = `<div class="wt-codex-in">
      <img src="./art/affinity-sigil.svg" alt="Affinity wheel" />
      <p>Each element <b>counters the next</b> around the wheel (1.5× damage) and is weak to the one before (0.5×). <b>Light ⇄ Dark</b> are a mutual pair — the only strong answer to one is the other. Everything else is neutral. Read your foe's colors; attack the type you answer weakly.</p>
      <button class="wt-ctl" id="codexclose">Close</button></div>`;
    c.querySelector<HTMLButtonElement>('#codexclose')!.onclick = () => { c.style.display = 'none'; };
    c.onclick = (e) => { if (e.target === c) c.style.display = 'none'; };
  }

  private buildSetup(): void {
    const s = this.el.setup;
    s.innerHTML = '';
    const label = (t: string) => { const n = document.createElement('span'); n.textContent = t; n.className = 'wt-lbl'; s.appendChild(n); };
    const chip = (text: string, title: string, on: () => void) => {
      const b = document.createElement('button'); b.textContent = text; b.title = title; b.className = 'wt-chip'; b.onclick = on; s.appendChild(b);
    };
    label('Attune');
    for (let e = 0; e < N_ELEMENTS; e++) chip(ELEMENT_EMOJI[e as Element], ELEMENT_NAMES[e], () => { this.startingChoice = e as Element; this.newGame(); });
    label('Rank');
    for (let d = 1; d <= 5; d++) chip(String(d), `difficulty ${d}`, () => { this.diffChoice = d; this.newGame(); });
    label('Foe');
    chip('Search', 'Live branching search (L2)', () => { this.opponentChoice = 'search'; this.newGame(); });
    chip('Net', 'Distilled tiny net', () => { this.opponentChoice = 'model'; this.newGame(); });
    label('Style');
    const styleLabel: Record<Personality, string> = { balanced: 'Bal', aggressive: 'Agg', economic: 'Eco', bluffy: 'Blf' };
    for (const p of ['balanced', 'aggressive', 'economic', 'bluffy'] as const) chip(styleLabel[p], `${p} attacker (search only)`, () => { this.personalityChoice = p; this.newGame(); });
  }

  private newGame(): void {
    this.seed = (this.seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    this.game = new Game({
      starting: this.startingChoice, difficulty: this.diffChoice, seed: this.seed,
      opponent: this.opponentChoice, personality: this.personalityChoice,
    });
    this.tool = { kind: 'wall' };
    this.verbTool = null;
    this.tier = Tier.T1;
    this.speed = 1;
    this.effects = new Effects(this.reduced);
    this.prevMobs.clear();
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
      (b) => { b.innerHTML = `🧱<small>${WALL_COST}</small>`; b.disabled = this.game.currency < WALL_COST; },
      () => this.tool?.kind === 'wall');

    for (let e = 0; e < N_ELEMENTS; e++) {
      const el = e as Element;
      add(() => this.onElementTool(el), (b) => this.refreshElementBtn(b, el),
        () => this.tool?.kind === 'tower' && this.tool.element === el, 'wt-elem');
    }

    add(() => { this.tool = { kind: 'sell' }; }, (b) => { b.innerHTML = '❌'; }, () => this.tool?.kind === 'sell');

    const tierBtn = document.createElement('button');
    tierBtn.className = 'wt-tool wt-tier';
    tierBtn.onclick = () => { this.tier = ((this.tier % 3) + 1) as Tier; this.controlsKey = ''; };
    p.appendChild(tierBtn);
    this.paletteButtons.push({ node: tierBtn, refresh: () => { tierBtn.innerHTML = `<small>tier</small>T${this.tier}`; } });
  }

  private refreshElementBtn(b: HTMLButtonElement, el: Element): void {
    const pl = this.game.sim.player;
    b.style.setProperty('--el', ELEMENT_COLOR[el]);
    if (!pl.attuned[el]) {
      const cost = attuneCost(pl.attuneCount);
      b.innerHTML = `${ELEMENT_EMOJI[el]}<small>🔓${cost}</small>`;
      b.disabled = this.game.currency < cost || this.game.state !== 'build';
    } else {
      const cost = this.towerPrice(el);
      b.innerHTML = `${ELEMENT_EMOJI[el]}<small>${cost}</small>`;
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
        this.effects.shockwave(c.x, c.y, this.verbTool === 'overcharge' ? '#ffe14d' : this.verbTool === 'reveal' ? '#5fd0ff' : '#8fce77', 0.6);
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
    const dt = this.lastT ? Math.min(0.05, (t - this.lastT) / 1000) : 0;
    this.lastT = t;
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
    requestAnimationFrame(this.frame);
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
    this.el.wavelabel.textContent = `Wave ${g.wave} · R${g.diff} · ${g.opponent === 'model' ? '🧠 net' : '🔍 search'}`;
    const frac = g.coreHpFraction();
    const fill = this.el.corefill as HTMLElement;
    fill.style.width = Math.round(frac * 100) + '%';
    fill.style.background = frac > 0.5 ? 'linear-gradient(90deg,#3ad6a0,#7CFFB2)' : frac > 0.25 ? 'linear-gradient(90deg,#e0a92e,#ffd23f)' : 'linear-gradient(90deg,#c23a2a,#ff5a4d)';
    this.el.corelabel.textContent = `${Math.max(0, Math.round(fxToFloat(g.coreHp())))} / ${Math.round(fxToFloat(g.coreHpMax()))}`;
  }

  private drawTelegraph(): void {
    const t = this.el.telegraph;
    const w = this.game.sim.grid.w;
    t.classList.remove('wt-scry');
    if (this.game.state === 'build' && this.game.planned) {
      t.style.display = 'block'; t.classList.add('wt-scry');
      t.innerHTML = '<b>Scried:</b> ' + formatTelegraph(this.game.telegraph, w);
    } else if (this.game.state === 'build' && this.game.lastRecap) {
      t.style.display = 'block';
      t.innerHTML = formatRecap(this.game.lastRecap, w);
    } else if (this.game.state === 'wave') {
      t.style.display = 'block';
      const n = this.game.verbsLeft;
      const hint = this.verbTool ? `tap the board to <b>${this.verbTool}</b>` : `${n} tactical tap${n === 1 ? '' : 's'} left`;
      t.innerHTML = `<em>${hint}</em>`;
    } else t.style.display = 'none';
  }

  private showGameOver(): void {
    if (this.overShown) return;
    this.overShown = true;
    const o = this.el.overlay;
    o.style.display = 'flex';
    o.innerHTML = `<div class="wt-go"><h2>The Core is shattered</h2>
      <p>You held <b>${this.game.highestWave - 1}</b> wave${this.game.highestWave - 1 === 1 ? '' : 's'}.</p>
      <button class="wt-ctl wt-primary" id="restart">Begin anew</button></div>`;
    o.querySelector<HTMLButtonElement>('#restart')!.onclick = () => this.newGame();
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

    // verb zones (under entities)
    for (const z of this.game.sim.activeEffects()) {
      const col = z.kind === 'overcharge' ? '#ffe14d' : '#5fd0ff';
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = col; ctx.globalAlpha = 0.25 + 0.25 * pulse; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(z.x * CELL, z.y * CELL, z.r * CELL, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.06; ctx.fillStyle = col; ctx.fill();
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
    const px = x * CELL + 5, py = y * CELL + 5, s = CELL - 10;
    ctx.fillStyle = `rgba(140,140,170,${0.25 + 0.5 * Math.max(0.1, frac)})`;
    roundRect(ctx, px, py, s, s, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(200,200,230,0.25)'; ctx.lineWidth = 1;
    roundRect(ctx, px, py, s, s, 5); ctx.stroke();
    if (frac < 0.66) { // cracks as it's chewed down
      ctx.strokeStyle = 'rgba(20,20,30,0.6)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(px + s * 0.3, py); ctx.lineTo(px + s * 0.5, py + s * 0.6); ctx.lineTo(px + s * 0.35, py + s); ctx.stroke();
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
    // glow
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, CELL * (0.9 + 0.15 * pulse));
    halo.addColorStop(0, col); halo.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.35 + 0.2 * pulse; ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, CELL, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // rotating rune ring
    ctx.rotate(this.reduced ? 0 : this.time * 0.5);
    ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.arc(0, 0, CELL * 0.5, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.rotate(this.reduced ? 0 : -this.time * 0.5);
    // faceted crystal (hexagon)
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * TAU / 6, r = CELL * 0.34; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath();
    ctx.fillStyle = '#0c0d1e'; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    // inner light
    ctx.fillStyle = col; ctx.globalAlpha = 0.4 + 0.4 * pulse;
    ctx.beginPath(); ctx.arc(0, 0, CELL * 0.13, 0, TAU); ctx.fill();
    ctx.restore();
  }

  private drawTower(t: Tower): void {
    const ctx = this.ctx;
    const c = cellCenter(t.cell);
    const col = ELEMENT_COLOR[t.element];
    const range = fxToFloat(t.range) * CELL;
    // range aura when building / hovering this tower's cell
    if (this.game.state === 'build') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = col; ctx.globalAlpha = 0.04;
      ctx.beginPath(); ctx.arc(c.x, c.y, range, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.12; ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(c.x, c.y, range, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(c.x, c.y);
    // glow
    ctx.shadowColor = col; ctx.shadowBlur = 14;
    // sigil hexagon
    const r = CELL * 0.3;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * TAU / 6; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath();
    ctx.fillStyle = '#0e0f22'; ctx.fill();
    ctx.lineWidth = 2.2; ctx.strokeStyle = col; ctx.stroke();
    ctx.shadowBlur = 0;
    // element core dot
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(0, 0, CELL * 0.1, 0, TAU); ctx.fill();
    // tier crystals (stacked above)
    for (let i = 0; i < t.tier; i++) { ctx.fillRect(-1.5 + (i - (t.tier - 1) / 2) * 6, -r - 6, 3, 4); }
    // anti-air: orbiting rune; detection: scanning arc
    if (t.flags.antiAir) {
      const a = this.time * 3;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(Math.cos(a) * (r + 5), Math.sin(a) * (r + 5), 2, 0, TAU); ctx.fill();
    }
    if (t.flags.detection) {
      const a = this.time * 2;
      ctx.strokeStyle = '#ffe8a3'; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, r + 4, a, a + 1); ctx.stroke();
    }
    ctx.restore();
  }

  private drawMob(m: Mob): void {
    const ctx = this.ctx;
    const x = fxToFloat(m.pos.x) * CELL, y = fxToFloat(m.pos.y) * CELL;
    const r = TRAIT_RADIUS[m.trait] * CELL;
    const col = ELEMENT_COLOR[m.element];
    const shape = TRAIT_SHAPE[m.trait];
    const bob = this.reduced ? 0 : Math.sin(this.time * 4 + m.id) * (shape === 'wing' ? 3 : 1);

    ctx.save();
    ctx.translate(x, y + bob);
    ctx.shadowColor = col;
    ctx.shadowBlur = 10;
    ctx.fillStyle = col;
    ctx.strokeStyle = col;

    if (m.flags.flier) { // airborne shadow on the ground below
      ctx.save(); ctx.shadowBlur = 0; ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(0, r + 6 - bob, r * 0.8, r * 0.3, 0, 0, TAU); ctx.fill(); ctx.restore();
    }
    if (m.flags.stealth && !this.revealed(m)) ctx.globalAlpha = 0.28 + 0.12 * Math.sin(this.time * 8 + m.id);

    switch (shape) {
      case 'swarm': {
        for (let i = 0; i < 4; i++) { const a = this.time * 2 + i * TAU / 4; ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, r * 0.55, 0, TAU); ctx.fill(); }
        break;
      }
      case 'golem': {
        roundRect(ctx, -r, -r * 0.85, r * 2, r * 1.7, r * 0.35); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = '#0c0d1e';
        ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.1, r * 0.16, 0, TAU); ctx.arc(r * 0.35, -r * 0.1, r * 0.16, 0, TAU); ctx.fill();
        break;
      }
      case 'dart': { // triangle pointing toward Core (down)
        ctx.beginPath(); ctx.moveTo(0, r); ctx.lineTo(-r * 0.8, -r); ctx.lineTo(r * 0.8, -r); ctx.closePath(); ctx.fill();
        break;
      }
      case 'wing': {
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.6, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.6, 0); ctx.closePath(); ctx.fill();
        const flap = Math.sin(this.time * 10 + m.id) * 0.3;
        ctx.globalAlpha *= 0.8;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-r * 1.6, -r * 0.6 + flap * r); ctx.lineTo(-r * 0.6, r * 0.2); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 1.6, -r * 0.6 + flap * r); ctx.lineTo(r * 0.6, r * 0.2); ctx.closePath(); ctx.fill();
        break;
      }
      case 'shade': {
        ctx.beginPath(); ctx.moveTo(0, -r);
        for (let i = 1; i <= 8; i++) { const a = -Math.PI / 2 + i * TAU / 8, rr = r * (0.8 + 0.25 * Math.sin(this.time * 5 + i + m.id)); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'ward': {
        ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, TAU); ctx.fill();
        if (m.shieldHits > 0) {
          ctx.shadowBlur = 0; ctx.globalAlpha *= 0.9; ctx.strokeStyle = '#5fd0ff'; ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) { const a = this.time + i * TAU / 6, rr = r + 3; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); }
          ctx.closePath(); ctx.stroke();
        }
        break;
      }
      case 'rune': { // Mender — plus with healing halo
        const pw = r * 0.35;
        ctx.fillRect(-pw, -r, pw * 2, r * 2); ctx.fillRect(-r, -pw, r * 2, pw * 2);
        ctx.shadowBlur = 0; ctx.globalAlpha *= 0.4; ctx.strokeStyle = '#8fce77'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, r + 4 + 3 * Math.sin(this.time * 4), 0, TAU); ctx.stroke();
        break;
      }
      case 'maul': { // Breaker — chunky wedge
        ctx.beginPath(); ctx.moveTo(-r, -r * 0.6); ctx.lineTo(r * 0.4, -r * 0.6); ctx.lineTo(r, 0); ctx.lineTo(r * 0.4, r * 0.6); ctx.lineTo(-r, r * 0.6); ctx.closePath(); ctx.fill();
        break;
      }
      default: { // wisp (Grunt)
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = '#0c0d1e';
        ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.3, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();

    // HP arc over the head
    const hp = Math.max(0, fxToFloat(m.hp) / fxToFloat(m.maxHp));
    if (hp < 0.999) {
      ctx.save(); ctx.translate(x, y + bob);
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

const side = (x: number, w: number) => (x < w / 3 ? 'left' : x >= (2 * w) / 3 ? 'right' : 'centre');

function formatTelegraph(opener: Opener, w: number): string {
  return opener
    .map((s) => `${s.group.count}× ${ELEMENT_EMOJI[s.group.element]} ${TRAIT_NAMES[s.group.trait]} <em>(${side(s.x, w)})</em>`)
    .join(', ') || '(nothing)';
}

function formatRecap(recap: Recap, w: number): string {
  const reserve = recap.committed.flat()
    .map((c) => `${c.group.count}× ${ELEMENT_EMOJI[c.group.element]} ${TRAIT_NAMES[c.group.trait]}${c.kind === 'breach' ? ' ⚒' : ''} <em>(${side(c.x, w)})</em>`)
    .join(', ') || 'nothing (held back)';
  const leaked = Math.round(fxToFloat(recap.metrics.leakedHp));
  return `<b>Wave ${recap.wave}:</b> scried ${formatTelegraph(recap.telegraph, w)} · reserve struck ${reserve} · leaked ${leaked}${recap.metrics.breaches ? ` · ${recap.metrics.breaches} breach` : ''}`;
}
