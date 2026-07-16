/**
 * The driver loop — IDENTICAL for live play and training (lib.rs, bottom). This is the
 * whole point of the Attacker interface: the Sim never knows whether a PlanAttacker
 * (parsed model DSL / replay) or a SearchAttacker (Phase 1.5) is behind it.
 */
import { Sim } from './sim.ts';
import type { Attacker } from './wave.ts';
import type { Metrics } from './types.ts';

/** Play one wave to completion (or game-over), returning the scorecard. */
export function playWave(sim: Sim, attacker: Attacker, wave: number, diff: number): Metrics {
  const { opener, pool } = attacker.open(sim.observe());
  sim.beginWave(opener, pool, wave, diff);
  for (;;) {
    const out = sim.step();
    switch (out.kind) {
      case 'continue':
        break;
      case 'decision': {
        const commits = attacker.commit(sim.decisionContext());
        sim.commit(commits);
        break;
      }
      case 'waveComplete':
        return out.metrics;
      case 'gameOver':
        return sim.metricsSnapshot();
    }
  }
}
