/**
 * Throughput/threat probe — builds a FIXED maxed board (18× T3 wards, tri-school) and plays
 * a full wave of a chosen number against it, reporting how many points/mobs the attacker
 * actually fields and how much Core damage it lands. This is the oracle for "does a strong
 * board ever get threatened?" — the user's complaint. Run:
 *   node --experimental-transform-types scripts/probe-throughput.ts
 */
import { Sim } from '../src/sim.ts';
import { Element } from '../src/element.ts';
import { Tier, NodeKind } from '../src/types.ts';
import { SearchAttacker } from '../src/search.ts';
import { budgetFor, groupCost, DEFAULT_CONFIG } from '../src/config.ts';
import { playWave } from '../src/driver.ts';
import { fxToFloat } from '../src/fx.ts';
import type { Commit, Opener } from '../src/wave.ts';

// A properly-mazed maxed board: wall row 8 (gap at x=3) funnels ALL ground through a
// long tower-lined corridor; 18 T3 tri-school wards ring the gap down to the Core.
const GAP = 3;
const KILLBOX = [
  { x: 3, y: 7 }, { x: 2, y: 7 }, { x: 4, y: 7 }, { x: 3, y: 9 }, { x: 2, y: 9 }, { x: 4, y: 9 },
  { x: 3, y: 10 }, { x: 2, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 6 }, { x: 2, y: 6 }, { x: 4, y: 6 },
  { x: 1, y: 7 }, { x: 5, y: 7 }, { x: 1, y: 9 }, { x: 5, y: 9 }, { x: 3, y: 5 }, { x: 2, y: 5 }, { x: 4, y: 5 },
];
function strongBoard(): Sim {
  const s = Sim.create(DEFAULT_CONFIG, Element.Zap);
  s.player.currency = 1_000_000;
  for (let x = 0; x < 7; x++) if (x !== GAP) s.buildWall({ x, y: 8 });
  let built = 0;
  for (const c of KILLBOX) {
    if (built >= 18) break;
    const e = [Element.Zap, Element.Sonic, Element.Light][built % 3];
    s.buildTower(c, e, Tier.T1, NodeKind.Turret) && s.sell(c); // ladder depth →T1
    s.buildTower(c, e, Tier.T2, NodeKind.Turret) && s.sell(c); // →T2
    if (s.buildTower(c, e, Tier.T3, NodeKind.Turret)) built++; // place T3
  }
  s.syncFields();
  return s;
}

const opPts = (op: Opener) => op.reduce((n, g) => n + groupCost(g.group.trait, g.group.count), 0);
const opMobs = (op: Opener) => op.reduce((n, g) => n + g.group.count, 0);
const cPts = (cs: Commit[][]) => cs.flat().reduce((n, c) => n + groupCost(c.group.trait, c.group.count), 0);
const cMobs = (cs: Commit[][]) => cs.flat().reduce((n, c) => n + c.group.count, 0);

console.log('wave | budget | fielded pts (op+res) | mobs | core dmg to an 18×T3 board');
for (const wave of [5, 10, 20, 30, 50, 70]) {
  const s = strongBoard();
  s.prepareWave(wave, 3);
  const atk = new SearchAttacker(s, { seed: 7n });
  const hp0 = fxToFloat(s.coreHp());
  playWave(s, atk, wave, 3);
  const dmg = Math.round(hp0 - fxToFloat(s.coreHp()));
  const op = atk.lastPlan?.opener ?? [];
  const pts = opPts(op) + cPts(atk.committed);
  const mobs = opMobs(op) + cMobs(atk.committed);
  console.log(
    `${String(wave).padStart(4)} | ${String(budgetFor(wave, 3)).padStart(6)} | ${String(pts).padStart(5)} (${opPts(op)}+${cPts(atk.committed)})`.padEnd(36) +
    ` | ${String(mobs).padStart(4)} | ${dmg > 0 ? dmg + ' dmg' : 'unscathed'}`,
  );
}
