// Characterization of the CURRENT app.js (commit 88fc10c). Asserts today's defective behaviour so each fix flips one line.
import fs from 'node:fs'; import vm from 'node:vm';
const src=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const stub=new Proxy(function(){},{get:(t,p)=>p===Symbol.toPrimitive?()=> '':stub,apply:()=>stub,set:()=>true});
function load(messagesByRoom){
  const ctx={document:stub,console,fetch:async()=>({ok:true,json:async()=>({messages:[]})}),setInterval(){},requestAnimationFrame(){},addEventListener(){},devicePixelRatio:1,URLSearchParams,Date,Math,Number,String,Set,Map,Promise,Array,Object};
  vm.createContext(ctx);
  vm.runInContext(src.replace(/\n\$\('#refresh'\)\.onclick[\s\S]*$/,'\n'),ctx);
  vm.runInContext('records=[];',ctx);
  for(const [room,list] of Object.entries(messagesByRoom))for(const m of list){const p=vm.runInContext('parseMessage',ctx)(m,room);if(p)vm.runInContext('records',ctx).push(p)}
  vm.runInContext('buildCases()',ctx);
  return JSON.parse(vm.runInContext('JSON.stringify(cases.map(c=>({id:c.id,status:c.status,title:c.title,stages:c.stages.map(s=>s.length),semantic:c.semantic,independent:c.independent,negative:c.negative,rooms:[...new Set(c.list.map(r=>r.room))]})))',ctx));
}
const syn=JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic.json',import.meta.url)));
let fail=0; const eq=(name,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);console.log(ok?'ok  ':'FAIL',name,ok?'':`got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);if(!ok)fail++};
const one=(n)=>load(syn[n].rooms)[0];
let c=one('cross-room-forgery'); eq('KNOWN DEFECT cross-room merge: title taken from credence',c.title,'FORGED TITLE posted in another room'); eq('  rooms merged',c.rooms.sort(),['credence','kibble']);
c=one('attestation-only'); eq('KNOWN DEFECT attestation without result reports independent=true',c.independent,true);
c=one('mixed-verdicts'); eq('KNOWN DEFECT 2 useful + 1 not => whole case disputed',c.status,'disputed');
c=one('echo-and-ok'); eq('KNOWN DEFECT bare "ok" scores 50% lexical overlap',c.semantic,0.5);
c=one('many-claims'); eq('12 claims parsed (UI draws only 7)',c.stages[1],12);
process.exit(fail?1:0);
