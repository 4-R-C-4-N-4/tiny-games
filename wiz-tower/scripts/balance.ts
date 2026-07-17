/**
 * Balance harness — a headless greedy auto-defender plays many waves so we can see the
 * difficulty CURVE (does pressure outrun the player's income?) rather than guess. It's a
 * competent-but-not-optimal player: scry, cover anti-air/detection, counter the dominant
 * school, then spend the rest climbing tiers on central cells. Run: `npm run balance`.
 */
import { Game, type Opponent } from '../src/game.ts';
import { Element, N_ELEMENTS, typeMult, STRONG } from '../src/element.ts';
import { Trait, NodeKind, OccKind, Tier, type Cell } from '../src/types.ts';
import { fxToFloat } from '../src/fx.ts';

function elementThatBeats(e: Element): Element {
  for (let c = 0; c < N_ELEMENTS; c++) if (typeMult(c as Element, e) === STRONG) return c as Element;
  return e;
}

// A competent maze: wall row 8 except a central gap so ALL ground funnels through a
// tower-lined corridor; towers cluster around the gap and down to the Core.
const GAP_X = 3, WALL_ROW = 8;
const KILLBOX: Cell[] = [
  { x: 3, y: 7 }, { x: 2, y: 7 }, { x: 4, y: 7 }, { x: 3, y: 9 }, { x: 2, y: 9 }, { x: 4, y: 9 },
  { x: 3, y: 10 }, { x: 2, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 6 }, { x: 2, y: 6 }, { x: 4, y: 6 },
  { x: 1, y: 7 }, { x: 5, y: 7 }, { x: 1, y: 9 }, { x: 5, y: 9 }, { x: 3, y: 5 }, { x: 2, y: 5 }, { x: 4, y: 5 },
];
function freeCell(g: Game): Cell | null {
  const grid = g.sim.grid;
  for (const c of KILLBOX) { const info = grid.cells[c.y * grid.w + c.x]; if (info.buildable && info.occ.kind === OccKind.Empty) return c; }
  for (let y = 3; y <= 10; y++) for (const x of [3, 2, 4, 1, 5, 0, 6]) {
    const info = grid.cells[y * grid.w + x]; if (info.buildable && info.occ.kind === OccKind.Empty) return { x, y };
  }
  return null;
}

/** Build a cheap T1 ward of element `e` at a free cell (wide coverage beats density early). */
function buildBest(g: Game, e: Element): boolean {
  const pl = g.sim.player;
  if (!pl.attuned[e] && !g.attune(e)) return false;
  const cell = freeCell(g);
  if (!cell) return false;
  return g.buildTower(cell, e, Tier.T1, NodeKind.Turret);
}

function towersOf(g: Game, e: Element): number {
  return g.sim.liveTowers().filter((t) => t.element === e).length;
}
function ensureCount(g: Game, e: Element, n: number): void {
  let guard = 0;
  while (towersOf(g, e) < n && guard++ < 8) if (!buildBest(g, e)) break;
}

function autoDefend(g: Game, wave: number): void {
  const pl = g.sim.player;
  if (wave === 0) for (let x = 0; x < g.sim.grid.w; x++) if (x !== GAP_X) g.buildWall({ x, y: WALL_ROW });

  g.planWave();
  const counts = new Array(N_ELEMENTS).fill(0);
  let flierBodies = 0, shade = false;
  for (const s of g.telegraph) {
    counts[s.group.element] += s.group.count;
    if (s.group.trait === Trait.Flier) flierBodies += s.group.count;
    if (s.group.trait === Trait.Shade) shade = true;
  }
  let dom = 0;
  for (let e = 1; e < N_ELEMENTS; e++) if (counts[e] > counts[dom]) dom = e;
  const counter = elementThatBeats(dom as Element);
  // Anti-air ahead of the air roster (fliers ~wave 3); detection once stealth is due.
  ensureCount(g, Element.Sonic, wave >= 1 ? Math.min(5, 1 + Math.floor(wave / 2) + Math.ceil(flierBodies / 4)) : 0);
  if (wave >= 2 || shade) ensureCount(g, Element.Light, wave >= 4 ? 2 : 1);
  // Counter the dominant school for type advantage (attune once we can afford it).
  if (pl.attuned[counter] || pl.currency > 90) ensureCount(g, counter, Math.min(6, 2 + Math.floor(wave / 2)));
  // Spend the rest on coverage: counter school (type advantage) if attuned, else free Fire.
  const fillE = pl.attuned[counter] ? counter : Element.Fire;
  let guard = 0;
  while (pl.currency > 20 && guard++ < 120) if (!buildBest(g, fillE) && !buildBest(g, Element.Fire)) break;
}

function runCurve(opponent: Opponent, diff: number, maxWaves = 30, trace = false): { reached: number; hp: number[] } {
  const g = new Game({ starting: Element.Fire, difficulty: diff, opponent, seed: 1234n });
  const hp: number[] = [];
  for (let w = 0; w < maxWaves && g.state !== 'gameover'; w++) {
    autoDefend(g, w);
    const towers = g.sim.liveTowers().length;
    const cur = g.currency;
    g.startWave();
    let guard = 0;
    while (g.state === 'wave' && guard++ < 400) g.update(5000);
    hp.push(Math.max(0, Math.round(fxToFloat(g.coreHp()))));
    if (trace) console.log(`    w${String(w + 1).padStart(2)}: towers ${String(towers).padStart(2)}  currency→wave ${String(cur).padStart(3)}  coreHp ${String(hp[hp.length - 1]).padStart(3)}`);
  }
  return { reached: g.state === 'gameover' ? g.highestWave - 1 : maxWaves, hp };
}

for (const opp of ['search', 'strategist'] as const) {
  console.log(`\n=== RANK 3 playthrough vs ${opp} ===`);
  const { reached } = runCurve(opp, 3, 40, true);
  console.log(`  → the run reached wave ${reached}.`);
}

console.log('\n=== curve across ranks ===');
for (const opp of ['search', 'strategist'] as const) {
  console.log(`  foe ${opp}:`);
  for (const diff of [1, 3, 5]) {
    const { reached, hp } = runCurve(opp, diff, 40);
    const spark = hp.map((h) => (h > 66 ? '█' : h > 33 ? '▓' : h > 0 ? '░' : '·')).join('');
    console.log(`    R${diff}: ${String(reached).padStart(2)} waves  core ${spark}`);
  }
}
console.log('\n(each block = one wave; █>66  ▓>33  ░>0  ·dead. Want a gradual decline, not flat-full or instant-death.)');
