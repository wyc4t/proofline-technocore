import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {ingest} from '../archive/collect.mjs';
import {GUIDED_CASES,loadGuidedCase} from '../src/lib/examples.js';
import {parseRoomPage,annotateSignatures,annotateContentHashes} from '../src/lib/signature.js';
import {parseMessage} from '../src/lib/protocol.js';
import {buildCases,titleFor} from '../src/lib/cases.js';
const sha = x=>createHash('sha256').update(x).digest('hex');
const input={room:'credence',generation:'0',capturedAt:'2026-10-27T08:00:00Z',httpStatus:200,prev:{generation:'0',last_seq:13281,last_capture:'2026-10-26T12:00:00Z'}};

test('empty exports record observations without moving the archived cursor or asserting a wipe',()=>{
 const empty=ingest({...input,body:Buffer.alloc(0)});
 assert.equal(empty.nextState.last_seq,13281);
 assert.equal(empty.nextState.export_empty,true);
 assert.equal(empty.nextState.observed_export_last_seq,null);
 assert.equal(empty.nextState.empty_observed_since,input.capturedAt);
 assert.deepEqual(empty.entry.events,[{type:'empty_export',first_observed_at:input.capturedAt,archived_last_seq:13281}]);
 const again=ingest({...input,body:Buffer.alloc(0),prev:empty.nextState,capturedAt:'2026-10-27T09:00:00Z'});
 assert.equal(again.nextState.empty_observed_since,input.capturedAt);
 assert.equal(again.entry.new_records,0);
 assert.doesNotMatch(JSON.stringify(again),/wipe|deleted|malicious/);
 const changed=ingest({...input,body:Buffer.alloc(0),generation:'1',prev:again.nextState,capturedAt:'2026-10-27T10:00:00Z'});
 assert.equal(changed.nextState.empty_observed_since,'2026-10-27T10:00:00Z');
 assert.equal(changed.nextState.last_seq,null,'old generation cursor does not become new generation cursor');
});

test('malformed/truncated exports are unknown, nonempty exports clear the empty observation, regressions still surface',()=>{
 const first=ingest({...input,body:Buffer.alloc(0)});
 for(const body of [Buffer.from('not json\n'),Buffer.from('{"seq":1')]){
  const r=ingest({...input,body,prev:first.nextState});
  assert.equal(r.nextState.export_empty,null);assert.equal(r.nextState.empty_observed_since,null);
  assert.ok(!r.entry.events.some(e=>e.type==='empty_export'));
  assert.equal(r.nextState.last_seq,13281);
 }
 const body=Buffer.from('{"seq":1,"ts":"2026-10-27T09:00:00Z","from":"nick","text":"hello"}\n');
 const restarted=ingest({...input,body,prev:first.nextState});
 assert.equal(restarted.nextState.export_empty,false);assert.equal(restarted.nextState.empty_observed_since,null);
 assert.ok(restarted.entry.events.some(e=>e.type==='seq_regression'));
 const unknownGeneration=ingest({...input,generation:undefined,body:Buffer.alloc(0)});
 assert.ok(!unknownGeneration.entry.events.some(e=>e.type==='generation_change'));
});

function bundleIO(overrides=new Map()){
 const calls=[];
 const get=u=>{calls.push(u);return overrides.get(u)??fs.readFileSync('dist/'+u.replace('local/',''));};
 return {calls,base:'local/',fetchText:async u=>String(get(u)),fetchBytes:async u=>new Uint8Array(Buffer.from(get(u)))};
}

test('all four guided bundles use two small local requests and preserve their signature/key/conflict observations',async()=>{
 for(const item of GUIDED_CASES){
  const io=bundleIO(),loaded=await loadGuidedCase({...item,...io});
  assert.equal(io.calls.length,2);assert.equal(loaded.curated,true);assert.equal(loaded.missing,null,'case-only is not represented as a complete window');
  assert.ok(loaded.bundle.bytes<7000);
  const ms=loaded.lines.map(l=>parseRoomPage(new TextDecoder().decode(l)));
  const room=item.key.split(':')[0];await annotateSignatures(room,ms);await annotateContentHashes(ms);
  const c=buildCases(ms.map(m=>parseMessage(m,room).record))[0];
  assert.equal(c.key,item.key);assert.equal(c.stages.filter(s=>s.length).length,4);
  if(item.key.endsWith('tee6121dd03'))assert.deepEqual(c.list.map(r=>r.sigStatus),Array(4).fill('no_sig'));
  else assert.ok(c.list.every(r=>r.sigStatus==='valid'));
  if(room==='kibble')assert.deepEqual(c.conflicts[0].results,[21334926]);
 }
 const io=bundleIO();assert.equal(await loadGuidedCase({key:'kibble:other',pin:'g0:1-2',...io}),null);assert.equal(io.calls.length,0);
});

test('guided bundles reject changed bytes and even manifest-matched unexpected records/paths',async()=>{
 const entry=GUIDED_CASES[0],url='local/examples-data/credence-tfecd8da94c.jsonl';
 const raw=fs.readFileSync('dist/examples-data/credence-tfecd8da94c.jsonl','utf8');
 await assert.rejects(loadGuidedCase({...entry,...bundleIO(new Map([[url,raw.replace('TASK','TA5K')]]))}),/does not match/);
 const manifest=JSON.parse(fs.readFileSync('dist/examples-data/manifest.json','utf8'));
 manifest.cases[0].file='../../other.jsonl';
 await assert.rejects(loadGuidedCase({...entry,...bundleIO(new Map([['local/examples-data/manifest.json',JSON.stringify(manifest)]]))}),/Invalid/);
 manifest.cases[0].file='credence-tfecd8da94c.jsonl';
 const wrong=raw.replaceAll('tfecd8da94c','other');manifest.cases[0].sha256=sha(wrong);
 await assert.rejects(loadGuidedCase({...entry,...bundleIO(new Map([['local/examples-data/manifest.json',JSON.stringify(manifest)],[url,wrong]]))}),/unexpected records/);
});

test('full titles remain available; list abbreviation uses an ellipsis and full hover text',()=>{
 const title='A very long title '.repeat(20),r=parseMessage({seq:1,text:`JOB v1 | long | build | ${title}`} ,'kibble').record;
 assert.equal(titleFor([r],'long'),title.trim());
 const app=fs.readFileSync('src/app.js','utf8');assert.match(app,/title\.title=item\.title/);assert.match(app,/trimEnd\(\)\+'…'/);
});

test('collector CLI persists an empty observation in both capture log and state',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'proofline-empty-'));
 try{
  const data=join(dir,'data');mkdirSync(data);writeFileSync(join(data,'state.json'),JSON.stringify({rooms:{credence:input.prev}}));
  writeFileSync(join(dir,'empty'),'');writeFileSync(join(dir,'headers'),'x-room-generation: 0\n');
  execFileSync(process.execPath,['archive/collect.mjs','--data',data,'--captured-at',input.capturedAt,'--import',`credence=${join(dir,'empty')},${join(dir,'headers')}`]);
  const state=JSON.parse(readFileSync(join(data,'state.json'),'utf8')).rooms.credence;
  const cap=JSON.parse(readFileSync(join(data,'captures.jsonl'),'utf8').trim());
  assert.equal(state.last_seq,13281);assert.equal(state.export_empty,true);assert.equal(state.empty_observed_since,input.capturedAt);
  assert.equal(cap.events[0].type,'empty_export');assert.equal(cap.storage.kind,'none');assert.equal(cap.new_records,0);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
