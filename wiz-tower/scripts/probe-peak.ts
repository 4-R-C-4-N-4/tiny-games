import { Sim } from '../src/sim.ts';
import { Element } from '../src/element.ts';
import { Tier, NodeKind } from '../src/types.ts';
import { SearchAttacker } from '../src/search.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

// Weak board so mobs survive → measures the WORST-CASE peak concurrent mob count for render/perf.
for (const wave of [10, 30, 50, 70, 100]) {
  const s = Sim.create(DEFAULT_CONFIG, Element.Zap);
  s.buildTower({ x: 3, y: 6 }, Element.Zap, Tier.T1, NodeKind.Turret);
  s.syncFields();
  s.prepareWave(wave, 3);
  const atk = new SearchAttacker(s, { seed: 7n });
  const { opener, pool } = atk.open(s.observe());
  s.beginWave(opener, pool, wave, 3);
  let peak = 0;
  for (let i = 0; i < 6000; i++) {
    const out = s.step();
    peak = Math.max(peak, s.liveMobs().length);
    if (out.kind === 'decision') { s.commit(atk.commit(s.decisionContext())); continue; }
    if (out.kind !== 'continue') break;
  }
  console.log(`wave ${String(wave).padStart(3)}: peak concurrent mobs = ${peak}`);
}
