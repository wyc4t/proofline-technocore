import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { computeStats, neededAssets, OUTCOME_GRACE_MIN } from '../archive/stats.mjs';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = (buf) => { let n = BigInt('0x' + buf.toString('hex')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } return s; };
const key = () => { const { publicKey, privateKey } = generateKeyPairSync('ed25519'); return { privateKey, did: 'did:key:z' + b58(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url')])) }; };
const [A, B, W, V] = [key(), key(), key(), key()];
let nonce = 1792480000000;
const at = (min) => new Date(Date.UTC(2026, 9, 20, 6, 0) + min * 60e3).toISOString();
const line = (seq, k, text, min) => { const n = String(nonce++); const sig = sign(null, Buffer.from(`kibble|${n}|${text}`), k.privateKey).toString('base64url'); return `{"seq":${seq},"ts":"${at(min)}","from":"${k.did}","text":${JSON.stringify(text)},"nonce":${n},"sig":"${sig}"}`; };

test('stats: jobs, requesters, reposted IDs, outcomes with a grace period, fragments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'proofline-stats-'));
  try {
    const lines = [
      line(1, A, 'JOB v1 | k000000001 | build | Title one | details', 0),      // answered and attested
      line(2, W, 'CLAIM v1 | k000000001 | worker', 0.1),
      line(3, W, 'RESULT v1 | k000000001 | done', 0.5),                          // first result after 30 s
      line(4, V, 'ATTEST v1 | k000000001 | useful | fine', 1),
      line(5, A, 'JOB v1 | k000000002 | build | Same title | x', 2),           // reposted by two keys, never answered
      line(6, B, 'JOB v1 | k000000002 | build | Same title | x', 3),
      line(7, V, 'ATTEST v1 | k000000099 | not | job never seen', 4),          // fragment
      line(8, A, 'JOB v1 | k000000003 | build | Too recent | x', 100),         // inside the grace period
    ];
    writeFileSync(join(dir, 'k.jsonl'), lines.join('\n') + '\n');
    writeFileSync(join(dir, 'h.txt'), 'x-room-generation: 0\n');
    execFileSync(process.execPath, ['archive/collect.mjs', '--data', join(dir, 'data'), '--captured-at', at(110), '--import', `kibble=${join(dir, 'k.jsonl')},${join(dir, 'h.txt')}`]);
    const s = computeStats({ data: join(dir, 'data'), hours: 24, rooms: ['kibble'] }).rooms.kibble;
    assert.equal(s.complete, true);
    assert.deepEqual(s.signatures, { valid: 8, invalid: 0, no_sig: 0, unsigned: 0 });
    assert.deepEqual(s.jobs, { records: 4, ids: 3, requester_keys: 2, reposted_ids: 1, reposted_job_records: 2, reposted_share_pct: 50 });
    assert.equal(s.outcomes.basis_ids, 2, `the job posted ${OUTCOME_GRACE_MIN} min or less before the end is left out`);
    assert.deepEqual([s.outcomes.with_result, s.outcomes.with_result_pct, s.outcomes.with_useful_attestation_pct], [1, 50, 50]);
    assert.equal(s.outcomes.median_first_result_seconds, 30);
    assert.deepEqual([s.attestations.records, s.attestations.negative, s.ids_without_job, s.active_keys], [2, 1, 1, 4]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stats: only recent release captures are downloaded', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const c = (when, asset) => JSON.stringify({ ok: true, captured_at: when, storage: { kind: 'release', tag: 'kibble-x', asset } });
  const text = [c('2026-10-21T11:00:00Z', 'new.gz'), c('2026-10-20T08:00:00Z', 'old.gz'), JSON.stringify({ ok: true, captured_at: '2026-10-21T11:00:00Z', storage: { kind: 'git', files: [] } })].join('\n');
  assert.deepEqual(neededAssets(text, 24, now), ['kibble-x\tnew.gz']);
});

import { roomStats } from '../archive/stats.mjs';
const entry = (seq, min, text, from, gen = '0') => ({ rec: { seq, ts: at(min), from: from.did, text, nonce: String(nonce), sig: sign(null, Buffer.from(`kibble|${nonce}|${text}`), from.privateKey).toString('base64url') }, nonceDigits: String(nonce++), raw: Buffer.from(''), gen });
const win = { fromMs: Date.parse(at(0)), toMs: Date.parse(at(200)) };

test('stats: reposted means identical text from two or more keys; generations are never joined', () => {
  const s = roomStats('kibble', [
    entry(1, 0, 'JOB v1 | k000000010 | build | Title A | x', A), entry(2, 1, 'JOB v1 | k000000010 | build | Title B | x', B),   // same ID, different text
    entry(3, 2, 'JOB v1 | k000000011 | build | Same | x', A), entry(4, 3, 'JOB v1 | k000000011 | build | Same | x', B),         // identical text
    entry(5, 4, 'JOB v1 | k000000012 | build | Only g0 | x', A),
    entry(1, 5, 'RESULT v1 | k000000012 | unrelated answer in a new generation', W, '1'),
  ], win);
  assert.deepEqual([s.jobs.reposted_ids, s.jobs.reposted_job_records], [1, 2]);
  assert.equal(s.outcomes.with_result, 0, 'a result in generation 1 does not answer a job in generation 0');
});

test('stats: a day of records does not exceed engine limits', () => {
  const many = Array.from({ length: 200000 }, (_, i) => ({ rec: { seq: i + 1, ts: at(i / 2000), from: 'nick', text: `CLAIM v1 | k${i} | worker` }, nonceDigits: null, raw: Buffer.from(''), gen: '0' }));
  assert.equal(roomStats('kibble', many, win).records, 200000);
});

test('stats: a known gap after the last record dated before the window makes the window incomplete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'proofline-gap-'));
  try {
    const run = (name, lines, when) => { writeFileSync(join(dir, name), lines.join('\n') + '\n'); execFileSync(process.execPath, ['archive/collect.mjs', '--data', join(dir, 'data'), '--captured-at', when, '--import', `kibble=${join(dir, name)},${join(dir, 'h.txt')}`]); };
    writeFileSync(join(dir, 'h.txt'), 'x-room-generation: 0\n');
    run('a', [line(1, A, 'JOB v1 | k000000020 | build | before the window | x', -1500)], at(-1500));   // ~25 h before: outside a 24 h window
    run('b', [line(100, A, 'JOB v1 | k000000021 | build | inside | x', 60)], at(70));                  // seqs 2-99 never captured
    const s = computeStats({ data: join(dir, 'data'), hours: 24, rooms: ['kibble'] }).rooms.kibble;
    assert.equal(s.complete, false);
    assert.deepEqual(s.gaps.map((g) => [g.from, g.to]), [[2, 99]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
