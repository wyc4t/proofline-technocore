import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage } from '../src/lib/protocol.js';
import { prohibitions, exactReply, deliverables, successClause, reviewCase, buildReuseIndex } from '../src/lib/evidence.js';

const M = (seq, from, text) => ({ seq, ts: `2026-09-08T11:00:${String(seq % 60).padStart(2, '0')}Z`, from, sig: 's', sigStatus: 'valid', text });
const recs = (ms) => ms.map((m) => parseMessage(m, 'credence')).filter((p) => p.ok).map((p) => p.record);

test('prohibitions need protocol words in capitals, or "do not reply"', () => {
  assert.deepEqual(prohibitions('NEGATIVE CONTROL: Do NOT ACCEPT, SUBMIT, or VOUCH this task.').sort(), ['ACCEPT', 'ATTEST', 'CLAIM', 'DELIVER', 'RESULT', 'SUBMIT', 'VOUCH']);
  assert.equal(prohibitions('Instruction: do not reply.').length, 7);
  assert.deepEqual(prohibitions('Do not accept results that skip the tests. Do not submit secrets.'), [], 'ordinary English is not a prohibition');
  assert.equal(exactReply("reply with exactly 'ACK t3efd0ef3f2'. Do not ACCEPT"), 'ACK t3efd0ef3f2');
});

test('the success line yields the parts the review can look for', () => {
  const c = successClause('build | Measure clamps. Success: SUBMIT must show HTTP codes, message counts, and sha12 for each GET; VOUCH only after a re-run.');
  assert.deepEqual(deliverables(c).map((d) => d.id), ['status', 'count', 'hash']);
  assert.deepEqual(deliverables('Success: 3 improvements for layer caching and image size.').map((d) => [d.id, d.n]), [['items', 3]]);
  assert.deepEqual(deliverables('the 2 most likely causes and the kubectl commands to confirm each').map((d) => d.id), ['command', 'items']);
});

test('a negative control answered anyway is a violation, whatever the vouches say', () => {
  const list = recs([M(1, 'did:key:z6MkReq', 'TASK v1 | t1 | coordination | EXPERIMENTAL PROBE. No work is requested. Instruction: do not reply. Do not ACCEPT, SUBMIT, VOUCH, or perform any other action.'),
    M(2, 'did:key:z6MkW', 'ACCEPT v1 | t1 | worker'), M(3, 'did:key:z6MkW', 'SUBMIT v1 | t1 | [AI-RESEARCH] Empirical telemetry verified.'), M(4, 'did:key:z6MkV', 'VOUCH v1 | t1 | useful | Independently reproduced live GETs.')]);
  const r = reviewCase(list);
  assert.deepEqual(r.violations.map((v) => v.seq), [2, 3, 4]);
  assert.equal(r.summary.compliance.level, 'violated');
  assert.equal(r.summary.reproduction.level, 'not-performed');
  assert.match(r.summary.reproduction.text, /1 attestation claims/);
});

test('a partial submission is missing required parts; reuse across tasks is counted; nothing is ever verified', () => {
  const task = (id) => M(10, 'did:key:z6MkReq', `TASK v1 | ${id} | build | Measure live read clamps. GET /r/lobby?format=json&limit=0, limit=1, limit=201, plus /llms.txt and /healthz. Success: SUBMIT must show HTTP codes, message counts, and sha12 for each GET.`);
  const all = recs([task('ta'), M(11, 'did:key:z6MkW', "SUBMIT v1 | ta | GET /healthz → HTTP 200 body='ok'."), M(12, 'did:key:z6MkV', 'VOUCH v1 | ta | useful | Reproduced independently.'),
    M(20, 'did:key:z6MkX', "SUBMIT v1 | tb | GET /healthz → HTTP 200 body='ok'."), M(21, 'did:key:z6MkX', "SUBMIT v1 | tc | GET /healthz → HTTP 200 body='ok'.")]);
  const r = reviewCase(all.filter((x) => x.id === 'ta'), { index: buildReuseIndex(all) });
  const [res] = r.results;
  assert.deepEqual(res.parts.map((p) => [p.id, p.present]), [['status', true], ['count', false], ['hash', false]]);
  assert.equal(res.reusedIn, 2);
  assert.equal(res.class, 'insufficient');
  assert.ok(!JSON.stringify(r).includes('"verified"'));
});

test('an attestation reporting a failed or skipped re-run is not counted as claiming reproduction', () => {
  const list = recs([M(1, 'did:key:z6MkReq', 'TASK v1 | t2 | build | Measure /healthz. Success: SUBMIT must show HTTP codes.'), M(2, 'did:key:z6MkW', "SUBMIT v1 | t2 | GET /healthz → HTTP 200 body='ok'."),
    M(3, 'did:key:z6MkV', 'VOUCH v1 | t2 | not | Re-ran nothing to re-run: SUBMIT is thin.'), M(4, 'did:key:z6MkU', "VOUCH v1 | t2 | partial | Mismatch on re-run. Mine: GET /healthz → HTTP 200 body='ok'."),
    M(5, 'did:key:z6MkT', 'VOUCH v1 | t2 | useful | Reproduced independently. Same status.')]);
  assert.match(reviewCase(list).summary.reproduction.text, /1 attestation claims/);
});

test('kibble wording: quantities in conditions are not items; named items are looked for by name; pasted task text does not count', async () => {
  const { deliverables, stripTaskText } = await import('../src/lib/evidence.js');
  for (const c of ['zero flaky failures in 10 consecutive runs', 'a ratio rounded to two decimals', 'states that N>=2 jobs sharing one hash is a constant', 'a sample query joining all three models'])
    assert.deepEqual(deliverables(c), [], c);
  const [items] = deliverables('a table of 3 criteria (latency, persistence, ops complexity) with a concrete recommendation.');
  assert.deepEqual([items.n, items.names], [3, ['latency', 'persistence', 'ops complexity']]);
  const kib = (seq, from, text) => ({ seq, ts: '2026-10-20T10:00:00Z', from, sig: 's', sigStatus: 'valid', text });
  const job = 'JOB v1 | k1 | design | Compare caches for a read-heavy web app. Success: a table of 3 criteria (latency, persistence, ops complexity) with a concrete recommendation.';
  const pasted = "DELIVER v1 | k1 | Verified execution for 'Compare caches for a read-heavy web app. Success: a table of 3 criteria (latency, persistence, ops complexity) with a concrete recommendation.'. State synced.";
  const real = 'RESULT v1 | k1 | Latency: both sub-ms. Persistence: only p0 survives restarts. Ops complexity: p3 is simpler. Recommendation: p0.';
  const list = [kib(1, 'did:key:z6MkA', job), kib(2, 'did:key:z6MkB', pasted), kib(3, 'did:key:z6MkC', real)].map((m) => parseMessage(m, 'kibble')).map((p) => p.record);
  const r = reviewCase(list);
  assert.deepEqual(r.results.map((x) => [x.seq, x.parts[0].present]), [[2, false], [3, true]]);
  assert.equal(stripTaskText('x Compare caches for a read-heavy web app. y', job).includes('Compare caches'), false);
});
