/**
 * The Archmage — a best-practice reference DEFENDER (Phase 6 Slice 3). Where `teacher.ts`'s
 * `sampleBoard` scatters random towers and random walls, the Archmage plays defense the way a
 * skilled human does, so the attacker can be taught (and later trained) against COMPETENT
 * play instead of noise. It encodes the game's best practices:
 *
 *  - **Serpentine maze:** alternating wall rows with opposite gaps force ground into a long
 *    zig-zag through tower-lined corridors — the highest-leverage defensive move (more shots
 *    per mob → more kills → a compounding economy).
 *  - **Coverage that can't be exploited:** anti-air (Sonic, which hits ground too) carried
 *    from the start and SCALED, detection (Light) before shades — against a perfect-info foe
 *    whatever you under-cover becomes the exploit.
 *  - **Arcane synergy:** a slow Emitter over a corridor so everything crawls under fire; a
 *    Pylon amping the cluster; the counter-element as extra DPS.
 *  - **Economy:** specialize, tier up with the budget, spend to broke.
 *
 * `stage` (0..1) is its development level — a low-stage Archmage is still *correct* but hasn't
 * teched everything yet, so at any snapshot it has a PRINCIPLED gap (it can't afford every
 * counter at once). Training the attacker to find those real gaps is the whole point; a board
 * that covers everything has a flat leak surface and teaches nothing.
 */
import { Sim } from './sim.ts';
import type { Rng } from './fx.ts';
import { Element, N_ELEMENTS, typeMult, STRONG } from './element.ts';
import { Tier, NodeKind, OccKind, type Cell } from './types.ts';
import type { Config } from './config.ts';

/** Wall rows as [row, openGapColumn]. A single central-gap funnel: cheap enough for the tight
 *  economy, yet it forces all ground through one tower-lined throat (the killbox). Never
 *  includes a gap cell, so a partially-built maze still leaves a valid path. */
const MAZE_ROWS: ReadonlyArray<readonly [number, number]> = [[8, 3]];
const MAZE: Cell[] = [];
for (const [row, gap] of MAZE_ROWS) for (let x = 0; x < 7; x++) if (x !== gap) MAZE.push({ x, y: row });

/** Tower cells: the killbox ringing the funnel throat, centre-out, closest to Core first. */
const TOWER_CELLS: Cell[] = [];
for (const y of [7, 9, 10, 6, 5, 11, 4]) for (const x of [3, 2, 4, 1, 5, 0, 6]) if (!(y === 11 && x === 3)) TOWER_CELLS.push({ x, y });

/** The element that counters `e` (1.5×): its wheel predator or the Light/Dark opposite. */
export function elementThatBeats(e: Element): Element {
  for (let c = 0; c < N_ELEMENTS; c++) if (typeMult(c as Element, e) === STRONG) return c as Element;
  return e;
}

function isEmpty(sim: Sim, c: Cell): boolean {
  const i = sim.grid.cells[c.y * sim.grid.w + c.x];
  return !!i && i.buildable && i.occ.kind === OccKind.Empty;
}

/** First buildable-empty tower cell: corridor order, then any empty cell off the maze rows. */
function freeTowerCell(sim: Sim): Cell | null {
  for (const c of TOWER_CELLS) if (isEmpty(sim, c)) return c;
  const mazeRow = new Set(MAZE_ROWS.map(([r]) => r));
  const g = sim.grid;
  for (let y = 10; y >= 1; y--) { if (mazeRow.has(y)) continue; for (let x = 0; x < g.w; x++) if (isEmpty(sim, { x, y })) return { x, y }; }
  return null;
}

export interface ArchmageInfo {
  budget?: number; //       currency to spend this build (static board gen); else use current
  foeSchool?: Element; //   the school this defense expects to face → build its counter as DPS
  expectAir?: boolean; //   raise anti-air (Sonic)
  expectStealth?: boolean; //raise detection (Light)
  stage?: number; //        0..1 development level → tier ceiling + synergy pieces
}

/** Play one best-practice build phase on `sim`. Deterministic (the build order is fixed). */
export function archmageBuild(sim: Sim, info: ArchmageInfo = {}): void {
  const pl = sim.player;
  if (info.budget !== undefined) pl.currency = info.budget;
  const stage = info.stage ?? 1;
  const tierCap: Tier = stage > 0.66 ? Tier.T3 : stage > 0.33 ? Tier.T2 : Tier.T1;
  const live = info.budget === undefined; // live multi-wave play vs a one-shot static board

  // 1. Serpentine maze — built progressively, capping per-wave wall spend so a half-built
  //    maze never starves DPS (the 140-start economy can't front-load a maze). Static boards
  //    fund it fully. Gaps alternate sides, so any partial build still leaves a valid path.
  let wallBudget = live ? Math.min(45, Math.floor(pl.currency * 0.35)) : pl.currency;
  for (const c of MAZE) {
    if (wallBudget < 5) break;
    if (isEmpty(sim, c) && sim.buildWall(c)) wallBudget -= 5;
  }
  sim.syncFields();

  const counter = info.foeSchool !== undefined ? elementThatBeats(info.foeSchool) : pl.starting;
  const place = (e: Element, tier: Tier, kind: NodeKind = NodeKind.Turret): boolean => {
    if (!pl.attuned[e] && !sim.attune(e)) return false;
    const cell = freeTowerCell(sim);
    if (!cell) return false;
    const t = Math.min(tier, (pl.depth[e] || Tier.T1) + 1) as Tier; // climb the tree one tier at a time
    return sim.buildTower(cell, e, t, kind);
  };
  const turrets = (e: Element): number => sim.liveTowers().filter((t) => t.element === e && t.kind === NodeKind.Turret).length;
  const ensure = (e: Element, n: number, tier: Tier): void => { let g = 0; while (turrets(e) < n && g++ < 14) if (!place(e, tier)) break; };

  const aaTier = Math.min(tierCap, Tier.T2) as Tier;
  // 2. DPS core FIRST — the counter school, guaranteed, so coverage never starves damage.
  ensure(counter, 3, tierCap);
  // 3. Coverage that can't be exploited — anti-air (Sonic also hits ground), then detection.
  if (info.expectAir) ensure(Element.Sonic, Math.round(2 + 2 * stage), aaTier); //     up to 4
  if (info.expectStealth) ensure(Element.Light, Math.round(1 + stage), Tier.T2); //    up to 2
  // 4. Synergy — a slow Emitter over the killbox: everything crawls under sustained fire.
  if (stage > 0.4 && pl.currency > 30) place(Element.Ice, Tier.T1, NodeKind.Active);
  // 5. Deepen the DPS core to the budget's ceiling.
  ensure(counter, 6, tierCap);
  // 6. Synergy — a Pylon amping the turret cluster.
  if (stage > 0.5 && pl.currency > 20) place(counter, tierCap, NodeKind.Structure);
  // 7. Synergy — a vulnerable Emitter for extra amp once well-developed.
  if (stage > 0.7 && pl.currency > 30) place(Element.Fire, Tier.T1, NodeKind.Active);
  // 8. Spend the rest on counter-school coverage until broke.
  let g = 0;
  while (pl.currency > 20 && g++ < 60) if (!place(counter, tierCap)) break;

  sim.syncFields();
}

/**
 * A best-practice board for the teacher — an Archmage at a random development stage, expecting
 * a random foe school, with counter coverage that RISES with stage but stays incomplete so the
 * board's genuine gap varies (the whole point of a distillable target).
 */
export function sampleArchmageBoard(rng: Rng, cfg: Config): Sim {
  const starting = rng.below(N_ELEMENTS) as Element;
  const sim = Sim.create(cfg, starting);
  const budget = 250 + rng.below(700); // development level as spendable currency
  const stage = Math.min(1, budget / 850);
  const chance = (p: number) => rng.below(1000) / 1000 < p;
  archmageBuild(sim, {
    budget,
    foeSchool: rng.below(N_ELEMENTS) as Element,
    expectAir: chance(0.3 + 0.45 * stage),
    expectStealth: chance(0.2 + 0.45 * stage),
    stage,
  });
  return sim;
}
