import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseMessage } from '../src/lib/protocol.js';
import { buildCases } from '../src/lib/cases.js';
import { annotateContentHashes } from '../src/lib/signature.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const msg = (seq, from, text) => ({ seq, ts: `2026-10-20T08:00:${String(seq % 60).padStart(2, '0')}Z`, from: `did:key:z6Mk${from}`, sig: 's', sigStatus: 'valid', text });
async function oneCase(messages) {
  await annotateContentHashes(messages);
  return buildCases(messages.map((m) => parseMessage(m, 'kibble')).filter((p) => p.ok).map((p) => p.record))[0];
}

test('content hashes follow kibble: full JOB line for WITNESS, trimmed result text for rh:', async () => {
  const job = 'JOB v1 | k000000001 | build | Title | details', res = 'RESULT v1 | k000000001 |  the answer  ';
  const [j, r] = await annotateContentHashes([{ text: job }, { text: res }]);
  assert.equal(j.textHash, sha(job));
  assert.equal(r.resultHash, sha('the answer'));
});

test('new kinds parse; malformed ones are rejected', () => {
  const p = (t) => parseMessage({ seq: 1, from: 'x', text: t }, 'kibble');
  assert.deepEqual(['WITNESS v1 | k1 | 8f2cdccfa575035b', 'DISPUTE v1 | k1 | fake_result | e1', 'RESOLVE v1 | k1 | upheld | ok'].map((t) => [p(t).record.kind, p(t).record.stage, p(t).record.arg]),
    [['WITNESS', null, '8f2cdccfa575035b'], ['DISPUTE', null, 'fake_result'], ['RESOLVE', null, 'upheld']]);
  assert.equal(p('DISPUTE v1 | k1 |').reason, 'malformed');
  assert.equal(p('ATTEST v1 | k1 | useful | rh:84D74333EC08F4FF fine').record.rh, '84d74333ec08f4ff');
  assert.equal(p('ATTEST v1 | k1 | useful | no hash here').record.rh, null);
});

test('rh: links an attestation to earlier results of the same case with that hash, all of them if identical', async () => {
  const c = await oneCase([
    msg(1, 'R', 'JOB v1 | k000000001 | build | T | d'),
    msg(2, 'W', 'RESULT v1 | k000000001 | answer A'),
    msg(3, 'X', 'RESULT v1 | k000000001 | answer A'),                                   // identical text: same hash
    msg(4, 'Y', 'RESULT v1 | k000000001 | answer B'),
    msg(5, 'V', `ATTEST v1 | k000000001 | useful | rh:${sha('answer A').slice(0, 16)} good`),
    msg(6, 'V', `ATTEST v1 | k000000001 | not | rh:${sha('answer Z').slice(0, 16)} not in view`),
    msg(7, 'V', `ATTEST v1 | k000000001 | useful | rh:${sha('answer C')} full-length hash, result comes later`),
    msg(8, 'Z', 'RESULT v1 | k000000001 | answer C'),
  ]);
  assert.deepEqual(c.targets.map((t) => [t.seq, t.matches]), [[5, [2, 3]], [6, []], [7, []]], 'only earlier results count');
  assert.deepEqual(c.links.filter((l) => l.type === 'hash').map((l) => [l.from, l.to]), [[5, 2], [5, 3]]);
});

test('WITNESS is checked against the job text; a dispute flags the case', async () => {
  const job = 'JOB v1 | k000000002 | build | T | d';
  const c = await oneCase([
    msg(1, 'R', job),
    msg(2, 'H', `WITNESS v1 | k000000002 | ${sha(job).slice(0, 16)}`),
    msg(3, 'H', 'WITNESS v1 | k000000002 | 0000000000000000'),
    msg(4, 'D', 'DISPUTE v1 | k000000002 | not_done | e1'),
    msg(5, 'R', 'RESOLVE v1 | k000000002 | upheld | agreed'),
  ]);
  assert.deepEqual(c.witnesses.map((w) => w.matches), [true, false]);
  assert.equal(c.disputed, true);
  assert.equal(c.flags[0].id, 'disputed');
  assert.match(c.flags[0].detail, /not_done.*Resolution recorded: upheld/);
  assert.deepEqual(c.stages.map((s) => s.length), [1, 0, 0, 0], 'extra kinds are not stages');
});
