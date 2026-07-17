/**
 * GameView — the browser consumer: it renders the Game's board on a canvas and wires
 * touch/mouse controls. The sim stays headless; this file is the only place that knows
 * about pixels. Board → canvas; HUD, build palette, and controls → DOM (free hit-testing).
 */
import { fxToFloat } from '../src/fx.ts';
import { Element, ELEMENT_NAMES, N_ELEMENTS } from '../src/element.ts';
import { Trait, TRAIT_NAMES, Tier, NodeKind, OccKind, type Cell } from '../src/types.ts';
import { WALL_COST, towerCost, tierGateCost, attuneCost } from '../src/config.ts';
import { Game, type Opponent } from '../src/game.ts';
import type { Opener } from '../src/wave.ts';
import { ELEMENT_COLOR, ELEMENT_EMOJI, TRAIT_TAG, TRAIT_RADIUS } from './theme.ts';

type Tool =
  | { kind: 'wall' }
  | { kind: 'sell' }
  | { kind: 'tower'; element: Element };

const CELL = 44; // css px per cell

export class GameView {
  private game!: Game;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private tool: Tool | null = null;
  private tier: Tier = Tier.T1;
  private speed = 1;
  private acc = 0;
  private lastT = 0;
  private startingChoice: Element = Element.Fire;
  private diffChoice = 3;
  private opponentChoice: Opponent = 'search';
  private seed = 1n;

  // DOM refs
  private el: Record<string, HTMLElement> = {};
  private paletteButtons: { node: HTMLButtonElement; refresh: () => void }[] = [];
  private controlsKey = ''; // memoizes the controls DOM so it isn't rebuilt every frame
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
        <div class="wt-top">
          <span class="wt-title">🧙 wiz-tower</span>
          <span class="wt-sub">Phase 1 — search opponent</span>
        </div>
        <div class="wt-setup" id="setup"></div>
        <div class="wt-hud">
          <span id="currency" class="wt-cur"></span>
          <div class="wt-core"><div id="corefill" class="wt-corefill"></div><span id="corelabel"></span></div>
          <span id="wavelabel" class="wt-wave"></span>
        </div>
        <div class="wt-board-wrap"><canvas id="board"></canvas><div id="overlay" class="wt-overlay"></div></div>
        <div id="telegraph" class="wt-telegraph"></div>
        <div id="palette" class="wt-palette"></div>
        <div id="controls" class="wt-controls"></div>
      </div>`;
    const byId = (id: string) => this.root.querySelector<HTMLElement>('#' + id)!;
    for (const id of ['setup', 'currency', 'corefill', 'corelabel', 'wavelabel', 'overlay', 'telegraph', 'palette', 'controls']) {
      this.el[id] = byId(id);
    }
    this.canvas = byId('board') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.addEventListener('pointerdown', (e) => this.onBoardClick(e));

    this.buildSetup();
  }

  private buildSetup(): void {
    const s = this.el.setup;
    s.innerHTML = '';
    const elLabel = document.createElement('span');
    elLabel.textContent = 'Start:';
    elLabel.className = 'wt-lbl';
    s.appendChild(elLabel);
    for (let e = 0; e < N_ELEMENTS; e++) {
      const b = document.createElement('button');
      b.textContent = ELEMENT_EMOJI[e as Element];
      b.title = ELEMENT_NAMES[e];
      b.className = 'wt-chip';
      b.onclick = () => { this.startingChoice = e as Element; this.newGame(); };
      s.appendChild(b);
    }
    const dLabel = document.createElement('span');
    dLabel.textContent = ' Diff:';
    dLabel.className = 'wt-lbl';
    s.appendChild(dLabel);
    for (let d = 1; d <= 5; d++) {
      const b = document.createElement('button');
      b.textContent = String(d);
      b.className = 'wt-chip';
      b.onclick = () => { this.diffChoice = d; this.newGame(); };
      s.appendChild(b);
    }
    const oLabel = document.createElement('span');
    oLabel.textContent = ' Foe:';
    oLabel.className = 'wt-lbl';
    s.appendChild(oLabel);
    for (const [label, opp] of [['Search', 'search'], ['Net', 'model']] as const) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = 'wt-chip';
      b.title = opp === 'search' ? 'Live branching search (L2)' : 'Distilled tiny net';
      b.onclick = () => { this.opponentChoice = opp; this.newGame(); };
      s.appendChild(b);
    }
  }

  private newGame(): void {
    this.seed = (this.seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    this.game = new Game({ starting: this.startingChoice, difficulty: this.diffChoice, seed: this.seed, opponent: this.opponentChoice });
    this.tool = { kind: 'wall' };
    this.tier = Tier.T1;
    this.speed = 1;
    this.sizeCanvas();
    this.buildPalette();
    this.controlsKey = '';
    this.overShown = false;
    this.el.overlay.style.display = 'none';
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

  // ---- build palette --------------------------------------------------------------

  private buildPalette(): void {
    const p = this.el.palette;
    p.innerHTML = '';
    this.paletteButtons = [];
    const add = (label: string, onClick: () => void, refresh: (b: HTMLButtonElement) => void, selected: () => boolean) => {
      const b = document.createElement('button');
      b.className = 'wt-tool';
      b.onclick = onClick;
      p.appendChild(b);
      const r = () => { b.innerHTML = label; refresh(b); b.classList.toggle('sel', selected()); };
      this.paletteButtons.push({ node: b, refresh: r });
    };

    // Wall
    add(`🧱<small>${WALL_COST}</small>`,
      () => { this.tool = { kind: 'wall' }; },
      (b) => { b.disabled = this.game.currency < WALL_COST; },
      () => this.tool?.kind === 'wall');

    // One button per element: attune if locked, else place a turret at the selected tier.
    for (let e = 0; e < N_ELEMENTS; e++) {
      const el = e as Element;
      add('', () => this.onElementTool(el), (b) => this.refreshElementBtn(b, el), () => this.tool?.kind === 'tower' && this.tool.element === el);
    }

    // Sell
    add('❌', () => { this.tool = { kind: 'sell' }; }, () => {}, () => this.tool?.kind === 'sell');

    // Tier toggle
    const tierBtn = document.createElement('button');
    tierBtn.className = 'wt-tool wt-tier';
    tierBtn.onclick = () => { this.tier = ((this.tier % 3) + 1) as Tier; };
    p.appendChild(tierBtn);
    this.paletteButtons.push({ node: tierBtn, refresh: () => { tierBtn.textContent = 'T' + this.tier; } });
  }

  private refreshElementBtn(b: HTMLButtonElement, el: Element): void {
    const pl = this.game.sim.player;
    if (!pl.attuned[el]) {
      const cost = attuneCost(pl.attuneCount);
      b.innerHTML = `${ELEMENT_EMOJI[el]}<small>🔓${cost}</small>`;
      b.disabled = this.game.currency < cost || this.game.state !== 'build';
    } else {
      const cost = this.towerPrice(el);
      b.innerHTML = `${ELEMENT_EMOJI[el]}<small>${cost}</small>`;
      const skips = this.tier > pl.depth[el] + 1;
      b.disabled = skips || this.game.currency < cost || this.game.state !== 'build';
    }
  }

  private towerPrice(el: Element): number {
    const pl = this.game.sim.player;
    const gate = this.tier > pl.depth[el] ? tierGateCost(el, this.tier, pl.starting) : 0;
    return towerCost(NodeKind.Turret, this.tier) + gate;
  }

  private onElementTool(el: Element): void {
    const pl = this.game.sim.player;
    if (!pl.attuned[el]) {
      this.game.attune(el); // charge handled by the sim; palette refreshes next frame
      if (pl.attuned[el]) this.tool = { kind: 'tower', element: el };
    } else {
      this.tool = { kind: 'tower', element: el };
    }
  }

  // ---- input ----------------------------------------------------------------------

  private onBoardClick(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const cell: Cell = { x: Math.floor((e.clientX - rect.left) / CELL), y: Math.floor((e.clientY - rect.top) / CELL) };
    if (!this.game.sim.grid.inBounds(cell) || this.game.state !== 'build' || !this.tool) return;
    if (this.tool.kind === 'wall') this.game.buildWall(cell);
    else if (this.tool.kind === 'sell') this.game.sell(cell);
    else this.game.buildTower(cell, this.tool.element, this.tier, NodeKind.Turret);
  }

  // ---- controls (state-dependent) -------------------------------------------------

  private renderControls(): void {
    const g = this.game;
    // Only rebuild when the visible control set actually changes (avoids per-frame DOM
    // churn — which also detaches buttons mid-click).
    const key = g.state === 'build' ? `build:${g.planned}` : g.state === 'wave' ? `wave:${this.speed}` : 'over';
    if (key === this.controlsKey) return;
    this.controlsKey = key;
    const c = this.el.controls;
    c.innerHTML = '';
    if (g.state === 'build') {
      const plan = this.btn(g.planned ? '👁 Re-plan' : '👁 Scout wave', () => g.planWave());
      const start = this.btn('▶ Start Wave', () => { g.startWave(); });
      start.classList.add('wt-primary');
      c.append(plan, start);
    } else if (g.state === 'wave') {
      for (const [label, sp] of [['⏸', 0], ['1×', 1], ['2×', 2], ['4×', 4]] as const) {
        const b = this.btn(label, () => { this.speed = sp; });
        b.classList.toggle('sel', this.speed === sp);
        c.appendChild(b);
      }
    }
  }

  private btn(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'wt-ctl';
    b.textContent = label;
    b.onclick = onClick;
    return b;
  }

  // ---- main loop ------------------------------------------------------------------

  private frame = (t: number): void => {
    const dt = this.lastT ? Math.min(0.05, (t - this.lastT) / 1000) : 0;
    this.lastT = t;
    if (this.game.state === 'wave' && this.speed > 0) {
      this.acc += dt * 30 * this.speed; // sim runs at 30 ticks/s at 1×
      const steps = Math.min(240, Math.floor(this.acc));
      this.acc -= steps;
      if (steps > 0) this.game.update(steps);
    } else {
      this.acc = 0;
    }
    this.render();
    requestAnimationFrame(this.frame);
  };

  private render(): void {
    this.drawBoard();
    this.drawHud();
    this.drawTelegraph();
    for (const b of this.paletteButtons) b.refresh();
    this.el.palette.style.display = this.game.state === 'build' ? 'flex' : 'none';
    this.renderControls();
    if (this.game.state === 'gameover') this.showGameOver();
  }

  private drawHud(): void {
    const g = this.game;
    this.el.currency.textContent = `💰 ${g.currency}`;
    this.el.wavelabel.textContent = `Wave ${g.wave} · Diff ${g.diff} · ${g.opponent === 'model' ? '🧠 net' : '🔍 search'}`;
    const frac = g.coreHpFraction();
    (this.el.corefill as HTMLElement).style.width = Math.round(frac * 100) + '%';
    (this.el.corefill as HTMLElement).style.background = frac > 0.5 ? '#7CFFB2' : frac > 0.25 ? '#ffd23f' : '#ff5a4d';
    this.el.corelabel.textContent = `${Math.max(0, Math.round(fxToFloat(g.coreHp())))} / ${Math.round(fxToFloat(g.coreHpMax()))}`;
  }

  private drawTelegraph(): void {
    const t = this.el.telegraph;
    if (this.game.state === 'build' && this.game.planned) {
      t.style.display = 'block';
      t.innerHTML = '⚠ Incoming: ' + formatTelegraph(this.game.telegraph, this.game.sim.grid.w);
    } else if (this.game.state === 'wave') {
      t.style.display = 'block';
      t.innerHTML = '⚔ Wave in progress…';
    } else {
      t.style.display = 'none';
    }
  }

  private showGameOver(): void {
    if (this.overShown) return;
    this.overShown = true;
    const o = this.el.overlay;
    o.style.display = 'flex';
    o.innerHTML = `<div class="wt-go"><h2>Core destroyed</h2>
      <p>You reached <b>wave ${this.game.highestWave}</b>.</p>
      <button class="wt-ctl wt-primary" id="restart">New run</button></div>`;
    o.querySelector<HTMLButtonElement>('#restart')!.onclick = () => this.newGame();
  }

  // ---- board drawing --------------------------------------------------------------

  private drawBoard(): void {
    const g = this.game.sim.grid;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, g.w * CELL, g.h * CELL);

    // cells
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const info = g.cells[y * g.w + x];
        ctx.fillStyle = info.buildable ? '#161734' : '#10112a';
        if (info.occ.kind === OccKind.Spawn) ctx.fillStyle = '#241326';
        ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
      }
    }
    // walls
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const occ = g.cells[y * g.w + x].occ;
        if (occ.kind !== OccKind.Wall) continue;
        const frac = Math.max(0.15, Math.min(1, fxToFloat(occ.hp) / 30));
        ctx.fillStyle = `rgba(150,150,175,${0.3 + 0.6 * frac})`;
        this.roundRect(x * CELL + 4, y * CELL + 4, CELL - 8, CELL - 8, 4);
        ctx.fill();
      }
    }
    // core
    const core = g.coreCell();
    const frac = this.game.coreHpFraction();
    ctx.save();
    ctx.translate(core.x * CELL + CELL / 2, core.y * CELL + CELL / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = frac > 0.5 ? '#7CFFB2' : frac > 0.25 ? '#ffd23f' : '#ff5a4d';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 12;
    ctx.fillRect(-CELL * 0.3, -CELL * 0.3, CELL * 0.6, CELL * 0.6);
    ctx.restore();

    // towers (+ faint range rings in build phase)
    for (const t of this.game.sim.liveTowers()) {
      const cx = t.cell.x * CELL + CELL / 2, cy = t.cell.y * CELL + CELL / 2;
      if (this.game.state === 'build') {
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath();
        ctx.arc(cx, cy, fxToFloat(t.range) * CELL, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = ELEMENT_COLOR[t.element];
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * 0.32, 0, Math.PI * 2);
      ctx.fill();
      // tier pips
      ctx.fillStyle = '#0f1020';
      for (let i = 0; i < t.tier; i++) ctx.fillRect(cx - 6 + i * 6, cy + CELL * 0.18, 3, 3);
      if (t.flags.antiAir) this.ring(cx, cy, CELL * 0.4, '#ffffff55');
      if (t.flags.detection) this.ring(cx, cy, CELL * 0.44, '#f2f0d888');
    }

    // mobs
    for (const m of this.game.sim.liveMobs()) {
      const cx = fxToFloat(m.pos.x) * CELL, cy = fxToFloat(m.pos.y) * CELL;
      const r = TRAIT_RADIUS[m.trait] * CELL;
      ctx.globalAlpha = m.flags.stealth ? 0.5 : 1;
      ctx.fillStyle = ELEMENT_COLOR[m.element];
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (m.flags.flier) this.ring(cx, cy, r + 3, '#ffffffaa');
      if (m.shieldHits > 0) this.ring(cx, cy, r + 5, '#4fc3ffcc');
      // trait tag
      ctx.fillStyle = '#0f1020';
      ctx.font = `bold ${Math.round(r)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TRAIT_TAG[m.trait], cx, cy + 0.5);
      // hp bar
      const hpFrac = Math.max(0, fxToFloat(m.hp) / fxToFloat(m.maxHp));
      ctx.fillStyle = '#000a';
      ctx.fillRect(cx - r, cy - r - 5, r * 2, 3);
      ctx.fillStyle = hpFrac > 0.4 ? '#7CFFB2' : '#ff5a4d';
      ctx.fillRect(cx - r, cy - r - 5, r * 2 * hpFrac, 3);
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private ring(cx: number, cy: number, r: number, color: string): void {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.ctx.stroke();
  }
}

/** "8× 🔥 Swarm (left), 2× 🪨 Tank (right)" from the telegraphed opener. */
function formatTelegraph(opener: Opener, w: number): string {
  const side = (x: number) => (x < w / 3 ? 'left' : x >= (2 * w) / 3 ? 'right' : 'center');
  return opener
    .map((s) => `${s.group.count}× ${ELEMENT_EMOJI[s.group.element]} ${TRAIT_NAMES[s.group.trait]} <em>(${side(s.x)})</em>`)
    .join(', ');
}
