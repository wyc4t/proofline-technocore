import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';import {execFileSync} from 'node:child_process';
import {addLookup} from '../archive/lib/lookup.mjs';import {lookupCase} from '../src/lib/lookup.js';import {dayWindow} from '../archive/daily.mjs';import {releasePlan,prepareReleaseData} from '../archive/release.mjs';import {sha256} from '../archive/lib/records.mjs';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'proofline-release-test-'));

test('missing generation never inherits a known generation for archive lookup',async()=>{
 const dir=temp();try{
  const c=(generation,n)=>({ok:true,room:'kibble',generation,captured_at:`2026-10-27T08:0${n}:00Z`,new_sha256:'h'+n,new_first_seq:n,export_last_seq:n,events:[]});
  addLookup(dir,c('0',1),[{rec:{seq:1,text:'JOB v1 | known | build | valid locator'}}]);addLookup(dir,c(null,2),[{rec:{seq:2,text:'JOB v1 | unknown | build | generation unavailable'}}]);
  const get=id=>lookupCase({room:'kibble',id,base:'raw/',fetchText:async(u,{allowMissing=false}={})=>{const p=path.join(dir,u.replace('raw/lookup/',''));if(!fs.existsSync(p)&&allowMissing)return null;return fs.readFileSync(p,'utf8')}});
  const unknown=await get('unknown');assert.equal(unknown.candidates.length,0);assert.equal(unknown.status.unknown_generation,true);assert.equal(unknown.status.generation,'unknown');
  assert.equal((await get('known')).candidates[0].pin,'g0:1-1');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('selecting the same case while paused does not merge background records',()=>{
 const source=fs.readFileSync('src/app.js','utf8'),fn=source.slice(source.indexOf('function choose('),source.indexOf('\nfunction setDetailInert'));
 const ctx={selected:{key:'kibble:old',liveEpoch:'0:0',records:'frozen'},paused:true,cases:[],rooms:[],snapshot:null,wantedKey:null,wantedMissing:false,isNarrow:()=>false,allRecords:()=>[],retainSelection:()=>{throw Error('paused selection must not reconcile')},setUrl(){},render(){}};
 vm.runInNewContext(fn+'\nchoose({key:"kibble:old",liveEpoch:"0:0"})',ctx);assert.equal(ctx.selected.records,'frozen');
});

test('UTC days reject impossible dates rather than rolling to another month',()=>{
 for(const day of ['2026-02-30','2026-02-29','2026-13-01','2026-01-00','bad'])assert.throws(()=>dayWindow(day));
 assert.equal(new Date(dayWindow('2024-02-29').toMs).toISOString(),'2024-03-01T00:00:00.000Z');
});

function fixture(root){
 const data=path.join(root,'data'),assets=path.join(root,'assets');fs.writeFileSync(path.join(root,'raw'),fs.readFileSync('test/fixtures/conflict-k7319be7534.jsonl'));fs.writeFileSync(path.join(root,'headers'),'x-room-generation: 0\n');
 execFileSync(process.execPath,['archive/collect.mjs','--data',data,'--outbox',assets,'--release-rooms','kibble','--captured-at','2026-10-27T08:00:00Z','--import',`kibble=${path.join(root,'raw')},${path.join(root,'headers')}`]);
 return {data,assets,rooms:['kibble'],fromDay:'2026-10-26',throughDay:'2026-10-26',now:Date.parse('2026-10-27T08:10:00Z')};
}
function treeHashes(root){const out={};const walk=(dir)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.isFile())out[path.relative(root,p)]=sha256(fs.readFileSync(p))}};walk(root);return out}

test('offline release plan inventories missing assets and rejects stale/future snapshots and invalid ranges',()=>{
 const root=temp();try{
  const options=fixture(root),plan=releasePlan({...options,assets:undefined});assert.equal(plan.can_prepare_local_data,false);assert.equal(plan.totals.unavailable_assets,1);assert.ok(plan.totals.unavailable_declared_bytes>0);assert.equal(plan.publication_authorized,false);
  assert.ok(plan.inventory[0].url.startsWith('https://github.com/wyc4t/proofline-technocore/releases/download/'));
  assert.ok(releasePlan({...options,now:Date.parse('2026-10-29T08:00:00Z')}).blockers.some(x=>x.includes('older')));
  assert.ok(releasePlan({...options,now:Date.parse('2026-10-27T07:00:00Z')}).blockers.some(x=>x.includes('future capture')));
  assert.throws(()=>releasePlan({...options,fromDay:'2026-10-27',throughDay:'2026-10-26'}),/start/);
  assert.throws(()=>releasePlan({...options,throughDay:'2026-10-27'}),/before the current UTC day/);
  const out=path.join(root,'blocked');assert.throws(()=>prepareReleaseData({...options,assets:undefined,out}),/blocked/);assert.ok(!fs.existsSync(out));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('verified local rehearsal preserves source bytes and unselected history, with exact output hashes',()=>{
 const root=temp();try{
  const options=fixture(root),history={day:'2026-10-20',stats_version:'3',rooms:{kibble:{jobs:123}}},index=path.join(options.data,'stats/daily/index.json');fs.mkdirSync(path.dirname(index),{recursive:true});fs.writeFileSync(index,JSON.stringify({format:'proofline-daily',days:[history]})+'\n');
  const before=treeHashes(options.data),out=path.join(root,'release'),summary=prepareReleaseData({...options,out});assert.equal(summary.publication_authorized,false);assert.deepEqual(treeHashes(options.data),before);
  const days=JSON.parse(fs.readFileSync(path.join(out,'stats/daily/index.json'),'utf8')).days;assert.deepEqual(days.find(d=>d.day==='2026-10-20'),history);assert.equal(days[0].stats_version,'4');assert.equal(days[0].rooms.kibble.conflicts.cases,1);assert.equal(days[0].rooms.kibble.full_day,false,'fixture surrounding gaps remain partial');
  assert.ok(summary.outputs.length>0);for(const file of summary.outputs){assert.ok(file.path&&!file.path.startsWith('/')&&!file.path.includes('..'));assert.equal(sha256(fs.readFileSync(path.join(out,file.path))),file.sha256)}
  assert.ok(summary.outputs.some(f=>f.path==='plan.json'));assert.ok(fs.existsSync(path.join(out,'lookup/kibble/status.json')));
  assert.throws(()=>prepareReleaseData({...options,out}),/fresh/);assert.throws(()=>prepareReleaseData({...options,out:path.join(options.data,'nested')}),/outside source/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('tampered release bytes block rehearsal before an output directory is created',()=>{
 const root=temp();try{
  const options=fixture(root),cap=JSON.parse(fs.readFileSync(path.join(options.data,'captures.jsonl'),'utf8').trim()),file=path.join(options.assets,cap.storage.tag,cap.storage.asset);fs.appendFileSync(file,'changed');
  const plan=releasePlan(options);assert.equal(plan.can_prepare_local_data,false);assert.equal(plan.inventory[0].status,'hash-mismatch');
  const out=path.join(root,'tampered-output');assert.throws(()=>prepareReleaseData({...options,out}),/blocked/);assert.ok(!fs.existsSync(out));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
