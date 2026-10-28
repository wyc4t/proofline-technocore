import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseRoomPage,annotateSignatures,annotateContentHashes} from '../src/lib/signature.js';
import {parseMessage} from '../src/lib/protocol.js';
import {buildCases} from '../src/lib/cases.js';
import {storylineModel,storylineLinks,storyPreview} from '../src/lib/storyline.js';
async function fixture(){const messages=fs.readFileSync('test/fixtures/conflict-k7319be7534.jsonl','utf8').trim().split('\n').map(parseRoomPage);await annotateSignatures('kibble',messages);await annotateContentHashes(messages);return buildCases(messages.map(m=>parseMessage(m,'kibble').record))[0]}
test('opposite verdicts name only the matched result, not every result in a complete case',async()=>{
 const c=await fixture(),groups=storylineModel(c),results=groups[2].records,attests=groups[3].records;
 assert.equal(groups.flatMap(g=>g.records).length,7);
 assert.equal(results[0].conflict.useful.length,1);assert.equal(results[0].conflict.negative.length,1);
 assert.equal(results[1].conflict,undefined);assert.equal(results[1].namedBy.length,0);
 assert.match(results[1].relations.join(' '),/No attestation in these records names this result/);
 for(const a of attests){assert.equal(a.target.state,'matched');assert.deepEqual(a.target.matches,[21334926]);assert.match(a.relations[0],/#21334926/)}
 assert.equal(storylineLinks(c).filter(l=>l.type==='hash').length,2);
 assert.match(groups[0].records[0].success,/Cap-and-trade/);
});
test('ambiguous and unchecked hash prefixes never draw a confirming green connection',async()=>{
 const c=await fixture();for(const state of ['ambiguous','unchecked','outside','unnamed']){
  const changed={...c,attestationDetails:c.attestationDetails.map(a=>({...a,state})),conflicts:[]};
  assert.equal(storylineLinks(changed).filter(l=>l.type==='hash').length,0);
  assert.equal(storylineModel(changed)[2].records[0].namedBy.length,0);
 }
});
test('same-key links require the existing verified-key observation; stage position adds no links',async()=>{
 const c=await fixture(),links=storylineLinks(c);assert.equal(links.filter(l=>l.type==='same-key').length,2);
 assert.ok(storylineModel(c)[1].records.every(r=>r.relations.some(s=>s.includes('Same verified key'))));
 assert.deepEqual(storylineLinks({...c,links:[]}),[]);
 assert.equal(storylineLinks({...c,links:[{from:1,to:2,type:'cites'}]}).length,0);
});
test('duplicate result text retains all hash targets without claiming a unique record',async()=>{
 const c=await fixture(),result=c.stages[2][0],copy={...result,seq:result.seq+1};
 const extended=buildCases([...c.list,copy])[0],attests=storylineModel(extended)[3].records;
 assert.ok(attests.every(a=>a.relations[0].includes('identical result text at')));
 assert.ok(attests.every(a=>a.target.matches.length===2));
});
test('excerpts preserve source wording and explicitly distinguish shortened from full text',()=>{
 assert.deepEqual(storyPreview('<script>unsafe</script>'),{text:'<script>unsafe</script>',truncated:false});
 assert.deepEqual(storyPreview('A complete long source',10),{text:'A complet…',truncated:true});
 assert.equal(storyPreview('a'.repeat(300)).truncated,false);
});
test('missing stages remain empty observations without inferred relationships',()=>{
 const c=buildCases([parseMessage({seq:1,text:'JOB v1 | empty | test | A request. Success: exact answer.'},'kibble').record])[0];
 const groups=storylineModel(c);assert.deepEqual(groups.map(g=>g.records.length),[1,0,0,0]);assert.deepEqual(storylineLinks(c),[]);
});
