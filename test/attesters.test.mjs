// Who attested: self-attestation, requester, other keys, attestations for jobs never seen,
// and the ATTEST v1 | id | <hash> | verdict form.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseMessage } from '../src/lib/protocol.js';
import { buildCases } from '../src/lib/cases.js';
import { computeStats } from '../archive/stats.mjs';

test('an attestation with a bare hash before the verdict is read as that hash and verdict', () => {
  const p = (text) => parseMessage({ seq: 1, ts: 't', from: 'n', text }, 'kibble');
  let r = p('ATTEST v1 | keb25384fca | 326D2F36AC762E66 | useful | substantive answer').record;
  assert.deepEqual([r.verdict, r.rh, r.body], ['useful', '326d2f36ac762e66', 'substantive answer']);
  r = p('ATTEST v1 | k1 | rh:84d74333ec08f4ff | not | thin').record;
  assert.deepEqual([r.verdict, r.rh, r.body], ['not', '84d74333ec08f4ff', 'thin']);
  r = p('ATTEST v1 | k1 | useful | rh:84d74333ec08f4ff fine').record;
  assert.deepEqual([r.verdict, r.rh], ['useful', '84d74333ec08f4ff'], 'the rh: form in the text still works');
  r = p('ATTEST v1 | k1 | 84d74333ec08f4ff').record;
  assert.equal(r.verdict, '84d74333ec08f4ff', 'with nothing after it, a hash is not assumed to be a hash field');
});

const M = (seq, from, text) => ({ seq, ts: `2026-10-19T10:00:${String(seq).padStart(2, '0')}Z`, from, sig: 's', sigStatus: 'valid', text });
const recs = (ms) => ms.map((m) => parseMessage(m, 'kibble')).filter((p) => p.ok).map((p) => p.record);
const REQ = 'did:key:z6MkReq', WRK = 'did:key:z6MkWrk', OTH = 'did:key:z6MkOth';

test('a case counts attestations by the result key, the requester and other keys', () => {
  const [c] = buildCases(recs([M(1, REQ, 'JOB v1 | k1 | build | t'), M(2, WRK, 'CLAIM v1 | k1 | worker'), M(3, WRK, 'RESULT v1 | k1 | an answer'),
    M(4, WRK, 'ATTEST v1 | k1 | useful | mine is great'), M(5, REQ, 'ATTEST v1 | k1 | useful | met my need'), M(6, OTH, 'ATTEST v1 | k1 | not | thin')]));
  assert.deepEqual([c.attestation.self, c.attestation.requester, c.attestation.other, c.attestation.unknown], [1, 1, 1, 0]);
  assert.ok(!c.flags.some((f) => f.id === 'self-attested-only'));
  assert.ok(!c.flags.some((f) => f.id === 'requester-attested'), 'a requester attesting is not flagged as a pattern');
});

test('a case where only the result key attested is flagged', () => {
  const [c] = buildCases(recs([M(1, REQ, 'JOB v1 | k2 | build | t'), M(2, WRK, 'RESULT v1 | k2 | an answer'), M(3, WRK, 'ATTEST v1 | k2 | useful | great')]));
  assert.deepEqual([c.attestation.self, c.attestation.other], [1, 0]);
  assert.deepEqual(c.flags.find((f) => f.id === 'self-attested-only')?.seqs, [3]);
});

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = (buf) => { let n = BigInt('0x' + buf.toString('hex')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } return s; };
const key = () => { const { publicKey, privateKey } = generateKeyPairSync('ed25519'); return { privateKey, did: 'did:key:z' + b58(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url')])) }; };
const [A, W, V, X] = [key(), key(), key(), key()];
let nonce = 1792490000000;
const at = (min) => new Date(Date.UTC(2026, 9, 20, 6, 0) + min * 60e3).toISOString();
const line = (seq, k, text, min) => { const n = String(nonce++); const sig = sign(null, Buffer.from(`kibble|${n}|${text}`), k.privateKey).toString('base64url'); return `{"seq":${seq},"ts":"${at(min)}","from":"${k.did}","text":${JSON.stringify(text)},"nonce":${n},"sig":"${sig}"}`; };

test('stats: attested useful leaves out self-attestation; roles and jobs never seen are counted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'proofline-attesters-'));
  try {
    const lines = [
      line(1, A, 'JOB v1 | k000000001 | build | One | x', 0),             // useful by another key
      line(2, W, 'RESULT v1 | k000000001 | done', 1),
      line(3, V, 'ATTEST v1 | k000000001 | useful | Meets the condition.', 2),
      line(4, A, 'JOB v1 | k000000002 | build | Two | x', 3),             // useful only from the worker itself
      line(5, W, 'RESULT v1 | k000000002 | done too', 4),
      line(6, W, 'ATTEST v1 | k000000002 | useful | Meets the condition.', 5),
      line(7, A, 'JOB v1 | k000000003 | build | Three | x', 6),           // useful from the requester
      line(8, W, 'RESULT v1 | k000000003 | done three', 7),
      line(9, A, 'ATTEST v1 | k000000003 | aaaaaaaaaaaaaaaa | useful | what I needed', 8),
      line(10, X, 'ATTEST v1 | k000000098 | useful | Meets the condition.', 10),     // no job anywhere, too early to count
      line(11, X, 'ATTEST v1 | k000000099 | useful | Meets the condition.', 300),    // no job anywhere, 5 h in: counted
    ];
    writeFileSync(join(dir, 'k.jsonl'), lines.join('\n') + '\n');
    writeFileSync(join(dir, 'h.txt'), 'x-room-generation: 0\n');
    execFileSync(process.execPath, ['archive/collect.mjs', '--data', join(dir, 'data'), '--captured-at', at(400), '--import', `kibble=${join(dir, 'k.jsonl')},${join(dir, 'h.txt')}`]);
    const s = computeStats({ data: join(dir, 'data'), hours: 24, rooms: ['kibble'] }).rooms.kibble;
    const o = s.outcomes;
    assert.equal(o.basis_ids, 3);
    assert.deepEqual([o.with_useful_attestation, o.with_useful_not_self, o.with_useful_only_self, o.with_useful_by_requester], [3, 2, 1, 1]);
    assert.equal(o.with_useful_not_self_pct, 66.7);
    assert.deepEqual(s.attestations.by, { requester: 1, result_key: 1, other_key: 1, no_job_in_archive: 2, unverified: 0 });
    assert.deepEqual([s.attestations.without_job_in_archive, s.attestations.without_job_basis], [1, 1], 'only attestations 4 h after the archive starts are judged');
    assert.equal(s.attestations.top_useful_reason, 'Meets the condition.');
    assert.equal(s.attestations.top_useful_reason_share_pct, 80);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
