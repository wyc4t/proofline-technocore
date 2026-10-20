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
