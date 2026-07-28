// Headless harness for robo-smash.html — stubs browser APIs, drives tick() directly.
const fs = require("fs"), vm = require("vm");
const html = fs.readFileSync(__dirname + "/robo-smash.html", "utf8");
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];

const SEED = process.argv[2] || "";

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
  tick, key, p, cells, crushers, boxes, checkpoints, spikes, grid, telem, sfx,
  get goal(){return goal}, get LW(){return LW}, get telemN(){return telemN},
  get hitstop(){return hitstop}, set hitstop(v){hitstop=v},
  get jrec(){return jrec}, get SEED(){return SEED}, get deaths(){return deaths},
  respawn, solidAt, estimateArrival,
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

// ---- 1. structural checks across 200 seeds ----
let minLW = 1e9, maxLW = 0, cellNames = new Set();
for (let s = 1; s <= 200; s++) {
  const G = boot(String(s));
  if (G.LW < minLW) minLW = G.LW; if (G.LW > maxLW) maxLW = G.LW;
  G.cells.forEach(c => cellNames.add(c.name));
  if (!G.goal) { check(`seed ${s} goal`, false); break; }
  if (G.cells.length !== 7) { check(`seed ${s} cells`, false, G.cells.length); break; }
  // rows all same width
  const widths = new Set(G.grid.map(r => r.length));
  if (widths.size !== 1) { check(`seed ${s} ragged grid`, false, [...widths]); break; }
  // every ground gap is either <=4 tiles (single jump) or has platforms in it
  let gapStart = -1;
  for (let x = 0; x < G.LW; x++) {
    const solid = G.grid[10][x] === "#";
    if (!solid && gapStart < 0) gapStart = x;
    if (solid && gapStart >= 0) {
      const w = x - gapStart;
      if (w > 4) {
        let plat = false;
        for (let gx = gapStart; gx < x; gx++) for (let y = 0; y < 12; y++) if (G.grid[y][gx] === "=") plat = true;
        if (!plat) { check(`seed ${s} unbridged gap ${w} @${gapStart}`, false); s = 999; }
      }
      gapStart = -1;
    }
  }
  if (s === 999) break;
  // crushers wired to cell slack
  for (const c of G.crushers) {
    const cell = G.cells.find(cc => c.x/48 >= cc.x0 && c.x/48 < cc.x1);
    if (!cell || cell.knobs.slack == null || c.slack !== cell.knobs.slack) { check(`seed ${s} crusher slack`, false); s = 999; break; }
  }
}
check("200 seeds build (7 cells, goal, uniform grid, gaps sane)", fails === 0, `LW range ${minLW}-${maxLW}`);
check("all 5 cell types appear across seeds", cellNames.size === 5, [...cellNames]);

// ---- 2. C1 fix: jump tapped during hitstop is not eaten ----
{
  const G = boot("42");
  // settle onto ground
  for (let i = 0; i < 30; i++) G.tick();
  check("settled on ground", G.p.grounded);
  const restY = G.p.y, telBefore = G.telemN;
  G.hitstop = 4;
  G.key.j = true; G.tick();          // press during hitstop frame 1
  G.key.j = false; G.tick(); G.tick(); G.tick(); // release; hitstop drains
  let minY = restY;
  for (let i = 0; i < 30; i++) { G.tick(); if (G.p.y < minY) minY = G.p.y; }
  // eaten jump = 0px rise, no takeoff record; tap-in-freeze = min hop (cut applies)
  check("C1: jump tapped inside hitstop still fires", restY - minY > 4 && G.telemN > telBefore,
        `rose ${(restY-minY).toFixed(1)}px, records +${G.telemN-telBefore}`);
  // held through hitstop -> full-height jump
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
  const G = boot("7");
  const cr = G.crushers;
  check("seed 7 has crushers", cr.length > 0, cr.length);
  if (cr.length) {
    const c = cr[0];
    // teleport player near crusher, run toward it
    G.p.x = c.x - 300; G.p.y = 8*48; G.p.vx = 0;
    G.key.r = true;
    let teleFrames = 0, slamSeen = false, lockFrame = -1, slamFrame = -1;
    for (let i = 0; i < 300; i++) {
      G.tick();
      if (c.state === 4) { teleFrames++; if (lockFrame < 0) lockFrame = i; }
      if (c.state === 1 && !slamSeen) { slamSeen = true; slamFrame = i; }
      if (G.p.dead > 0) break;
    }
    check("crusher phase-locks on approach", lockFrame >= 0);
    check("telegraph >= 16f (250ms floor) before slam", !slamSeen || teleFrames >= 16, `tele=${teleFrames} slam@${slamFrame}`);
  }
}

// ---- 4. telemetry: records accumulate with cell context; export shape ----
{
  const G = boot("42");
  for (let i = 0; i < 30; i++) G.tick();
  // do a few jumps while running right
  G.key.r = true;
  for (let n = 0; n < 5; n++) {
    G.key.j = true; for (let i = 0; i < 12; i++) G.tick();
    G.key.j = false; for (let i = 0; i < 50; i++) G.tick();
    if (G.p.dead > 0) for (let i = 0; i < 70; i++) G.tick(); // ride out respawn
  }
  check("telemetry records accumulate", G.telemN > 0, G.telemN);
  const r = G.telem[0];
  const fields = ["t","kind","x","y","vx","vy","hold","spin","cell","knobs","outcome","landX","dy","air"];
  check("record has all tuple fields", r && fields.every(f => f in r), r && JSON.stringify(r));
  const held = G.telem.find(q => q.kind === "jump" && q.hold > 0);
  check("hold frames tracked", !!held, held && `hold=${held.hold}`);
}

// ---- 5. determinism: same seed -> identical layout; different seed -> different ----
{
  const a = boot("123"), b = boot("123"), c = boot("124");
  const flat = G => G.grid.map(r => r.join("")).join("\n") + "|" + JSON.stringify(G.cells);
  check("same seed = identical layout", flat(a) === flat(b));
  check("different seed = different layout", flat(a) !== flat(c));
}

// ---- 6. long random-input soak: no crashes, player can die+respawn ----
{
  const G = boot("99");
  let rngS = 1;
  const rnd = () => (rngS = (rngS * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 20000; i++) {
    if (i % 7 === 0) { G.key.r = rnd() < 0.7; G.key.l = !G.key.r && rnd() < 0.3; }
    if (i % 11 === 0) G.key.j = rnd() < 0.4;
    if (i % 23 === 0) G.key.s = rnd() < 0.2;
    G.tick();
  }
  check("20k-tick random soak, no crash", true, `deaths=${G.deaths} telem=${G.telemN}`);
}

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
