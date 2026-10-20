import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { parsePin, formatPin, locateCaptures, uncovered, loadPinned } from '../src/lib/snapshot.js';
import { validate } from '../api/asset.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const line = (seq, text = `CLAIM v1 | k${seq} | worker`) => `{"seq":${seq},"ts":"2026-10-20T08:00:00Z","from":"nick","text":${JSON.stringify(text)}}`;
const block = (...seqs) => Buffer.from(seqs.map((s) => line(s)).join('\n') + '\n');

test('pins parse strictly', () => {
  assert.deepEqual(parsePin('g0:10-20'), { gen: '0', from: 10, to: 20 });
  assert.equal(formatPin('1', 5, 9), 'g1:5-9');
  for (const bad of ['g0:20-10', '0:1-2', 'g0:1-', 'g0:1-2;x', 'gx:1-2', '', null]) assert.equal(parsePin(bad), null, String(bad));
});

test('captures are located by room, generation and overlap; uncovered seqs are counted', () => {
  const caps = [
    { ok: true, room: 'kibble', generation: '0', new_records: 3, new_first_seq: 10, new_last_seq: 12 },
    { ok: true, room: 'kibble', generation: '0', new_records: 2, new_first_seq: 15, new_last_seq: 16 },
    { ok: true, room: 'kibble', generation: '1', new_records: 2, new_first_seq: 10, new_last_seq: 11 },
    { ok: false, room: 'kibble', error: 'x' },
    { ok: true, room: 'credence', generation: '0', new_records: 1, new_first_seq: 11, new_last_seq: 11 },
  ];
  const text = caps.map((c) => JSON.stringify(c)).join('\n');
  const found = locateCaptures(text, 'kibble', '0', 11, 16);
  assert.equal(found.length, 2);
  assert.equal(uncovered(found, 11, 16), 2, '13 and 14 are not covered');
  assert.equal(uncovered(found, 11, 12), 0);
  assert.equal(uncovered([], 1, 3), 3);
});

function archive() {
  // one release capture (kibble) and one git capture (credence) with their manifest entries
  const kib = block(100, 101, 102), kgz = gzipSync(kib);
  const cre = block(1, 2);
  const caps = [
    { ok: true, room: 'kibble', generation: '0', new_records: 3, new_first_seq: 100, new_last_seq: 102, new_sha256: sha(kib), captured_at: 'T1',
      storage: { kind: 'release', tag: 'kibble-2026-10-20', asset: 'kibble-g0-100-102.jsonl.gz', gz_sha256: sha(kgz) } },
    { ok: true, room: 'credence', generation: '0', new_records: 2, new_first_seq: 1, new_last_seq: 2, new_sha256: sha(cre), captured_at: 'T2',
      storage: { kind: 'git', files: ['rooms/credence/g0/2026-10-20.jsonl'] } },
  ];
  const files = new Map([
    ['raw/captures.jsonl', Buffer.from(caps.map((c) => JSON.stringify(c)).join('\n') + '\n')],
    ['asset/kibble-2026-10-20/kibble-g0-100-102.jsonl.gz', kgz],
    ['raw/rooms/credence/g0/2026-10-20.jsonl', cre],
  ]);
  const get = (u) => { if (!files.has(u)) throw new Error('404 ' + u); return new Uint8Array(files.get(u)); };
  return { files, opts: { rawBase: 'raw/', fetchText: async (u) => Buffer.from(get(u)).toString(), fetchBytes: async (u) => get(u), assetUrl: (t, a) => `asset/${t}/${a}` } };
}
const seqs = (r) => r.lines.map((l) => JSON.parse(Buffer.from(l).toString()).seq);

test('loads a pinned window from release and git captures, verified against the manifest', async () => {
  const { opts } = archive();
  const k = await loadPinned({ room: 'kibble', gen: '0', from: 101, to: 102, ...opts });
  assert.deepEqual(seqs(k), [101, 102]);
  assert.deepEqual(k.captures.map((c) => c.integrity), ['verified']);
  const c = await loadPinned({ room: 'credence', gen: '0', from: 1, to: 5, ...opts });
  assert.deepEqual(seqs(c), [1, 2]);
  assert.equal(c.missing, 3, 'seqs 3-5 are not in the archive and are reported, not hidden');
  const none = await loadPinned({ room: 'kibble', gen: '0', from: 500, to: 501, ...opts });
  assert.deepEqual([none.lines.length, none.missing], [0, 2]);
});

test('a changed archive file or record is rejected', async () => {
  const a = archive();
  a.files.set('asset/kibble-2026-10-20/kibble-g0-100-102.jsonl.gz', gzipSync(block(100, 101, 103)));
  await assert.rejects(loadPinned({ room: 'kibble', gen: '0', from: 100, to: 102, ...a.opts }), /does not match the manifest/);
  const b = archive();
  b.files.set('raw/rooms/credence/g0/2026-10-20.jsonl', Buffer.from(line(1) + '\n' + line(2, 'CLAIM v1 | k2 | w0rker') + '\n'));
  await assert.rejects(loadPinned({ room: 'credence', gen: '0', from: 1, to: 2, ...b.opts }), /do not match the manifest/);
});

test('the asset endpoint accepts only archive file names, room-matched', () => {
  assert.equal(validate('kibble-2026-10-20', 'kibble-g0-19918961-19920466.jsonl.gz'), null);
  assert.match(validate('kibble-2026-10-20', 'credence-g0-1-2.jsonl.gz'), /belong/);
  for (const [t, a] of [['../x', 'kibble-g0-1-2.jsonl.gz'], ['kibble-2026-10-20', 'kibble-g0-1-2.jsonl.gz/../../x'], ['kibble-2026-10-20', 'x.exe'], ['v1.0', 'kibble-g0-1-2.jsonl.gz'], [undefined, undefined]]) assert.ok(validate(t, a), `${t} ${a}`);
});
