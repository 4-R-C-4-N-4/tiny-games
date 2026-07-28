// Headless harness for robo-smash.html — stubs browser APIs, drives tick() directly.
const fs = require("fs"), vm = require("vm");
const html = fs.readFileSync(__dirname + "/robo-smash.html", "utf8");
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];

function absorb() {
  return new Proxy(function(){}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : absorb()),
    apply: () => absorb(),
    set: () => true,
  });
}

function makeCtx(seedQ) {
  const ctx = {
    location: { search: seedQ ? `?seed=${seedQ}` : "", reload: () => {} },
    document: {
      getElementById: () => ({ getContext: () => absorb(), addEventListener: () => {}, getBoundingClientRect: () => ({left:0,top:0,width:960,height:540}) }),
      createElement: () => ({ click: () => {}, set href(v){}, set download(v){} }),
    },
    window: {},
    addEventListener: () => {},
    requestAnimationFrame: () => {},
    performance: { now: () => 0 },
    setTimeout: () => 0,
    URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
    Blob: function(){},
    Math, JSON, Array, Object, Symbol, Proxy, console,
  };
  ctx.globalThis = ctx;
  return vm.createContext(ctx);
}

const expose = `
globalThis.__G = {
  tick, key, p, crushers, boxes, checkpoints, spikes, enemies, pickups, grid, telem, events, sfx,
  buildLevel, collect, addShield, damage, respawn, solidAt, estimateArrival,
  get cells(){return cells}, get allCells(){return allCells},
  get goal(){return goal}, get LW(){return LW}, get stage(){return stage},
  get telemN(){return telemN}, get eventsN(){return eventsN},
  get hitstop(){return hitstop}, set hitstop(v){hitstop=v},
  get jrec(){return jrec}, get SEED(){return SEED}, get deaths(){return deaths},
  get scrap(){return scrap}, set scrap(v){scrap=v},
  get shield(){return shield}, set shield(v){shield=v},
  get invT(){return invT}, set invT(v){invT=v},
  get iframes(){return iframes}, set iframes(v){iframes=v},
  get empT(){return empT}, get coolT(){return coolT},
};`;

function boot(seedQ) {
  const ctx = makeCtx(seedQ);
  vm.runInContext(src + "\n" + expose, ctx);
  return ctx.__G;
}

let fails = 0;
function check(name, cond, extra) {
  if (!cond) { fails++; console.log("FAIL:", name, extra ?? ""); }
  else console.log("ok:", name);
}

// ---- 1. structural checks: 100 seeds x 3 sectors ----
{
  let bad = false, cellNames = new Set(), sawEnemies = false;
  outer:
  for (let s = 1; s <= 100; s++) {
    const G = boot(String(s));
    for (let st = 0; st < 3; st++) {
      if (st > 0) G.buildLevel(st);
      G.cells.forEach(c => cellNames.add(c.name));
      if (!G.goal) { check(`seed ${s} st ${st} goal`, false); bad = true; break outer; }
      if (G.cells.length !== 6 + st) { check(`seed ${s} st ${st} cells`, false, G.cells.length); bad = true; break outer; }
      if (new Set(G.grid.map(r => r.length)).size !== 1) { check(`seed ${s} st ${st} ragged grid`, false); bad = true; break outer; }
      // patrolYard gating
      if (st === 0 && G.cells.some(c => c.name === "patrolYard")) { check(`seed ${s} patrolYard in st 0`, false); bad = true; break outer; }
      if (G.enemies.length) sawEnemies = true;
      // every ground gap <=4 or bridged by platforms
      let gapStart = -1;
      for (let x = 0; x < G.LW; x++) {
        const solid = G.grid[10][x] === "#";
        if (!solid && gapStart < 0) gapStart = x;
        if (solid && gapStart >= 0) {
          const w = x - gapStart;
          if (w > 4) {
            let plat = false;
            for (let gx = gapStart; gx < x; gx++) for (let y = 0; y < 12; y++) if (G.grid[y][gx] === "=") plat = true;
            if (!plat) { check(`seed ${s} st ${st} unbridged gap ${w} @${gapStart}`, false); bad = true; break outer; }
          }
          gapStart = -1;
        }
      }
      // knob wiring
      for (const c of G.crushers) {
        const cell = G.cells.find(cc => c.x/48 >= cc.x0 && c.x/48 < cc.x1);
        if (!cell || c.slack !== cell.knobs.slack) { check(`seed ${s} st ${st} crusher slack`, false); bad = true; break outer; }
      }
      for (const e of G.enemies) {
        const cell = G.cells.find(cc => (e.x+18)/48 >= cc.x0 && (e.x+18)/48 < cc.x1);
        if (!cell || e.sp !== cell.knobs.speed) { check(`seed ${s} st ${st} enemy speed`, false); bad = true; break outer; }
      }
    }
  }
  check("100 seeds x 3 sectors build clean", !bad);
  check("all 7 cell types appear", cellNames.size === 7, [...cellNames]);
  check("enemies spawn in later sectors", sawEnemies);
}

// ---- 2. C1 fix: jump tapped during hitstop is not eaten ----
{
  const G = boot("42");
  for (let i = 0; i < 30; i++) G.tick();
  check("settled on ground", G.p.grounded);
  const restY = G.p.y, telBefore = G.telemN;
  G.hitstop = 4;
  G.key.j = true; G.tick();
  G.key.j = false; G.tick(); G.tick(); G.tick();
  let minY = restY;
  for (let i = 0; i < 30; i++) { G.tick(); if (G.p.y < minY) minY = G.p.y; }
  check("C1: jump tapped inside hitstop still fires", restY - minY > 4 && G.telemN > telBefore,
        `rose ${(restY-minY).toFixed(1)}px, records +${G.telemN-telBefore}`);
  for (let i = 0; i < 60; i++) G.tick();
  const rest2 = G.p.y; G.hitstop = 4;
  G.key.j = true;
  let minY2 = rest2;
  for (let i = 0; i < 40; i++) { G.tick(); if (G.p.y < minY2) minY2 = G.p.y; }
  G.key.j = false;
  check("C1: jump held through hitstop gets full height", rest2 - minY2 > 90, `rose ${(rest2-minY2).toFixed(1)}px`);
}

// ---- 3. crusher phase-lock: telegraph floor >= 16f before slam ----
{
  let G = null, cr = null;
  for (let s = 1; s < 60 && !cr; s++) { G = boot(String(s)); if (G.crushers.length) cr = G.crushers[0]; }
  check("found a sector-1 crusher", !!cr);
  if (cr) {
    for (let i = 0; i < 70; i++) G.tick();   // burn the boot re-arm cooldown
    G.p.x = cr.x - 300; G.p.y = 8*48; G.p.vx = 0; G.p.dead = 0;
    G.key.r = true;
    let teleFrames = 0, slamSeen = false, lockFrame = -1;
    for (let i = 0; i < 300; i++) {
      G.key.j = i % 30 < 10;                 // hop over crates in the corridor
      G.key.s = i % 45 === 0;                // spin through crate stacks
      G.tick();
      if (cr.state === 4) { teleFrames++; if (lockFrame < 0) lockFrame = i; }
      if (cr.state === 1) { slamSeen = true; break; }
      if (G.p.dead > 0) break;
    }
    check("crusher phase-locks on approach", lockFrame >= 0);
    check("telegraph >= 16f (250ms floor) before slam", !slamSeen || teleFrames >= 16, `tele=${teleFrames}`);
  }
}

// ---- 4. shield: absorbs impact once (with iframes), never saves from pits ----
{
  const G = boot("42");
  for (let i = 0; i < 30; i++) G.tick();
  G.shield = 2;
  G.damage("spike");
  check("shield absorbs a hit", G.shield === 1 && G.p.dead === 0 && G.iframes > 0);
  G.damage("spike");
  check("iframes block the follow-up hit", G.shield === 1 && G.p.dead === 0);
  G.iframes = 0;
  G.damage("enemy");
  check("second real hit consumes last stack", G.shield === 0 && G.p.dead === 0);
  G.iframes = 0;
  G.damage("crusher");
  check("shieldless hit kills", G.p.dead > 0);
  // pit bypass: fresh boot, full shield, fall out of the world
  const H = boot("42");
  for (let i = 0; i < 30; i++) H.tick();
  H.shield = 2;
  H.p.y = 12*48 + 100;
  H.tick();
  check("pit death bypasses shield", H.p.dead > 0 && H.shield === 2);
  const dEv = H.events.find(e => e && e.type === "death" && e.cause === "pit");
  check("death cause logged in events", !!dEv);
}

// ---- 5. consumables: coolant, EMP freeze, scrap->shield, invincibility ----
{
  const G = boot("42");
  for (let i = 0; i < 30; i++) G.tick();
  G.p.heat = 3;
  G.collect({kind:"cool", x:0, y:0});
  check("coolant vents heat + starts free-spin window", G.p.heat === 0 && G.coolT > 0);
  G.collect({kind:"emp", x:0, y:0});
  check("EMP timer starts", G.empT > 0);
  // EMP freezes enemies
  G.buildLevel(2);
  for (let i = 0; i < 30; i++) G.tick();
  if (G.enemies.length) {
    G.collect({kind:"emp", x:0, y:0});
    const ex = G.enemies[0].x;
    for (let i = 0; i < 50; i++) G.tick();
    check("EMP freezes scuttlers", G.enemies[0].x === ex);
    while (G.empT > 0) G.tick();
    const ex2 = G.enemies[0].x;
    for (let i = 0; i < 30; i++) G.tick();
    check("scuttlers resume after EMP", G.enemies[0].x !== ex2);
  } else console.log("note: seed 42 sector 3 has no enemies; EMP-freeze check skipped");
  // scrap economy
  const H = boot("42");
  for (let i = 0; i < 30; i++) H.tick();
  H.scrap = 49; H.shield = 0;
  H.collect({kind:"bolt", x:0, y:0});
  check("50th scrap grants a shield stack", H.scrap === 50 && H.shield === 1);
  H.shield = 2;
  H.addShield();
  check("3rd stack triggers invincibility, holds at 2", H.invT > 0 && H.shield === 2);
  H.damage("tnt");
  check("invincibility shrugs off damage", H.p.dead === 0 && H.shield === 2);
}

// ---- 6. enemies: patrol stays put, spin launches, stomp kills ----
{
  let G = null;
  for (let s = 1; s < 80 && !(G && G.enemies.length); s++) { G = boot(String(s)); G.buildLevel(2); }
  check("found a sector with scuttlers", G.enemies.length > 0);
  if (G.enemies.length) {
    const e = G.enemies[0], y0 = e.y, x0 = e.x;
    let minX = e.x, maxX = e.x;
    for (let i = 0; i < 2000; i++) { G.tick(); if (e.x < minX) minX = e.x; if (e.x > maxX) maxX = e.x; }
    check("scuttler patrols horizontally", maxX - minX > 20, `range ${(maxX-minX).toFixed(0)}`);
    check("scuttler never falls off its platform", e.y === y0 && Math.abs(e.x - x0) < 400);
    // spin launch
    G.p.x = e.x - 50; G.p.y = e.y + e.h - 42; G.p.vx = 0;
    G.key.s = true; G.tick(); G.key.s = false;
    let launched = false;
    for (let i = 0; i < 10 && !launched; i++) { G.tick(); launched = e.launched > 0 || !e.alive; }
    check("spin launches the scuttler", launched);
  }
}

// ---- 7. run structure: goal advances sector, 3rd goal = run complete ----
{
  const G = boot("42");
  for (let i = 0; i < 30; i++) G.tick();
  const lw0 = G.LW;
  G.p.x = G.goal.x; G.p.y = G.goal.y - 20;
  G.tick();
  check("goal touch wins the sector", G.p.win === true);
  for (let i = 0; i < 160; i++) G.tick();
  check("sector 2 deploys after interstitial", G.stage === 1 && G.p.win === false, `stage=${G.stage}`);
  check("new sector actually built", G.LW !== 0 && (G.cells.length === 7), `LW ${lw0}->${G.LW}`);
  G.p.x = G.goal.x; G.p.y = G.goal.y - 20; G.tick();
  for (let i = 0; i < 160; i++) G.tick();
  check("sector 3 deploys", G.stage === 2);
  G.p.x = G.goal.x; G.p.y = G.goal.y - 20; G.tick();
  for (let i = 0; i < 200; i++) G.tick();
  check("final goal ends the run (no sector 4)", G.stage === 2 && G.p.win === true);
  check("telemetry cells span all sectors", new Set(G.allCells.map(c => c.stage)).size === 3);
}

// ---- 8. determinism: same seed -> same layout + same crate drops ----
{
  const a = boot("123"), b = boot("123"), c = boot("124");
  const sig = G => G.grid.map(r => r.join("")).join("\n") + "|" + JSON.stringify(G.cells) + "|" + JSON.stringify(G.boxes.map(x => x.drop));
  check("same seed = identical layout + drops", sig(a) === sig(b));
  check("different seed = different layout", sig(a) !== sig(c));
}

// ---- 9. long random-input soak across all sectors ----
{
  const G = boot("99");
  let rngS = 1;
  const rnd = () => (rngS = (rngS * 48271) % 2147483647) / 2147483647;
  for (let st = 0; st < 3; st++) {
    if (st > 0) G.buildLevel(st);
    for (let i = 0; i < 15000; i++) {
      if (i % 7 === 0) { G.key.r = rnd() < 0.7; G.key.l = !G.key.r && rnd() < 0.3; }
      if (i % 11 === 0) G.key.j = rnd() < 0.4;
      if (i % 23 === 0) G.key.s = rnd() < 0.2;
      G.tick();
    }
  }
  check("45k-tick random soak across 3 sectors, no crash", true, `deaths=${G.deaths} telem=${G.telemN} events=${G.eventsN} scrap=${G.scrap}`);
}

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
