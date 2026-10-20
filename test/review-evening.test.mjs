// Defects from the review of 20 October (evening). Each test failed before its fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseClaims, checkRequest, compareClaim } from '../src/lib/claims.js';
import { reproduce } from '../archive/reproduce.mjs';
import { parseMessage } from '../src/lib/protocol.js';
import { reviewCase } from '../src/lib/evidence.js';

const ok = (body = '{"count":1}') => async (url) => new Response(url.endsWith('/openapi.json') ? '{"info":{"version":"x"}}' : body, { status: 200, headers: { 'content-type': 'application/json' } });

test('1: claims over the request budget are reported as deferred, not silently dropped', async () => {
  const items = Array.from({ length: 45 }, (_, i) => ({ source: { seq: 100 + i }, claimedAt: new Date().toISOString(), claims: parseClaims(`GET /r/lobby?format=json&limit=${i} -> HTTP 200 count=1`) }));
  const run = await reproduce(items, { fetchImpl: ok(), sleep: async () => {} });
  assert.equal(run.requests, 40);
  assert.deepEqual(run.deferred, [139, 140, 141, 142, 143, 144], 'the records whose requests did not fit are listed by seq');
  assert.equal(run.items.length, 39, 'deferred records are left for the next run, not logged as done');
});

test('2: a claim with nothing comparable at its age is not requested', async () => {
  const called = [];
  const old = new Date(Date.now() - 3 * 3600e3).toISOString();
  const items = [{ source: { seq: 1 }, claimedAt: old, claims: parseClaims('GET /kv/agentscout/top -> HTTP 200, asof=2026-10-20T06:01Z') }];
  const run = await reproduce(items, { fetchImpl: async (u) => { called.push(u); return ok()(u); }, sleep: async () => {} });
  assert.deepEqual(called, ['https://technocore.chat/openapi.json']);
  assert.deepEqual(run.items[0].claims[0].comparison.map((p) => p.outcome), ['not comparable', 'not comparable']);
  assert.match(run.items[0].claims[0].comparison[1].note, /stale|old/);
});

test('5: a different status on a note or room that may have changed is not a contradiction once the claim is old', () => {
  const obs = { observed_at: '2026-10-20T15:00:00Z', status: 404, headers: {} };
  const old = compareClaim({ target: '/kv/agentscout/top', props: { status: 200 } }, obs, { claimedAt: '2026-10-01T08:00:00Z', observedAt: obs.observed_at });
  assert.equal(old[0].outcome, 'not comparable');
  const fresh = compareClaim({ target: '/kv/agentscout/top', props: { status: 200 } }, obs, { claimedAt: '2026-10-20T14:50:00Z', observedAt: obs.observed_at });
  assert.equal(fresh[0].outcome, 'differs');
  const same = compareClaim({ target: '/kv/agentscout/top', props: { status: 404 } }, obs, { claimedAt: '2026-10-01T08:00:00Z', observedAt: obs.observed_at });
  assert.equal(same[0].outcome, 'reproduced');
});

test('hardening: duplicate query parameters and very long requests are refused', () => {
  assert.match(checkRequest('/r/lobby?format=json&limit=1&limit=5000').reason || 'ALLOWED', /duplicate/);
  assert.match(checkRequest('/kv/a/' + 'b'.repeat(600)).reason || 'ALLOWED', /too long/);
});

test('6: a hex-shaped third field is a hash only when a known verdict follows', () => {
  const p = (text) => parseMessage({ seq: 1, ts: 't', from: 'n', text }, 'kibble').record;
  assert.deepEqual([p('ATTEST v1 | k1 | 326d2f36ac762e66 | useful | ok').verdict, p('ATTEST v1 | k1 | 326d2f36ac762e66 | useful | ok').rh], ['useful', '326d2f36ac762e66']);
  const odd = p('ATTEST v1 | k1 | deadbeefdeadbeef | some free text');
  assert.deepEqual([odd.verdict, odd.rh], ['deadbeefdeadbeef', null]);
});

const M = (seq, from, text) => ({ seq, ts: `2026-10-20T10:00:${String(seq).padStart(2, '0')}Z`, from, sig: 's', sigStatus: 'valid', text });
test('3 and 4: wording stays within what was observed', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.ok(!/'Followed'/.test(app), 'no bare "Followed"');
  assert.match(app, /No violation in the available records/);
  const list = [M(1, 'did:key:z6MkA', 'JOB v1 | k1 | design | Compare caches. Success: a table of 3 criteria (latency, persistence, ops complexity).'), M(2, 'did:key:z6MkB', 'RESULT v1 | k1 | latency, persistence, ops complexity')]
    .map((m) => parseMessage(m, 'kibble').record);
  const part = reviewCase(list).results[0].parts[0];
  assert.equal(part.present, true);
  assert.equal(part.how, 'names', 'a part found only by its names says so');
});

test('7: a job ID whose postings ask different things is not checked against one of them', () => {
  const list = [M(1, 'did:key:z6MkA', 'JOB v1 | k2 | data | One. Success: the query + the index.'), M(2, 'did:key:z6MkC', 'JOB v1 | k2 | data | Two. Success: 3 improvements for caching.'), M(3, 'did:key:z6MkB', 'RESULT v1 | k2 | some answer')]
    .map((m) => parseMessage(m, 'kibble').record);
  const r = reviewCase(list);
  assert.equal(r.requirements.ambiguous, 2, 'two different success lines under one ID');
  assert.deepEqual(r.requirements.deliverables, [], 'no parts are asked when the ID is ambiguous');
});
