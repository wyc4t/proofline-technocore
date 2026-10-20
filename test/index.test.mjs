import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureIndex, addToIndex } from '../archive/lib/index.mjs';
import { locateCaptures, locateViaIndex } from '../src/lib/snapshot.js';

const cap = (at, room, gen, a, b, n = b - a + 1) => ({ ok: true, captured_at: at, room, generation: String(gen), new_records: n, new_first_seq: a, new_last_seq: b, new_sha256: `h${a}`, export_sha256: 'big', events: [], storage: { kind: 'git', files: [] } });
const captures = [
  cap('2026-10-20T07:00:00Z', 'kibble', 0, 100, 199), cap('2026-10-20T08:00:00Z', 'kibble', 0, 200, 299),
  cap('2026-10-21T00:10:00Z', 'kibble', 0, 300, 399), cap('2026-10-21T00:20:00Z', 'kibble', 0, 400, 400, 0),  // no new records: not indexed
  { ok: false, captured_at: '2026-10-21T00:30:00Z', room: 'kibble', error: 'x' },
  cap('2026-10-21T01:00:00Z', 'kibble', 1, 1, 50),                                                           // after a reset
  cap('2026-10-20T07:00:00Z', 'credence', 0, 1, 13281),
];

test('the index is built from captures.jsonl once, and kept up to date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'proofline-index-'));
  try {
    writeFileSync(join(dir, 'captures.jsonl'), captures.slice(0, 6).map((c) => JSON.stringify(c)).join('\n') + '\n');
    assert.equal(ensureIndex(dir), true);
    assert.equal(ensureIndex(dir), false, 'not rebuilt once it exists');
    addToIndex(dir, captures[6]);
    const days = JSON.parse(readFileSync(join(dir, 'index/kibble/days.json'), 'utf8')).days;
    assert.deepEqual(days, [{ day: '2026-10-20', g: '0', first: 100, last: 299 }, { day: '2026-10-21', g: '0', first: 300, last: 399 }, { day: '2026-10-21', g: '1', first: 1, last: 50 }]);
    assert.deepEqual(readdirSync(join(dir, 'index')).sort(), ['credence', 'kibble']);
    const line = JSON.parse(readFileSync(join(dir, 'index/kibble/2026-10-20.jsonl'), 'utf8').split('\n')[0]);
    assert.equal(line.export_sha256, undefined, 'index lines keep only what a reader needs');
    assert.equal(line.new_sha256, 'h100');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('locating through the index gives the same captures as the full log', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'proofline-index-'));
  try {
    writeFileSync(join(dir, 'captures.jsonl'), captures.map((c) => JSON.stringify(c)).join('\n') + '\n');
    ensureIndex(dir);
    const fetchText = async (u) => readFileSync(join(dir, u.replace('raw/', '')), 'utf8');
    const full = readFileSync(join(dir, 'captures.jsonl'), 'utf8');
    for (const [room, gen, a, b] of [['kibble', '0', 150, 320], ['kibble', '0', 250, 260], ['kibble', '1', 1, 10], ['kibble', '0', 900, 950], ['credence', '0', 2, 7]]) {
      const viaIndex = await locateViaIndex({ room, gen, from: a, to: b, fetchText, rawBase: 'raw/' });
      assert.deepEqual(viaIndex.map((c) => c.new_first_seq), locateCaptures(full, room, gen, a, b).map((c) => c.new_first_seq), `${room} g${gen} ${a}-${b}`);
    }
    assert.equal(await locateViaIndex({ room: 'nothing', gen: '0', from: 1, to: 2, fetchText, rawBase: 'raw/' }), null, 'no index: the caller falls back to the full log');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
