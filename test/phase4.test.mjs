import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {addLookup,lookupBucket} from '../archive/lib/lookup.mjs';
import {lookupCase} from '../src/lib/lookup.js';
import {rebuildLookup} from '../archive/lookup.mjs';
import {parseMessage} from '../src/lib/protocol.js';
import {parseLine} from '../archive/lib/records.mjs';
import {roomStats} from '../archive/stats.mjs';
import {buildCases} from '../src/lib/cases.js';
import {roomPopulation} from '../src/lib/population.js';
import {verdictCountText} from '../src/lib/presentation.js';
const temp=()=>fs.mkdtempSync(join(tmpdir(),'proofline-phase4-'));
const line=(seq,text)=>({rec:{seq,text,from:'nick',ts:'2026-10-26T08:00:00Z'}});
const cap=(n,gen='0',events=[])=>({ok:true,room:'kibble',generation:gen,captured_at:`2026-10-27T08:${String(n).padStart(2,'0')}:00Z`,new_sha256:`hash-${n}`,new_first_seq:n,export_last_seq:n,events});
const fetchLocal=root=>async(url,{allowMissing=false}={})=>{const p=join(root,url.replace('raw/lookup/',''));if(!fs.existsSync(p)&&allowMissing)return null;return fs.readFileSync(p,'utf8')};
const lookup=(root,id='same',room='kibble')=>lookupCase({room,id,base:'raw/',fetchText:fetchLocal(root)});

test('lookup extends a candidate, is idempotent and isolates room/generation/reset epochs',async()=>{
 const root=temp();try{
  const a=cap(1);addLookup(root,a,[line(1,'JOB v1 | same | build | original')]);addLookup(root,a,[line(1,'JOB v1 | same | build | original')]);
  addLookup(root,cap(2),[line(2,'RESULT v1 | same | answer')]);
  let r=await lookup(root);assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].records,2);assert.equal(r.candidates[0].pin,'g0:1-2');assert.equal(r.candidates[0].request_seen,true);
  addLookup(root,{...cap(3),new_first_seq:1,export_last_seq:1,events:[{type:'seq_regression'}]},[line(1,'JOB v1 | same | build | reused sequence')]);
  r=await lookup(root);assert.equal(r.candidates.length,2);assert.ok(r.candidates.every(c=>c.ambiguous));
  addLookup(root,{...cap(4,'1'),new_first_seq:1,export_last_seq:1},[line(1,'JOB v1 | same | build | next generation')]);
  addLookup(root,{...cap(4),room:'credence'},[line(4,'TASK v1 | same | build | another room')]);
  r=await lookup(root);assert.equal(r.candidates.length,3);assert.equal(r.candidates[2].pin,'g1:1-1');assert.equal(r.candidates[2].ambiguous,false);
  assert.equal((await lookup(root,'same','credence')).candidates[0].pin,'g0:4-4');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('lookup exposes index gaps, missing shard is a scoped miss, invalid input/ranges are errors',async()=>{
 const root=temp();try{
  addLookup(root,cap(1),[line(1,'JOB v1 | same | build | task')]);addLookup(root,{...cap(9),new_first_seq:9},[line(9,'RESULT v1 | same | response')]);
  const r=await lookup(root);assert.equal(r.status.index_gaps.length,1);assert.equal((await lookup(root,'absent')).candidates.length,0);
  for(const id of ['../x','x?y','', 'a'.repeat(65)])await assert.rejects(lookup(root,id),/Choose a supported/);
  const path=join(root,'kibble',lookupBucket('same')+'.json'),s=JSON.parse(fs.readFileSync(path));
  fs.renameSync(path,path+'.missing');await assert.rejects(lookup(root),/shard unavailable/);fs.renameSync(path+'.missing',path);s.entries[0].first=-1;fs.writeFileSync(path,JSON.stringify(s));await assert.rejects(lookup(root),/Invalid candidate/);
  await assert.rejects(lookup(root,'same','../../x'),/Choose a supported/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('long-lived IDs split into pins within the archive loader range limit',async()=>{
 const root=temp();try{
  addLookup(root,cap(1),[line(1,'JOB v1 | same | build | x')]);addLookup(root,{...cap(2),new_first_seq:6000001,export_last_seq:6000001},[line(6000001,'RESULT v1 | same | late answer')]);
  const r=await lookup(root);assert.equal(r.candidates.length,2);assert.deepEqual(r.candidates.map(c=>c.pin),['g0:1-1','g0:6000001-6000001']);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('collector and explicit rebuild produce locators from verified available bytes; no output overwrite',async()=>{
 const root=temp();try{
  const raw=fs.readFileSync('test/fixtures/conflict-k7319be7534.jsonl');fs.writeFileSync(join(root,'case'),raw);fs.writeFileSync(join(root,'headers'),'x-room-generation: 0\n');
  const data=join(root,'data');execFileSync(process.execPath,['archive/collect.mjs','--data',data,'--captured-at','2026-10-27T08:00:00Z','--import',`kibble=${join(root,'case')},${join(root,'headers')}`]);
  const live=await lookup(join(data,'lookup'),'k7319be7534');assert.equal(live.candidates[0].pin,'g0:21334912-21337127');
  const out=join(root,'rebuilt');rebuildLookup({data,out});assert.equal((await lookup(out,'k7319be7534')).candidates[0].records,7);
  assert.throws(()=>rebuildLookup({data,out}),/already exists/);
  assert.ok((await lookup(out,'k7319be7534')).status.known_archive_gaps>0,'case-only fixture has surrounding sequence gaps');
  const capLog=JSON.parse(fs.readFileSync(join(data,'captures.jsonl'),'utf8').trim()),file=join(data,capLog.storage.files[0]);fs.appendFileSync(file,'tamper\n');
  // A changed complete line inside the captured range is caught by the archive hash check.
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('Cap-and-trade','Altered-cap'));
  assert.throws(()=>rebuildLookup({data,out:join(root,'tampered')}),/integrity problems/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('placeholder indicator is literal and neutral; ordinary braces, JSON and code templates are controls',()=>{
 const one=text=>buildCases([parseMessage({seq:1,text:`JOB v1 | p | build | ${text}`},'kibble').record])[0];
 assert.match(one('Harden a public {p0} instance').flags.find(f=>f.id==='template-slots').detail,/may be an unfilled slot or intentional notation/);
 for(const t of ['JSON {"p0":true}','Use {name} as a placeholder','Render ${value} in code','Render ${p0} in code','Template {{p0}} in code','Object {timeout: 30}','A complete request'])assert.ok(!one(t).flags.some(f=>f.id==='template-slots'),t);
});

test('text frequencies use record denominators and remain room-scoped',()=>{
 const p=(seq,id,room,body)=>parseMessage({seq,text:`ATTEST v1 | ${id} | useful | ${body}`},room).record;
 const rs=[p(1,'a','kibble','A repeated attestation sentence'),p(2,'a','kibble','a repeated  attestation sentence'),p(3,'b','kibble','Other distinct attestation content'),p(4,'c','credence','a repeated attestation sentence')];
 const pop=roomPopulation(rs.filter(r=>r.room==='kibble'));assert.equal(pop.attestations.records,3);assert.equal(pop.attestations.top.records,2);assert.equal(pop.attestations.top.share_pct,66.7);
 const c=buildCases(rs);assert.ok(c.every(x=>!x.flags.some(f=>f.id==='reused-attestation')),'same text in another room does not create a same-room reuse flag');
 rs.push(p(5,'d','kibble','a repeated attestation sentence'));
 const flag=buildCases(rs).find(c=>c.id==='a').flags.find(f=>f.id==='reused-attestation');assert.match(flag.detail,/3 of 4 attestation records \(75%\)/);
});

test('archive conflict statistics separate negative records from same-result cases and retain text denominators',()=>{
 const entries=fs.readFileSync('test/fixtures/conflict-k7319be7534.jsonl','utf8').trim().split('\n').map(raw=>({...parseLine(Buffer.from(raw)),gen:'0'}));
 const s=roomStats('kibble',entries,{fromMs:Date.parse('2026-10-26T00:00:00Z'),toMs:Date.parse('2026-10-27T00:00:00Z')});
 assert.equal(s.attestations.negative,1);assert.deepEqual(s.conflicts,{cases:1,result_text_groups:1});assert.equal(s.population.attestations.records,2);
 const changed=entries.map(p=>({...p,rec:{...p.rec,text:p.rec.text.replace('rh:4c359af368966e4f','rh:0000000000000000')}}));
 assert.equal(roomStats('kibble',changed,{fromMs:Date.parse('2026-10-26'),toMs:Date.parse('2026-10-27')}).conflicts.cases,0);
 assert.match(verdictCountText(null,null),/unavailable negative verdict records.*unavailable same-result conflict cases/);
});

test('share cards distinguish negative records from conflict cases and do not invent legacy zeroes',async()=>{
 const {siteCard,dayCard}=await import('../api/card.js');
 const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(' '):n?.props?text(n.props.children):'';
 const k={window_start:'2026-10-26T00:00:00Z',window_end:'2026-10-27T00:00:00Z',from_ts:'2026-10-26T01:00:00Z',to_ts:'2026-10-26T23:00:00Z',jobs:{records:10},outcomes:{},attestations:{negative:9},negative_attestations:9,conflicts:{cases:2}};
 for(const card of [siteCard({rooms:{kibble:k}}),dayCard({day:'2026-10-26',rooms:{kibble:{...k,jobs:10}}})])assert.match(text(card),/9 negative verdict records · 2 same-result conflict cases/);
 delete k.conflicts;assert.match(text(siteCard({rooms:{kibble:k}})),/unavailable same-result conflict cases/);
});
