/**
 * A fixed, self-contained Phase 0 scenario: a scripted player defense vs a scripted
 * attacker wave (opener + two reserve decision points). Shared by the golden-replay
 * determinism test and the headless scorecard script so both drive exactly the same run.
 *
 * The determinism proof: build this twice and play it twice — given the same (seed,
 * layout, decision stream) the Metrics are identical.
 */
import { fxToFloat, type Fx } from './fx.ts';
import { Element, ELEMENT_NAMES } from './element.ts';
import { Tier, NodeKind } from './types.ts';
import { DEFAULT_CONFIG } from './config.ts';
import { Sim } from './sim.ts';
import { parseWave, PlanAttacker } from './wave.ts';
import { playWave } from './driver.ts';
import type { Metrics } from './types.ts';

/** Extra headroom so the fixed layout below is always affordable, deterministically. */
export const SCENARIO_CONFIG = { ...DEFAULT_CONFIG, startCurrency: 300 };

/** The scripted attacker wave — telegraphed opener + a hidden reserve with two points. */
export const GOLDEN_WAVE = `WAVE budget=200 diff=2
OPEN
  SPAWN t=0.0 x=3 FIRE SWARM x6      # swarm baits the Fire splash tower
  SPAWN t=0.5 x=3 SONIC GRUNT x3     # Sonic bodies (Fire counters these 1.5x)
  SPAWN t=1.0 x=3 LIGHT FLIER x2     # air pressure — needs the Sonic anti-air
RESERVE pool=60
  AT t=2.0
  IF core_hp<50.0
      COMMIT x=3 DARK RUNNER x4      # if already hurting, pour runners in
  ELSE
      COMMIT x=0 FIRE GRUNT x5       # else probe the undefended left flank
  AT t=4.0
  IF dps_near(x=3,FIRE)<20.0
      COMMIT x=3 ICE TANK x2         # centre thin on Fire? send tanks
  ELSE
      COMMIT x=5 SONIC FLIER x3      # else more air on the right
`;

/** Build the fixed player defense on a fresh sim (deterministic order of operations). */
export function buildDefendedSim(): Sim {
  const sim = Sim.create(SCENARIO_CONFIG, Element.Fire);
  // A partial barrier below the spawn band forces a detour around column 3…
  sim.buildWall({ x: 2, y: 5 });
  sim.buildWall({ x: 3, y: 5 });
  sim.buildWall({ x: 4, y: 5 });
  // …into the teeth of a Fire splash turret, backed by a Sonic anti-air turret.
  sim.attune(Element.Sonic);
  sim.buildTower({ x: 3, y: 6 }, Element.Fire, Tier.T2, NodeKind.Turret);
  sim.buildTower({ x: 2, y: 7 }, Element.Sonic, Tier.T1, NodeKind.Turret);
  sim.syncFields();
  return sim;
}

export interface Scorecard {
  metrics: Metrics;
  coreHp: Fx;
  currency: number;
  tick: number;
}

/** Build + play the scenario once, returning the full scorecard. */
export function playGolden(): Scorecard {
  const sim = buildDefendedSim();
  const wave = parseWave(GOLDEN_WAVE, {
    gridW: sim.grid.w,
    gridH: sim.grid.h,
    waveSeconds: SCENARIO_CONFIG.waveSeconds,
    isWall: (c) => sim.grid.blocks(c),
  });
  const metrics = playWave(sim, new PlanAttacker(wave), 1, wave.diff);
  return { metrics, coreHp: sim.coreHp(), currency: sim.player.currency, tick: sim.tick };
}

/** Human-readable scorecard for the headless script. */
export function formatScorecard(s: Scorecard): string {
  const { metrics: m } = s;
  const util = m.dpsUtil
    .map((v, i) => (v > 0 ? `${ELEMENT_NAMES[i]} ${fxToFloat(v).toFixed(1)}` : null))
    .filter((x): x is string => x !== null)
    .join(', ');
  const first = m.timeToFirstLeak < 0 ? 'never' : `${fxToFloat(m.timeToFirstLeak).toFixed(2)}s`;
  const lines = [
    `  ticks simulated     ${s.tick}`,
    `  core HP remaining   ${fxToFloat(s.coreHp).toFixed(1)} / ${fxToFloat(SCENARIO_CONFIG.coreHp).toFixed(0)}`,
    `  leaked HP           ${fxToFloat(m.leakedHp).toFixed(1)}`,
    `  time to first leak  ${first}`,
    `  breaches            ${m.breaches}`,
    `  overkill            ${fxToFloat(m.overkill).toFixed(1)}`,
    `  fire misallocation  ${fxToFloat(m.fireMisalloc).toFixed(1)}`,
    `  bounty to player    ${m.currencyDelta}   (currency now ${s.currency})`,
    `  dps utilization     ${util || '(none)'}`,
  ];
  return lines.join('\n');
}

/** Stable key for equality checks — Fx values are integers, so this is exact. */
export function scorecardKey(s: Scorecard): string {
  return JSON.stringify(s);
}
