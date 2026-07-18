import { describe, it, expect } from 'vitest';
import { Sim } from './sim.ts';
import { Element } from './element.ts';
import { Trait, Tier, NodeKind } from './types.ts';
import { fx } from './fx.ts';
import { DEFAULT_CONFIG } from './config.ts';

const cfg = { ...DEFAULT_CONFIG };
const hpOf = (s: Sim, trait: Trait) => { const m = s.liveMobs().find((x) => x.trait === trait); return m ? m.hp : 0; };
function runUntil(s: Sim, done: (s: Sim) => boolean, max = 3000): number {
  let n = 0; while (n < max && !done(s)) { s.step(); n++; } return n;
}

describe('defender roles: Pylon & Emitter', () => {
  it('a Pylon buffs an adjacent turret — the target loses more HP', () => {
    const buffed = Sim.create(cfg, Element.Fire);
    buffed.buildTower({ x: 3, y: 1 }, Element.Fire, Tier.T1, NodeKind.Turret);
    buffed.buildTower({ x: 3, y: 2 }, Element.Fire, Tier.T1, NodeKind.Structure); // Pylon in range of the turret
    buffed.spawnGroup(3, Element.Light, Trait.Tank, 1); // neutral typing, tanky enough to stay alive & in range

    const plain = Sim.create(cfg, Element.Fire);
    plain.buildTower({ x: 3, y: 1 }, Element.Fire, Tier.T1, NodeKind.Turret);
    plain.spawnGroup(3, Element.Light, Trait.Tank, 1);

    for (let i = 0; i < 90; i++) { buffed.step(); plain.step(); } // identical movement → same position each tick
    expect(hpOf(buffed, Trait.Tank)).toBeLessThan(hpOf(plain, Trait.Tank));
  });

  it('an Emitter slow-field (Ice) delays a leak vs no field', () => {
    const field = Sim.create(cfg, Element.Ice);
    field.buildTower({ x: 3, y: 5 }, Element.Ice, Tier.T1, NodeKind.Active); // slow field on the lane
    field.syncFields();
    field.spawnGroup(3, Element.Light, Trait.Grunt, 1);
    const tField = runUntil(field, (s) => s.coreHp() < fx(100));

    const plain = Sim.create(cfg, Element.Ice);
    plain.spawnGroup(3, Element.Light, Trait.Grunt, 1);
    const tPlain = runUntil(plain, (s) => s.coreHp() < fx(100));
    expect(tField).toBeGreaterThan(tPlain);
  });

  it('an Emitter vulnerable-field (Fire) makes a turret hit harder', () => {
    const amp = Sim.create(cfg, Element.Fire);
    amp.buildTower({ x: 3, y: 1 }, Element.Fire, Tier.T1, NodeKind.Turret);
    amp.buildTower({ x: 3, y: 2 }, Element.Fire, Tier.T1, NodeKind.Active); // vulnerable field over the mob
    amp.spawnGroup(3, Element.Light, Trait.Tank, 1);

    const plain = Sim.create(cfg, Element.Fire);
    plain.buildTower({ x: 3, y: 1 }, Element.Fire, Tier.T1, NodeKind.Turret);
    plain.spawnGroup(3, Element.Light, Trait.Tank, 1);

    for (let i = 0; i < 90; i++) { amp.step(); plain.step(); }
    expect(hpOf(amp, Trait.Tank)).toBeLessThan(hpOf(plain, Trait.Tank));
  });

  it('an Emitter detect-field (Light) lets a blind turret hit a Shade', () => {
    const seer = Sim.create(cfg, Element.Fire);
    seer.buildTower({ x: 3, y: 2 }, Element.Fire, Tier.T2, NodeKind.Turret); // Fire = no detection of its own
    seer.attune(Element.Light);
    seer.buildTower({ x: 3, y: 3 }, Element.Light, Tier.T1, NodeKind.Active); // reveal field
    seer.spawnGroup(3, Element.Dark, Trait.Shade, 1);
    runUntil(seer, (s) => s.liveMobs().length === 0 || s.coreHp() < fx(100));
    expect(seer.coreHp()).toBe(fx(100)); // revealed and shot down before it leaked
  });
});

describe('attacker support summons: Warden & Totem', () => {
  it('a Warden soaks damage for a nearby summon', () => {
    // Turret at column 2 (near spawn) shoots the grunt in column 3; the Warden rides in column 4
    // — inside its own ward radius of the grunt, but out of the turret's range, so only the grunt
    // is targeted and the ONLY difference is the ward.
    const warded = Sim.create(cfg, Element.Fire);
    warded.buildTower({ x: 2, y: 1 }, Element.Fire, Tier.T1, NodeKind.Turret);
    warded.spawnGroup(3, Element.Light, Trait.Grunt, 1);
    warded.spawnGroup(4, Element.Light, Trait.Warden, 1);

    const plain = Sim.create(cfg, Element.Fire);
    plain.buildTower({ x: 2, y: 1 }, Element.Fire, Tier.T1, NodeKind.Turret);
    plain.spawnGroup(3, Element.Light, Trait.Grunt, 1);

    for (let i = 0; i < 24; i++) { warded.step(); plain.step(); }
    expect(hpOf(warded, Trait.Grunt)).toBeGreaterThan(hpOf(plain, Trait.Grunt));
  });

  it('a Totem hastes a nearby summon — it leaks sooner', () => {
    const hasted = Sim.create(cfg, Element.Fire);
    hasted.spawnGroup(3, Element.Fire, Trait.Grunt, 1);
    hasted.spawnGroup(3, Element.Fire, Trait.Totem, 1);
    const tHasted = runUntil(hasted, (s) => s.coreHp() < fx(100));

    const plain = Sim.create(cfg, Element.Fire);
    plain.spawnGroup(3, Element.Fire, Trait.Grunt, 1);
    const tPlain = runUntil(plain, (s) => s.coreHp() < fx(100));
    expect(tHasted).toBeLessThan(tPlain);
  });
});
