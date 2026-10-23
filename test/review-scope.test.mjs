import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseMessage} from '../src/lib/protocol.js';
import {reviewCase} from '../src/lib/evidence.js';
// Exercise the actual UI formatter with a request that has three requirements,
// of which this version can extract only URLs.
test('evidence review names its extracted checks without claiming all requirements passed',()=>{
 const list=[
  {seq:1,text:'JOB v1 | scope1 | research | Compare room activity. Use last_seq=20573425. Success: lists tape seq, a poll interval, and one read-only URL.'},
  {seq:2,text:'RESULT v1 | scope1 | Starting sequence 20571848, poll every 60s: https://technocore.chat/r/kibble?format=json'}
 ].map(m=>parseMessage(m,'kibble').record);
 const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function evidenceReview('),source.indexOf('\nfunction recordDisclosure'));
 const findings=[];
 const ctx={reviewCase,snapshot:{},liveReuseIndex:()=>null,el:()=>({}),finding:(_h,label,value,detail)=>findings.push({label,value,detail}),host:{append(){},lastChild:{querySelector:()=>({append(){}})}},c:{list}};
 vm.runInNewContext(fn+'\nevidenceReview(host,c)',ctx);
 const assessment=findings.find(f=>f.label==='Assessment');
 assert.match(assessment.detail,/detected text checks \(URLs\)/);
 assert.doesNotMatch(assessment.detail,/contains every part the task names/);
 assert.match(assessment.detail,/Other requirements may not have been checked/);
 assert.equal(findings.find(f=>f.label==='Detected text checks, per result').value,'1 of 1 result passes these checks');
});
