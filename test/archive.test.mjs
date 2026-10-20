import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseLine, splitExport, classify } from '../archive/lib/records.mjs';
import { ingest } from '../archive/collect.mjs';
import { check } from '../archive/check.mjs';
import { exportBundle } from '../archive/export.mjs';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(buf) {
  let n = BigInt('0x' + buf.toString('hex'));
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
const DID = 'did:key:z' + b58encode(Buffer.concat([Buffer.from([0xed, 0x01]), pub]));

// A record line exactly as the server would store it. The nonce is written as raw digits
// so 19-digit nonces past 2^53 appear verbatim, as in a real export.
function line({ room = 'credence', seq, text = `TASK v1 | t${seq} | docs | Title | details`, nonce = '1787930687977', signed = true, from = DID, ts = '2026-10-20T07:00:00.000000Z' }) {
  const sig = signed ? sign(null, Buffer.from(`${room}|${nonce}|${text}`, 'utf8'), privateKey).toString('base64url') : null;
  const head = `{"seq":${seq},"ts":${JSON.stringify(ts)},"from":${JSON.stringify(from)},"text":${JSON.stringify(text)}`;
  if (from.startsWith('did:key:') && nonce !== null) return `${head},"nonce":${nonce}${sig ? `,"sig":"${sig}"` : ''}}`;
  return head + '}';
}
const body = (...lines) => Buffer.from(lines.join('\n') + '\n');
const status = (l, room = 'credence') => classify(room, parseLine(Buffer.from(l)));

test('signature check uses upstream canonical form and exact 19-digit nonces', () => {
  const big = '1792480213729123456'; // > 2^53: JSON.parse would round it and break the check
  assert.equal(status(line({ seq: 1, nonce: big })), 'valid');
  assert.equal(parseLine(Buffer.from(line({ seq: 1, nonce: big }))).nonceDigits, big);
  assert.equal(status(line({ seq: 1, text: 'SUBMIT v1 | x | Việt ✓' })), 'valid', 'non-ASCII text signs as UTF-8');
});

test('altered text, nonce or room fails; missing sig and nicknames are their own states', () => {
  const good = line({ seq: 1 });
  assert.equal(status(good.replace('Title', 'Titl3')), 'invalid');
  assert.equal(status(good.replace('"nonce":1787930687977', '"nonce":1787930687978')), 'invalid');
  assert.equal(status(good, 'kibble'), 'invalid', 'room is part of the signed bytes');
  assert.equal(status(line({ seq: 1, signed: false })), 'no_sig');
  assert.equal(status(line({ seq: 1, from: 'alice', signed: false })), 'unsigned');
  assert.equal(status(good.replace(/"sig":"[^"]+"/, '"sig":"short"')), 'invalid');
});

test('split keeps complete lines only and counts unusable ones', () => {
  const b = Buffer.from(`${line({ seq: 1 })}\nnot json\n{"no":"seq"}\n${line({ seq: 2 })}\n{"seq":3,"te`);
  const r = splitExport(b);
  assert.deepEqual(r.parsed.map((p) => p.rec.seq), [1, 2]);
  assert.equal(r.unparseable.length, 2);
  assert.ok(r.partialTail > 0);
});

test('ingest: first capture, overlap, gap, generation change, regression', () => {
  const at = '2026-10-20T08:00:00Z';
  const first = ingest({ room: 'credence', body: body(line({ seq: 1 }), line({ seq: 2 }), line({ seq: 3 })), generation: '0', capturedAt: at, prev: undefined });
  assert.equal(first.entry.new_records, 3);
  assert.deepEqual(first.entry.events.map((e) => e.type), ['first_capture']);
  assert.deepEqual(first.nextState, { generation: '0', last_seq: 3, last_capture: at });

  const overlap = ingest({ room: 'credence', body: body(line({ seq: 2 }), line({ seq: 3 }), line({ seq: 4 })), generation: '0', capturedAt: at, prev: first.nextState });
  assert.equal(overlap.entry.new_records, 1, 'records already archived are not stored twice');
  assert.equal(overlap.entry.new_first_seq, 4);
  assert.deepEqual(overlap.entry.events, []);

  const gap = ingest({ room: 'credence', body: body(line({ seq: 9 }), line({ seq: 10 })), generation: '0', capturedAt: at, prev: overlap.nextState });
  assert.deepEqual(gap.entry.events, [{ type: 'gap', from: 5, to: 8 }]);

  const reset = ingest({ room: 'credence', body: body(line({ seq: 1 })), generation: '1', capturedAt: at, prev: gap.nextState });
  assert.equal(reset.entry.events[0].type, 'generation_change');
  assert.equal(reset.entry.new_records, 1, 'a new generation is archived from its start');

  const regress = ingest({ room: 'credence', body: body(line({ seq: 2 })), generation: '0', capturedAt: at, prev: gap.nextState });
  assert.equal(regress.entry.events[0].type, 'seq_regression');

  const empty = ingest({ room: 'credence', body: Buffer.alloc(0), generation: '0', capturedAt: at, prev: gap.nextState });
  assert.equal(empty.entry.new_records, 0);
  assert.equal(empty.nextState.last_seq, 10, 'an empty answer does not move the cursor');
});

test('collect + check: reproduces counts, coverage and a case; detects tampering and missing files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'proofline-archive-'));
  try {
    const data = join(dir, 'data'), outbox = join(dir, 'outbox');
    const hdr = join(dir, 'h.txt');
    writeFileSync(hdr, 'date: Tue, 20 Oct 2026 07:00:00 GMT\nx-room-generation: 0\n');
    const write = (name, ...lines) => { writeFileSync(join(dir, name), body(...lines)); return join(dir, name); };
    const run = (args) => execFileSync(process.execPath, ['archive/collect.mjs', '--data', data, '--outbox', outbox, '--release-rooms', 'kibble', ...args], { encoding: 'utf8' });

    const c1 = write('c1', line({ seq: 1, text: 'TASK v1 | t1 | docs | Title | details' }), line({ seq: 2, text: 'ACCEPT v1 | t1 | worker', signed: false }),
      line({ seq: 3, text: 'SUBMIT v1 | t1 | done', from: 'nick', signed: false }), line({ seq: 4, text: 'VOUCH v1 | t1 | useful | ok', ts: '2026-10-21T00:00:00Z' }));
    const k1 = write('k1', line({ room: 'kibble', seq: 100 }), line({ room: 'kibble', seq: 101 }));
    run(['--captured-at', '2026-10-20T07:00:00Z', '--import', `credence=${c1},${hdr}`, '--import', `kibble=${k1},${hdr}`]);
    const k2 = write('k2', line({ room: 'kibble', seq: 105 }));
    run(['--captured-at', '2026-10-20T07:20:00Z', '--import', `kibble=${k2},${hdr}`]);

    const r = check({ data, assets: outbox, caseRef: 'credence:t1' });
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.rooms.credence.g0.verification, { valid: 2, invalid: 0, no_sig: 1, unsigned: 1 });
    assert.deepEqual(r.rooms.kibble.g0.observed_continuous_runs, [{ from: 100, to: 101 }, { from: 105, to: 105 }]);
    assert.deepEqual(r.rooms.kibble.g0.known_gaps.map(({ from, to }) => [from, to]), [[102, 104]]);
    assert.deepEqual(r.case.records.map((c) => `${c.kind}:${c.signature}`), ['TASK:valid', 'ACCEPT:no_sig', 'SUBMIT:unsigned', 'VOUCH:valid']);
    assert.deepEqual(readdirSync(join(data, 'rooms/credence/g0')).sort(), ['2026-10-20.jsonl', '2026-10-21.jsonl'], 'git storage is split by record date');

    // Without the release files, the kibble captures are reported as not available, not as absent history.
    const noAssets = check({ data });
    assert.equal(noAssets.rooms.kibble.g0.records, 0);
    assert.equal(noAssets.rooms.kibble.g0.unknown.not_available_to_this_check.length, 2);

    // Only release files recorded in the manifest, with matching hashes, are listed for upload.
    const pend = (d) => execFileSync(process.execPath, ['archive/pending.mjs', '--data', d], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const pdata = join(dir, 'pdata');
    execFileSync(process.execPath, ['archive/collect.mjs', '--data', pdata, '--outbox', join(pdata, 'pending-uploads'), '--release-rooms', 'kibble', '--captured-at', '2026-10-20T07:00:00Z', '--import', `kibble=${k1},${hdr}`]);
    assert.match(pend(pdata), /^kibble-2026-10-20\t.*kibble-g0-100-101\.jsonl\.gz\n$/);
    assert.equal(check({ data: pdata }).rooms.kibble.g0.records, 2, 'check also reads files still waiting for upload');
    writeFileSync(join(pdata, 'pending-uploads/kibble-2026-10-20/extra.jsonl.gz'), 'x');
    assert.throws(() => pend(pdata));

    // Export: deterministic, pinned to a window, refuses windows the archive does not cover.
    const b1 = exportBundle({ data, assets: outbox, room: 'credence', fromSeq: 1, toSeq: 4 });
    const b2 = exportBundle({ data, assets: outbox, room: 'credence', fromSeq: 1, toSeq: 4 });
    assert.equal(b1.bundleId, b2.bundleId);
    assert.ok(b1.rawBytes.equals(b2.rawBytes) && b1.casesBytes.equals(b2.casesBytes));
    assert.deepEqual(b1.manifest.signatures, { valid: 2, invalid: 0, no_sig: 1, unsigned: 1 });
    assert.deepEqual(JSON.parse(b1.casesBytes)[0].records.map((r) => `${r.kind}:${r.sig_status}:${r.key ? 'key' : '-'}`),
      ['TASK:valid:key', 'ACCEPT:no_sig:-', 'SUBMIT:unsigned:-', 'VOUCH:valid:key']);
    assert.throws(() => exportBundle({ data, assets: outbox, room: 'kibble', fromSeq: 100, toSeq: 105 }), /3 sequence numbers/);
    assert.equal(exportBundle({ data, assets: outbox, room: 'kibble', fromSeq: 100, toSeq: 105, allowGaps: true }).manifest.coverage.seqs_missing_from_archive, 3);
    assert.notEqual(exportBundle({ data, assets: outbox, room: 'credence', fromSeq: 1, toSeq: 3 }).bundleId, b1.bundleId, 'a different window is a different bundle');

    // One changed byte in an archived file is caught.
    const f = join(data, 'rooms/credence/g0/2026-10-20.jsonl');
    writeFileSync(f, readFileSync(f, 'utf8').replace('Title', 'Titlf'));
    assert.equal(check({ data, assets: outbox }).problems.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
