// Instrument a real game: flag any mob whose HP RISES (a heal) and any mob that lives an
// abnormally long time (never dies/leaks) — the "bar resets perpetually" symptom.
import { Game } from '../src/game.ts';
import { Element, N_ELEMENTS, ELEMENT_NAMES } from '../src/element.ts';
import { Trait, NodeKind, Tier, OccKind, TRAIT_NAMES } from '../src/types.ts';

function freeCell(g: Game) {
  const grid = g.sim.grid;
  for (let y = 3; y <= 10; y++) for (const x of [3, 2, 4, 1, 5, 0, 6]) {
    const info = grid.cells[y * grid.w + x];
    if (info.buildable && info.occ.kind === OccKind.Empty) return { x, y };
  }
  return null;
}
function defend(g: Game, wave: number) {
  if (wave === 0) for (let x = 0; x < g.sim.grid.w; x++) if (x !== 3) g.buildWall({ x, y: 8 });
  g.planWave();
  let guard = 0;
  while (g.currency > 20 && guard++ < 40) { const c = freeCell(g); if (!c || !g.buildTower(c, Element.Fire, Tier.T1, NodeKind.Turret)) break; }
  // some anti-air so fliers aren't the whole story
  if (wave >= 3) { g.attune(Element.Sonic); const c = freeCell(g); if (c) g.buildTower(c, Element.Sonic, Tier.T1, NodeKind.Turret); }
}

const g = new Game({ starting: Element.Fire, difficulty: 4, opponent: 'search', seed: 42n });
const life = new Map<number, { t: number; trait: Trait; el: number }>();
const heals = new Map<string, number>();
let longest = { ticks: 0, trait: -1, el: -1 };
const prevHp = new Map<number, number>();

for (let w = 0; w < 12 && g.state !== 'gameover'; w++) {
  defend(g, w);
  g.startWave();
  let guard = 0;
  while (g.state === 'wave' && guard++ < 60000) {
    g.update(1);
    for (const m of g.sim.liveMobs()) {
      const before = prevHp.get(m.id);
      if (before !== undefined && m.hp > before + 1) heals.set(TRAIT_NAMES[m.trait], (heals.get(TRAIT_NAMES[m.trait]) ?? 0) + 1);
      prevHp.set(m.id, m.hp);
      const rec = life.get(m.id) ?? { t: 0, trait: m.trait, el: m.element };
      rec.t++; life.set(m.id, rec);
      if (rec.t > longest.ticks) longest = { ticks: rec.t, trait: m.trait, el: m.element };
    }
    // clear tracking for dead ids so reuse starts fresh
    const alive = new Set(g.sim.liveMobs().map((m) => m.id));
    for (const id of [...life.keys()]) if (!alive.has(id)) { life.delete(id); prevHp.delete(id); }
  }
}

console.log('heals seen (ticks where a mob HP rose), by trait:', heals.size ? Object.fromEntries(heals) : 'NONE');
console.log(`longest-lived mob: ${TRAIT_NAMES[longest.trait] ?? '-'} ${ELEMENT_NAMES[longest.el] ?? ''} for ${longest.ticks} ticks (${(longest.ticks / 30).toFixed(1)}s)`);
void N_ELEMENTS;
