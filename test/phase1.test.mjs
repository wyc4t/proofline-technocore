// Synthetic shape regressions motivated by the 27 October review; not archived evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseMessage } from '../src/lib/protocol.js';
import { buildCases } from '../src/lib/cases.js';
import { reviewCase, evidenceAssessment } from '../src/lib/evidence.js';
import { formatUTCWindow,verdictCountText } from '../src/lib/presentation.js';

const parse = (text, seq = 1, key = 'did:key:test') => parseMessage({ seq, text, from: key, sigStatus: 'valid' }, 'kibble').record;
const review = (body, success = '3 config keys/values with reasons') => reviewCase([
  parse(`JOB v1 | shape | config | Tune database connections. Success: ${success}.`),
  parse(`RESULT v1 | shape | ${body}`, 2),
  parse('ATTEST v1 | shape | useful | claimed', 3, 'did:key:attester'),
]);

test('JSON collections and Markdown tables count items without counting nested fields or table headers', () => {
  for (const body of [
    '{"max_connections":{"value":100,"reason":"capacity"},"idle_timeout":{"value":60,"reason":"idle"},"pool_size":{"value":10,"reason":"pool"}}',
    '```json\n{"configs":[{"key":"max_connections","value":100},{"key":"idle_timeout","value":60},{"key":"pool_size","value":10}]}\n```',
    '| Config key | Value | Reason |\n| --- | --- | --- |\n| max_connections | 100 | capacity |\n| idle_timeout | 60 | idle |\n| pool_size | 10 | pool |',
    '1. max_connections=100\n2. idle_timeout=60\n3. pool_size=10',
  ]) {
    const rv = review(body);
    assert.equal(rv.results[0].parts[0].label, '3 config keys/values');
    assert.equal(rv.results[0].parts[0].present, true, body);
  }
  for (const body of [
    '{"key":"max_connections","value":100,"reason":"capacity"}',
    '{"key":"max_connections","value":100,"reason":["capacity","memory","load"]}',
    '{"configs":[{"key":"max_connections","value":100,"reason":"capacity"},{"key":"idle_timeout","value":60,"reason":"idle"}]}',
    '| Key | Value |\n| --- | --- |\n| max_connections | 100 |\n| idle_timeout | 60 |',
    '{"configs": [broken JSON]}',
  ]) assert.equal(review(body).results[0].parts[0].present, false, body);
});

test('shape misses and useful verdicts are neutral; only explicit task-rule violations make red assessments', () => {
  const rv = review('Database connections configured.');
  assert.equal(evidenceAssessment(rv).tone, '');
  assert.doesNotMatch(evidenceAssessment(rv).text, /yet|anyway|not done/);
  for (const task of ['Do not reply.', 'No self-vouch.', 'Reply with exactly "ACK".']) {
    const rule = reviewCase([parse(`JOB v1 | rules | config | ${task}`), parse('RESULT v1 | rules | answer', 2), parse('ATTEST v1 | rules | useful | claimed', 3)]);
    assert.equal(evidenceAssessment(rule).tone, 'alert', task);
    assert.match(evidenceAssessment(rule).text, /Task instructions were not followed/);
  }
});

test('actual evidence UI uses not detected and neutral styling for shape misses', () => {
  const source = fs.readFileSync('src/app.js', 'utf8');
  const fn = source.slice(source.indexOf('function evidenceReview('),source.indexOf('\nfunction recordDisclosure'));
  const findings = [];
  const ctx = { reviewCase, evidenceAssessment, snapshot: {}, liveReuseIndex: () => null, el: () => ({}), finding: (_h,label,value,detail,tone) => findings.push({label,value,detail,tone}), host: {append(){},lastChild:{querySelector:()=>({append(){}})}}, c: {list:[parse('JOB v1 | ui | config | Success: 3 config keys/values.'),parse('RESULT v1 | ui | database configured',2),parse('ATTEST v1 | ui | useful | claimed',3)]}};
  vm.runInNewContext(fn+'\nevidenceReview(host,c)',ctx);
  assert.match(findings.find((x)=>x.label==='Detected text checks, per result').detail,/3 config keys\/values: not detected/);
  assert.ok(findings.every((x)=>x.tone!=='alert'));
  assert.match(findings.find((x)=>x.label==='Assessment').detail,/read the result before concluding/);
});

test('negative forms are parsed in both attestation layouts and reach the case filter', () => {
  for (const v of ['not','not-useful','not useful','not_useful','reject','rejected','invalid','fail']) {
    for (const field of [v,`326d2f36ac762e66 | ${v}`]) {
      const r = parse(`ATTEST v1 | neg | ${field} | reason`);
      assert.equal(r.verdict,'not',field);
      const c = buildCases([r])[0];
      assert.equal(c.negative,true);
      assert.equal(c.verdicts.not,1);
    }
  }
  for (const v of ['useful','partial','valid','accepted']) assert.equal(buildCases([parse(`ATTEST v1 | pos | ${v} | reason`)])[0].negative,false);
});

test('UTC windows carry both dates across months and years and never use the host timezone', () => {
  assert.equal(formatUTCWindow('2026-10-26T06:55:00Z','2026-10-27T06:55:00Z'),'26 Oct 2026 06:55 – 27 Oct 2026 06:55 UTC');
  assert.equal(formatUTCWindow('2026-12-31T23:00:00-01:00','2027-01-02T00:00:00Z'),'1 Jan 2027 00:00 – 2 Jan 2027 00:00 UTC');
  assert.equal(formatUTCWindow(null,null),'unknown – unknown UTC');
});

test('homepage presents both rates and dated scope; legacy data is unavailable, never zero', () => {
  const source = fs.readFileSync('src/app.js','utf8');
  const fn = source.slice(source.indexOf('function renderStats('),source.indexOf('\nfunction renderPopulation'));
  const fields = new Map();
  const get = (id) => { if(!fields.has(id)) fields.set(id,{}); return fields.get(id); };
  const stats = { generated_at: '2026-10-27T07:00:00Z',rooms:{kibble:{window_start:'2026-10-26T06:55:00Z',window_end:'2026-10-27T06:55:00Z',from_ts:'2026-10-26T07:00:00Z',to_ts:'2026-10-27T06:54:00Z',complete:true,jobs:{records:10,requester_keys:3,reposted_share_pct:0},outcomes:{with_result_pct:80,with_useful_attestation_pct:60,with_useful_non_result_key_attestation_pct:20},signatures:{valid:40}}}};
  vm.runInNewContext(fn+'\nrenderStats()',{$:get,stats,formatUTCWindow});
  assert.equal(get('#sUseful').textContent,'60%');
  assert.equal(get('#sUsefulOther').textContent,'20%');
  assert.match(get('#sScope').textContent,/26 Oct 2026 06:55 – 27 Oct 2026 06:55 UTC · signature-checked archive/);
  delete stats.rooms.kibble.outcomes.with_useful_non_result_key_attestation_pct;
  vm.runInNewContext(fn+'\nrenderStats()',{$:get,stats,formatUTCWindow});
  assert.equal(get('#sUsefulOther').textContent,'—');
});

const dayData = (rate = 20) => ({ day:'2026-10-26',rooms:{kibble:{full_day:false,complete:false,from_ts:'2026-10-26T01:00:00Z',to_ts:'2026-10-26T23:00:00Z',window_start:'2026-10-26T00:00:00Z',window_end:'2026-10-27T00:00:00Z',jobs:10,job_ids:10,requester_keys:3,with_result_pct:80,with_useful_attestation_pct:60,with_useful_non_result_key_attestation_pct:rate,reposted_share_pct:0}}});
const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join(' ') : node?.props ? textOf(node.props.children) : '';

test('site and daily share card elements carry both rates and claim caveats, including legacy data', async () => {
  const {siteCard,dayCard} = await import('../api/card.js');
  const k = dayData().rooms.kibble;
  const site = {rooms:{kibble:{...k,jobs:{records:10},outcomes:k}}};
  for (const text of [textOf(siteCard(site)),textOf(dayCard(dayData()))]) {
    assert.match(text,/USEFUL VERDICT · ANY SENDER 60% 20% · key with no result here/);
    assert.match(text,/signature-checked archive/i);
    assert.match(text,/26 Oct 2026/);
    assert.match(text,/27 Oct 2026/);
    assert.match(text,/Verdicts are claims/);
    assert.match(text,/different keys do not prove independent review/);
    assert.doesNotMatch(text,/attested useful|verified archive/i);
  }
  assert.match(textOf(dayCard(dayData(null))),/— · key with no result here/);
});

test('actual digest renderer shows both rates and unavailable legacy rate with full dates', async () => {
  class Node {
    constructor(){this.children=[];this.textContent='';}
    append(...xs){this.children.push(...xs);}
    replaceChildren(...xs){this.children=xs;}
    text(){return [this.textContent,...this.children.map(x=>typeof x==='string'?x:x.text())].join(' ');}
  }
  const host = new Node();
  const html = fs.readFileSync('dist/site-daily.html','utf8');
  const code = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/m,'');
  for (const day of [dayData(),dayData(null)]) {
    vm.runInNewContext(code,{formatUTCWindow,verdictCountText,document:{getElementById:()=>host,createElement:()=>new Node()},location:{search:''},URLSearchParams,fetch:async()=>({ok:true,json:async()=>({days:[day]})}),setTimeout});
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(host.text(),/USEFUL VERDICT · ANY SENDER 60%/);
    assert.match(host.text(),day.rooms.kibble.with_useful_non_result_key_attestation_pct===null?/— · key with no result here/:/20% · key with no result here/);
    assert.match(host.text(),/26 Oct 2026 00:00 – 27 Oct 2026 00:00 UTC/);
    assert.match(host.text(),/Verdicts are claims/);
  }
});

test('reviewed archived case: three JSON config entries detected, one-item result remains undetected', async () => {
  const {parseRoomPage,annotateSignatures,annotateContentHashes} = await import('../src/lib/signature.js');
  const raw = fs.readFileSync('test/fixtures/config-k7164c240c8.jsonl','utf8').trim().split('\n');
  const page = parseRoomPage('{"messages":['+raw.join(',')+']}');
  await annotateSignatures('kibble',page.messages);
  await annotateContentHashes(page.messages);
  assert.equal(page.messages.length,6);
  assert.ok(page.messages.every(m=>m.sigStatus==='valid'),'raw nonce digits are preserved');
  const records = page.messages.map(m=>parseMessage(m,'kibble').record);
  const rv = reviewCase(records);
  assert.deepEqual(rv.results.map(r=>[r.seq,r.parts[0].present]),[[21372973,true],[21373301,false]]);
  assert.equal(evidenceAssessment(rv).tone,'');
  const c = buildCases(records)[0];
  assert.deepEqual(c.targets[0].matches,[21372973],'the useful verdict names the three-item JSON result');
});
