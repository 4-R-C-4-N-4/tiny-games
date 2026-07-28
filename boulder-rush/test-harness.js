// Headless harness for boulder-rush.html — stubs browser APIs, drives tick() directly.
const fs = require("fs"), vm = require("vm");
const html = fs.readFileSync(__dirname + "/boulder-rush.html", "utf8");
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
    location: { search: seedQ ? `?seed=${seedQ}` : "", reload: () => {}, href: "http://x/?seed="+seedQ },
    document: { getElementById: () => ({ getContext: () => absorb(), addEventListener: () => {}, getBoundingClientRect: () => ({left:0,top:0,width:540,height:960}) }),
                createElement: () => ({ click: () => {} }) },
    window: {}, addEventListener: () => {}, requestAnimationFrame: () => {},
    performance: { now: () => 0 }, setTimeout: () => 0,
    URL: function(u){ this.searchParams={set:()=>{}}; this.toString=()=>u; }, Blob: function(){},
    localStorage: { getItem: () => null, setItem: () => {} },
    Math, JSON, Array, Object, Symbol, Proxy, console, Date,
  };
  ctx.URL.createObjectURL = () => ""; ctx.URL.revokeObjectURL = () => {};
  ctx.globalThis = ctx;
  return vm.createContext(ctx);
}
const expose = `
globalThis.__G={
  tick,p,rows,picks,telem,events,steerHist,ensureCourse,boulderPolicy,stumble,knobs,
  get started(){return started}, set started(v){started=v},
  get gap(){return gap}, set gap(v){gap=v},
  get spd(){return spd}, set spd(v){spd=v},
  get bSpd(){return bSpd},
  get lungeState(){return lungeState}, set nextLunge(v){nextLunge=v},
  get lastStumble(){return lastStumble}, set lastStumble(v){lastStumble=v},
  get perf(){return perf}, get telemN(){return telemN}, get eventsN(){return eventsN},
  get bolts(){return bolts}, set jumpQueued(v){jumpQueued=v},
  C:{LEAD,SPD_MAX,GAPMIN,GAP_FLOOR,CATCH,JUMP_T,ROAR_T,LUNGE_GAP,STUMBLE_WIN,PW},
};`;
function boot(seedQ){ const c=makeCtx(seedQ); vm.runInContext(src+"\n"+expose,c); return c.__G; }

let fails=0;
function check(name,cond,extra){ if(!cond){fails++;console.log("FAIL:",name,extra??"");} else console.log("ok:",name); }

// gap analysis for a row: is there a passable path?
// Spans are inflated by PW/2 (the real collision rule), so the required
// clear gap between them is just a safety margin, not the player width.
function rowPassable(G,row){
  const totems=row.obs.filter(o=>o.type==="totem");
  if(!totems.length) return true;                       // everything else is jumpable
  const need=0.10;
  const spans=totems.map(o=>[o.x-o.w/2-G.C.PW/2,o.x+o.w/2+G.C.PW/2]).sort((a,b)=>a[0]-b[0]);
  let cursor=-1;
  for(const [a,b] of spans){ if(a-cursor>=need) return true; cursor=Math.max(cursor,b); }
  return 1-cursor>=need;
}

// ---- 1. floors + passability across 200 seeds ----
{
  const G0=boot("1");
  check("reveal floor: LEAD/SPD_MAX >= 42f (700ms)", G0.C.LEAD/G0.C.SPD_MAX>=42, (G0.C.LEAD/G0.C.SPD_MAX).toFixed(1));
  check("roar telegraph >= 30f (500ms)", G0.C.ROAR_T>=30);
  check("lunge floor above catch", G0.C.LUNGE_GAP>G0.C.CATCH*2);
  let bad=0, total=0;
  for(let s=1;s<=200;s++){
    const G=boot(String(s));
    G.started=true;
    for(let i=0;i<40;i++){ G.p.z+=15; G.ensureCourse(); }
    for(const row of G.rows){ total++; if(!rowPassable(G,row)) bad++; }
  }
  check("every generated row passable (200 seeds)", bad===0, `${bad}/${total} bad`);
}

// ---- 2. determinism: same seed -> same course + same director schedule ----
{
  const sig=G=>{
    G.started=true;
    for(let i=0;i<4000;i++){ G.p.tx=Math.sin(i/40)*0.8; if(i%50===0)G.jumpQueued=true; G.tick(); }
    return JSON.stringify(G.rows.map(r=>[+r.z.toFixed(2),r.obs.map(o=>[o.type,+o.x.toFixed(3)])]))+
           "|"+G.gap.toFixed(3)+"|"+G.p.z.toFixed(2)+"|"+G.eventsN;
  };
  const a=sig(boot("77")), b=sig(boot("77")), c=sig(boot("78"));
  check("same seed = identical course + gap trace", a===b);
  check("different seed diverges", a!==c);
}

// ---- 3. steering: critically damped, no overshoot (F1/F2) ----
{
  const G=boot("5"); G.started=true;
  G.p.x=-1; G.p.tx=0.5;
  let prev=G.p.x, mono=true, over=false;
  for(let i=0;i<200;i++){ G.tick(); if(G.p.x<prev-1e-9)mono=false; if(G.p.x>0.5+1e-6)over=true; prev=G.p.x; }
  check("steering approaches monotonically", mono);
  check("steering never overshoots target", !over);
  check("steering converges", Math.abs(G.p.x-0.5)<0.01, G.p.x.toFixed(3));
}

// ---- perfect bot ----
function botStep(G){
  const ahead=G.rows.filter(r=>r.z-G.p.z>0&&r.z-G.p.z<=G.C.LEAD).sort((a,b)=>a.z-b.z)[0];
  if(ahead){
    const rel=ahead.z-G.p.z, totems=ahead.obs.filter(o=>o.type==="totem");
    if(totems.length){
      const spans=totems.map(o=>[o.x-o.w/2-G.C.PW/2,o.x+o.w/2+G.C.PW/2]).sort((a,b)=>a[0]-b[0]);
      let cursor=-1,gx=0,bw=-1;
      for(const [a,b] of spans){ if(a-cursor>bw){bw=a-cursor;gx=(cursor+a)/2;} cursor=Math.max(cursor,b); }
      if(1-cursor>bw){bw=1-cursor;gx=(cursor+1)/2;}
      G.p.tx=Math.max(-1,Math.min(1,gx));
    } else if(rel<G.spd*13) G.jumpQueued=true;
  }
  G.tick();
}

// ---- 4. fairness: perfect bot is never caught ----
{
  const G=boot("42"); G.started=true;
  let minGap=99, stumbles0=0;
  for(let i=0;i<20000;i++){
    botStep(G);
    if(G.p.dead) break;
    if(G.gap<minGap) minGap=G.gap;
    if(G.p.stumble>0) stumbles0++;
  }
  check("perfect bot survives 20k ticks", !G.p.dead, `dist ${Math.floor(G.p.z)}m`);
  check("perfect bot never stumbles", stumbles0===0, stumbles0);
  check("gap never dips below the lunge floor", minGap>=G.C.LUNGE_GAP-0.6, minGap.toFixed(2));
}

// ---- 5. stumble mechanics + touchstone #2 (boulder gains within 250ms) ----
{
  const G=boot("9"); G.started=true;
  for(let i=0;i<200;i++) botStep(G);
  const spdBefore=G.spd, gapBefore=G.gap;
  G.rows.length=0; G.rows.push({z:G.p.z+0.3,obs:[{x:G.p.x,w:0.34,type:"rock"}],passed:false,crushed:false});
  G.p.tx=G.p.x;
  for(let i=0;i<4;i++) G.tick();       // walk into it, no jump
  check("collision without jump = stumble", G.p.stumble>0);
  check("stumble slows the runner", G.spd<spdBefore*0.85, `${spdBefore.toFixed(3)}->${G.spd.toFixed(3)}`);
  for(let i=0;i<15;i++) G.tick();      // 250ms
  check("boulder visibly gains within 250ms of a mistake", gapBefore-G.gap>=0.5, (gapBefore-G.gap).toFixed(2));
  const rec=G.telem.find(r=>r&&r.outcome==="stumble");
  check("stumble recorded in telemetry", !!rec);
  const inv=G.p.stumble;
  G.rows.push({z:G.p.z+0.3,obs:[{x:G.p.x,w:0.34,type:"rock"}],passed:false,crushed:false});
  for(let i=0;i<6;i++) G.tick();
  check("invuln prevents double-stumble", G.events.filter(e=>e&&e.type==="stumble").length===1);
}

// ---- 6. lunge: roar telegraph strictly precedes the close ----
{
  const G=boot("13"); G.started=true;
  for(let i=0;i<300;i++) botStep(G);
  G.lastStumble=-99999; G.gap=14; G.nextLunge=G.perf+1;
  let roarAt=-1, closeStart=-1, preRoarGap=G.gap, minGap=99;
  for(let i=0;i<400;i++){
    botStep(G);
    if(roarAt<0&&G.events.some(e=>e&&e.type==="roar")) roarAt=G.perf;
    if(roarAt>0&&closeStart<0&&G.gap<preRoarGap-1.2) closeStart=G.perf;
    if(G.gap<minGap)minGap=G.gap;
    if(G.p.dead) break;
  }
  check("lunge roars first", roarAt>0);
  check("telegraph >= 30f before the gap closes", closeStart<0||closeStart-roarAt>=30, `${closeStart-roarAt}f`);
  check("lunge is survivable for a clean runner", !G.p.dead&&minGap>=G.C.LUNGE_GAP-0.8, minGap.toFixed(2));
}

// ---- 7. only the boulder kills; death is logged with cause ----
{
  const G=boot("21"); G.started=true;
  for(let i=0;i<100;i++) botStep(G);
  G.lastStumble=G.perf; G.gap=G.C.CATCH-0.1;
  G.tick();
  check("gap <= CATCH kills", G.p.dead);
  const d=G.events.find(e=>e&&e.type==="death");
  check("death event carries cause + distance", !!d&&d.cause==="boulder"&&d.dist>0, JSON.stringify(d));
  const before=G.p.z; G.tick();
  check("sim halts after death", G.p.z===before);
}

// ---- 8. telemetry + pickups ----
{
  const G=boot("42"); G.started=true;
  for(let i=0;i<6000;i++) botStep(G);
  check("row outcomes accumulate", G.telemN>10, G.telemN);
  const r=G.telem[0];
  check("record shape", r&&["t","z","type","xs","px","gap","outcome"].every(f=>f in r), r&&JSON.stringify(r));
  check("steer histogram fills", G.steerHist.reduce((a,b)=>a+b,0)>0);
}

// ---- 9. 30k-tick pointer-fuzz soak ----
{
  const G=boot("99"); G.started=true;
  let rs=1; const rnd=()=>(rs=(rs*48271)%2147483647)/2147483647;
  let t=0;
  for(;t<30000&&!G.p.dead;t++){
    if(t%5===0) G.p.tx=rnd()*2-1;
    if(t%17===0&&rnd()<0.5) G.jumpQueued=true;
    G.tick();
  }
  check("30k fuzz soak, no crash", true, `ticks ${t}, dist ${Math.floor(G.p.z)}m, dead ${G.p.dead}, telem ${G.telemN}`);
}

console.log(fails===0?"\nALL CHECKS PASSED":`\n${fails} FAILURES`);
process.exit(fails?1:0);
