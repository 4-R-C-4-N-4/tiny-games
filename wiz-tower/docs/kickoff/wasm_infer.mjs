import * as ort from 'onnxruntime-web';
import fs from 'fs';
ort.env.wasm.wasmPaths = new URL('./node_modules/onnxruntime-web/dist/', import.meta.url).href;
ort.env.wasm.numThreads = 1;
const io = JSON.parse(fs.readFileSync('test_io.json'));
const { elems:ELEMS, traits:TRAITS, cases } = io;
const argmax = a => { let b=0; for(let i=1;i<a.length;i++) if(a[i]>a[b]) b=i; return b; };

async function bench(path){
  const sess = await ort.InferenceSession.create(path, { executionProviders:['wasm'] });
  let maxerr=0, okOracle=0, lat=[];
  for(const c of cases){
    const x=new ort.Tensor('float32', Float32Array.from(c.x), [1,10]);
    const s=performance.now(); const out=await sess.run({x}); lat.push(performance.now()-s);
    const leak=out.leak.data;
    for(let i=0;i<leak.length;i++) maxerr=Math.max(maxerr, Math.abs(leak[i]-c.ref[i]));
    if(argmax(leak)===c.oracle) okOracle++;
  }
  lat.sort((a,b)=>a-b);
  return {maxerr, oracle:100*okOracle/cases.length, med:lat[lat.length>>1]};
}

for(const [name,path] of [['float32','./attacker.onnx'],['int8','./attacker.int8.onnx']]){
  const r=await bench(path);
  console.log(`${name.padEnd(7)} | vs float ref: ${r.maxerr.toExponential(2)} | agrees w/ search oracle: ${r.oracle.toFixed(1)}% | ${r.med.toFixed(3)} ms/call`);
}
const a=cases[0].oracle;
console.log(`\nWASM backend live in Node (single thread). ${cases.length} defenses scored.`);
console.log(`e.g. defense #0 -> search says attack with: ${ELEMS[Math.floor(a/TRAITS.length)]} ${TRAITS[a%TRAITS.length]}`);
