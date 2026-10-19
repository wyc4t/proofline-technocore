import test from 'node:test'; import assert from 'node:assert/strict';
import { createRoomState, applyPage, querySince, markError, markOk, coverage, allRecords } from '../dist/lib/store.js';
const msg = (seq, text = `CLAIM v1 | k${seq}abc | worker`, ts = `2026-10-19T10:00:${String(seq % 60).padStart(2, '0')}Z`) => ({ seq, ts, from: 'did:key:z6MkA', sig: 's', text });
const page = (seqs, extra = {}) => ({ messages: seqs.map((s) => msg(s)), first_seq: seqs[0], last_seq: seqs.at(-1), generation: 0, ...extra });
test('first poll has no cursor; later polls resume after lastSeq', () => { const s = createRoomState('kibble'); assert.equal(querySince(s), null); applyPage(s, page([1, 2, 3])); assert.equal(querySince(s), 3); });
test('duplicate seqs are not stored twice', () => { const s = createRoomState('r'); applyPage(s, page([1, 2])); applyPage(s, page([2, 3]), { since: 2 }); assert.equal(s.records.size, 3); });
test('a missed range is recorded when first_seq > since + 1', () => { const s = createRoomState('r'); applyPage(s, page([1, 2, 3])); applyPage(s, page([10, 11]), { since: 3 }); assert.deepEqual(s.gaps, [{ afterSeq: 3, uptoSeq: 9, missed: 6 }]); assert.equal(coverage(s).missed, 6); });
test('contiguous polls record no gap', () => { const s = createRoomState('r'); applyPage(s, page([1, 2])); applyPage(s, page([3, 4]), { since: 2 }); assert.equal(s.gaps.length, 0); });
test('a generation change clears the room and forces a full reload', () => { const s = createRoomState('r'); applyPage(s, page([1, 2, 3])); applyPage(s, page([1], { generation: 1 }), { since: 3 }); assert.equal(s.resets, 1); assert.equal(querySince(s), null); assert.equal(s.gaps.length, 0); applyPage(s, page([1, 2], { generation: 1 })); assert.equal(s.needsFullReload, false); assert.equal(s.records.size, 2); });
test('last_seq below the cursor is treated as a reset', () => { const s = createRoomState('r'); applyPage(s, page([100, 101])); applyPage(s, { messages: [], last_seq: 5, generation: 0 }, { since: 101 }); assert.equal(s.resets, 1); assert.equal(s.records.size, 0); });
test('cap evicts per room: a busy room cannot evict another', () => {
  const busy = createRoomState('kibble'), quiet = createRoomState('credence'); applyPage(quiet, page([1, 2, 3]));
  applyPage(busy, page(Array.from({ length: 50 }, (_, i) => i + 1)), { cap: 10 });
  assert.equal(busy.records.size, 10); assert.equal(busy.evicted, 40); assert.equal(quiet.records.size, 3); assert.equal(allRecords([busy, quiet]).length, 13);
  assert.equal(coverage(busy).windowStart, msg(41).ts);
});
test('a failed poll keeps previously observed records and flags the room', () => { const s = createRoomState('r'); applyPage(s, page([1, 2])); markOk(s, 1); markError(s, 'r returned 503', 2); assert.equal(s.records.size, 2); assert.equal(coverage(s).status, 'error'); assert.equal(coverage(s).error, 'r returned 503'); });
test('non-protocol and malformed lines are counted, not dropped silently', () => { const s = createRoomState('r'); applyPage(s, { messages: [msg(1, 'hello'), msg(2, 'CLAIM v1  x  y'), msg(3, 'TASK | kabc123 | t'), msg(4)], generation: 0 }); assert.deepEqual(s.counts, { protocol: 1, malformed: 1, unsupported: 1, ignored: 1 }); });
