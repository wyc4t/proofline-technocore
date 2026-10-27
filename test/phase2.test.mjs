import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseMessage} from '../src/lib/protocol.js';
import {buildCases,attestationTargetText,describeAttestations,conflictingVerdicts} from '../src/lib/cases.js';
import {annotateContentHashes} from '../src/lib/signature.js';
import {createRoomState,applyPage,markOk,markError,coverage,allRecords} from '../src/lib/store.js';
import {retainSelection,roomEpoch} from '../src/lib/selection.js';
import {liveRoomText} from '../src/lib/presentation.js';
const hash = s => createHash('sha256').update(s).digest('hex');
const msg = (seq,text) => ({seq,text,ts:`2026-10-27T08:00:${String(seq%60).padStart(2,'0')}Z`,from:'nick'});
const parse = (seq,text) => parseMessage(msg(seq,text),'kibble').record;
const job = msg(1,'JOB v1 | selected | build | Request to keep');
const result = msg(2,'RESULT v1 | selected | Result to keep');
const casesFor = (states) => buildCases(allRecords(states)).map(c=>({...c,liveEpoch:roomEpoch(states.find(s=>s.room===c.room)),liveGeneration:String(states.find(s=>s.room===c.room).generation)}));

test('selected records survive partial eviction, whole-case eviction and subsequent late results', () => {
  const s=createRoomState('kibble');
  applyPage(s,{messages:[job,result],generation:0,last_seq:2},{cap:2});
  let selected=casesFor([s])[0];
  applyPage(s,{messages:[msg(3,'JOB v1 | next | build | Different request')],generation:0,last_seq:3},{since:2,cap:2});
  selected=retainSelection(selected,casesFor([s]),allRecords([s]),[s]);
  assert.deepEqual(selected.list.map(r=>r.seq),[1,2]);
  assert.equal(selected.retained,true);
  assert.equal(selected.status,'partial');
  applyPage(s,{messages:[msg(4,'RESULT v1 | next | Different result')],generation:0,last_seq:4},{since:3,cap:2});
  selected=retainSelection(selected,casesFor([s]),allRecords([s]),[s]);
  assert.deepEqual(selected.list.map(r=>r.seq),[1,2]);
  assert.equal(casesFor([s]).some(c=>c.id==='selected'),false,'held case stays out of live filters/counts');
  applyPage(s,{messages:[msg(5,'ATTEST v1 | selected | useful | late claim')],generation:0,last_seq:5},{since:4,cap:2});
  selected=retainSelection(selected,casesFor([s]),allRecords([s]),[s]);
  assert.deepEqual(selected.list.map(r=>r.seq),[1,2,5]);
  assert.equal(selected.retained,true);
  assert.equal(s.records.size,2,'holding one case does not expand the room store');
});

test('retained records never merge reused IDs/sequences across generation or same-generation resets', () => {
  for(const generation of [0,1]){
    const s=createRoomState('kibble');applyPage(s,{messages:[job,result],generation:0,last_seq:2});
    const selected=casesFor([s])[0];
    applyPage(s,{messages:[msg(1,'JOB v1 | selected | build | Reused ID in reset')],generation,last_seq:1},{since:2});
    const held=retainSelection(selected,casesFor([s]),allRecords([s]),[s]);
    assert.equal(held.epochChanged,true);
    assert.deepEqual(held.list.map(r=>r.text),selected.list.map(r=>r.text));
    assert.equal(held.liveGeneration,'0','pin retains the original generation');
    assert.notEqual(held.liveEpoch,roomEpoch(s));
  }
});

test('different room state and page failures cannot replace the selection; choosing a new case releases it', () => {
  const s=createRoomState('kibble'),other=createRoomState('credence');applyPage(s,{messages:[job,result],generation:0,last_seq:2});
  const selected=casesFor([s,other])[0];markError(s,'503',100);
  applyPage(other,{messages:[msg(1,'JOB v1 | selected | build | Foreign room')],generation:9,last_seq:1});
  const held=retainSelection(selected,casesFor([s,other]),allRecords([s,other]),[s,other]);
  assert.equal(held.room,'kibble');assert.deepEqual(held.list.map(r=>r.seq),[1,2]);
  assert.equal(retainSelection(null,[],[],[s]),null);
  const newChoice=casesFor([other])[0];
  assert.equal(retainSelection(newChoice,casesFor([other]),allRecords([other]),[other]).room,'credence');
});

async function reviewed(messages) {await annotateContentHashes(messages);return buildCases(messages.map(m=>parseMessage(m,'kibble').record))[0];}
const base = () => [msg(1,'JOB v1 | targets | build | Explain. Success: a clear explanation.'),msg(2,'RESULT v1 | targets | answer A'),msg(3,'RESULT v1 | targets | answer B')];
const attest = (seq,verdict,target) => msg(seq,`ATTEST v1 | targets | ${verdict} | ${target?'rh:'+target+' | ':''}claim`);

test('opposite verdicts with short/full hashes bind one result text; same key can change its claim', async () => {
  const c=await reviewed([...base(),attest(4,'not',hash('answer A').slice(0,16)),attest(5,'useful',hash('answer A'))]);
  assert.equal(c.conflicts.length,1);
  assert.deepEqual(c.conflicts[0],{hash:hash('answer A'),results:[2],useful:[5],negative:[4]});
  assert.match(attestationTargetText(c.attestationDetails[0]),/names result #2 \(hash match:/);
});

test('mixed verdicts on different, unnamed or outside targets do not establish a conflict', async () => {
  for(const target of [hash('answer B'),null,hash('outside')]){
    const c=await reviewed([...base(),attest(4,'not',hash('answer A')),attest(5,'useful',target)]);
    assert.equal(c.conflicts.length,0);
    assert.equal(c.verdicts.not,1);assert.equal(c.verdicts.useful,1);
  }
  const c=await reviewed([...base(),attest(4,'useful',null),attest(5,'not',hash('outside'))]);
  assert.match(attestationTargetText(c.attestationDetails[0]),/names no result/);
  assert.match(attestationTargetText(c.attestationDetails[1]),/no earlier result in this case matches/);
});

test('hash checking unavailable, later results and ambiguous prefixes stay neutral', async () => {
  const messages=[...base(),attest(4,'not',hash('answer A')),attest(5,'useful',hash('answer A'))];
  const c=buildCases(messages.map(m=>parseMessage(m,'kibble').record))[0];
  assert.ok(c.attestationDetails.every(a=>a.state==='unchecked'));assert.equal(c.conflicts.length,0);
  const future=await reviewed([msg(1,'JOB v1 | targets | build | x'),attest(2,'not',hash('future')),attest(3,'useful',hash('future')),msg(4,'RESULT v1 | targets | future')]);
  assert.equal(future.conflicts.length,0);
  const incomplete=describeAttestations([{seq:3,kind:'ATTEST',rh:hash('answer A').slice(0,16),verdict:'useful'}],[{seq:1,resultHash:hash('answer A')},{seq:2,resultHash:null}]);
  assert.equal(incomplete[0].state,'unchecked','a matching known hash does not resolve an unchecked possible target');
  const prefix='0123456789abcdef';
  const results=[{seq:1,resultHash:prefix+'a'.repeat(48)},{seq:2,resultHash:prefix+'b'.repeat(48)}];
  const details=describeAttestations([{seq:3,kind:'ATTEST',rh:prefix,verdict:'not'},{seq:4,kind:'ATTEST',rh:prefix,verdict:'useful'}],results);
  assert.ok(details.every(a=>a.state==='ambiguous'));assert.equal(conflictingVerdicts(details).length,0);
});

test('identical result copies form one content group; another room or job cannot supply a target', async () => {
  const ms=[...base(),msg(4,'RESULT v1 | targets | answer A'),attest(5,'not',hash('answer A')),attest(6,'useful',hash('answer A'))];
  const c=await reviewed(ms);assert.equal(c.conflicts.length,1);assert.deepEqual(c.conflicts[0].results,[2,4]);
  const unmatched=await reviewed([msg(1,'JOB v1 | targets | build | x'),msg(2,'RESULT v1 | foreign | answer A'),attest(3,'not',hash('answer A')),attest(4,'useful',hash('answer A'))]);
  assert.equal(unmatched.conflicts.length,0);
});

test('empty incremental page is quiet, explicit empty state has a local observation time', () => {
  const s=createRoomState('credence');applyPage(s,{messages:[job],generation:0,count:1,last_seq:1});markOk(s,100);
  applyPage(s,{messages:[],generation:0,count:0,last_seq:1},{since:1});markOk(s,200);
  assert.equal(s.roomEmpty,false);assert.equal(s.emptySince,null);assert.equal(s.records.size,1);
  applyPage(s,{messages:[],generation:0,count:0,last_seq:0},{since:1});markOk(s,300);
  assert.equal(s.roomEmpty,true);assert.equal(s.emptySince,300);assert.equal(s.records.size,0);
  applyPage(s,{messages:[],generation:0,count:0,last_seq:0});markOk(s,400);
  assert.equal(s.emptySince,300);
  assert.match(liveRoomText(coverage(s),500),/observed empty since 1970-01-01 00:00:00 UTC \(first observed here\)/);
  markError(s,'503',600);assert.match(liveRoomText(coverage(s),700),/read delayed/);
  applyPage(s,{messages:[job],generation:0,count:1,last_seq:1});markOk(s,800);assert.equal(s.emptySince,null);assert.equal(s.roomEmpty,false);
});

test('freshness separates held span, last-record age, loading, quiet nonprotocol room and errors', () => {
  const s=createRoomState('kibble');assert.equal(liveRoomText(coverage(s),0),'kibble: loading');
  markError(s,'503',0);assert.match(liveRoomText(coverage(s),0),/no successful read/);
  applyPage(s,{messages:[job,result],generation:0,last_seq:2});markOk(s,Date.parse('2026-10-27T08:01:00Z'));
  assert.match(liveRoomText(coverage(s),Date.parse('2026-10-27T08:01:00Z')),/held window spans 1 s; last record 58 s ago/);
  applyPage(s,{messages:[msg(3,'ordinary chatter')],generation:0,last_seq:3});markOk(s,1);
  assert.match(liveRoomText(coverage(s),2),/no protocol records in held view/);assert.equal(s.roomEmpty,false);
});

test('archived disagreement: both signed verdicts target #21334926; later answer is unattested', async () => {
  const {readFileSync} = await import('node:fs');
  const {parseRoomPage,annotateSignatures} = await import('../src/lib/signature.js');
  const messages=readFileSync('test/fixtures/conflict-k7319be7534.jsonl','utf8').trim().split('\n').map(parseRoomPage);
  await annotateSignatures('kibble',messages);
  assert.ok(messages.every(m=>m.sigStatus==='valid'));assert.equal(messages.length,7);
  const c=await reviewed(messages);
  assert.equal(c.conflicts.length,1);
  assert.deepEqual(c.conflicts[0].results,[21334926]);
  assert.deepEqual(c.conflicts[0].negative,[21334948]);assert.deepEqual(c.conflicts[0].useful,[21337127]);
  assert.ok(c.attestationDetails.every(a=>!a.matches.includes(21335283)));
});
