import test from 'node:test'; import assert from 'node:assert/strict';
import { parseMessage } from '../src/lib/protocol.js'; import { buildCases, wordingFromRequest } from '../src/lib/cases.js';
import { createRoomState, applyPage, coverage } from '../src/lib/store.js';
const M = (seq, from, text, extra = {}) => ({ seq, ts: `2026-10-19T10:00:${String(seq % 60).padStart(2, '0')}Z`, ...(from ? { from } : {}), sig: 's', sigStatus: 'valid', text, ...extra });
const recs = (ms, room = 'r') => ms.map((m) => parseMessage(m, room)).filter((p) => p.ok).map((p) => p.record);
const KA = 'did:key:z6MkA', KB = 'did:key:z6MkB', KC = 'did:key:z6MkC';

test('senders that are missing or are nicknames are never compared as keys', () => {
  let [c] = buildCases(recs([M(1, null, 'JOB v1 | kaaa111 | build | t'), M(2, null, 'CLAIM v1 | kaaa111 | worker'), M(3, null, 'RESULT v1 | kaaa111 | an answer here')]));
  assert.equal(c.continuity, 'no-key'); assert.deepEqual(c.flags.map((f) => f.id), []); assert.equal(c.links.length, 0);
  [c] = buildCases(recs([M(1, 'musecred', 'JOB v1 | kbbb222 | build | t'), M(2, 'musecred', 'CLAIM v1 | kbbb222 | worker'), M(3, 'musecred', 'RESULT v1 | kbbb222 | an answer here'), M(4, 'musecred', 'ATTEST v1 | kbbb222 | useful | ok')]));
  assert.equal(c.continuity, 'no-key'); assert.equal(c.attestation.state, 'no-key'); assert.equal(c.flags.length, 0);
});
test('signed keys are still compared', () => {
  const [c] = buildCases(recs([M(1, KA, 'JOB v1 | kccc333 | build | t'), M(2, KB, 'CLAIM v1 | kccc333 | worker'), M(3, KB, 'RESULT v1 | kccc333 | an answer here'), M(4, KC, 'ATTEST v1 | kccc333 | useful | ok')]));
  assert.equal(c.continuity, 'observed'); assert.deepEqual([c.attestation.other, c.attestation.self, c.attestation.unknown], [1, 0, 0]); assert.ok(c.links.some((l) => l.type === 'same-key'));
});
test('a short answer that restates the given words is flagged only as vocabulary, never as repetition', () => {
  assert.equal(wordingFromRequest({ body: 'build | Return exactly: red green blue yellow' }, { body: 'red green blue yellow' }), true);
  const [c] = buildCases(recs([M(1, KA, 'JOB v1 | kddd444 | build | Return exactly: red green blue yellow'), M(2, KB, 'RESULT v1 | kddd444 | red green blue yellow')]));
  const f = c.flags.find((x) => x.id === 'wording-from-request'); assert.ok(f); assert.doesNotMatch(f.label, /repeat|cop/i);
});
test('citations with short sequence numbers and same-stage citations are extracted', () => {
  let [c] = buildCases(recs([M(1, KA, 'TASK v1 | keee555 | verify | x'), M(2, KB, 'RESULT v1 | keee555 | answer text one'), M(3, KC, 'VOUCH v1 | keee555 | useful | cites seq 2 and seq #1')]));
  assert.deepEqual(c.links.filter((l) => l.type === 'cites').map((l) => [l.from, l.to]).sort(), [[3, 1], [3, 2]]);
  [c] = buildCases(recs([M(1, KA, 'JOB v1 | kfff666 | build | t'), M(2, KB, 'RESULT v1 | kfff666 | first answer'), M(3, KC, 'RESULT v1 | kfff666 | second, see seq 2')]));
  assert.ok(c.links.some((l) => l.from === 3 && l.to === 2));
});
test('parser requires the field each kind is about', () => {
  for (const t of ['TASK v1 | x', 'JOB v1 | kggg777', 'RESULT v1 | kggg777', 'RESULT v1 | kggg777 | ', 'ATTEST v1 | kggg777', 'VOUCH v1 | kggg777 | ']) assert.equal(parseMessage(M(9, KA, t), 'r').ok, false, t);
  for (const t of ['CLAIM v1 | kggg777', 'CLAIM v1 | kggg777 | worker', 'TASK v1 | kggg777 | verify | do it', 'RESULT v1 | kggg777 | text', 'ATTEST v1 | kggg777 | not | why']) assert.equal(parseMessage(M(9, KA, t), 'r').ok, true, t);
});
test('a reset followed by a full reload does not double-count ordinary lines', () => {
  const s = createRoomState('r'); applyPage(s, { generation: 0, last_seq: 5, messages: [M(4, KA, 'hello'), M(5, KA, 'hello again')] });
  applyPage(s, { generation: 1, last_seq: 5, messages: [M(5, KA, 'hello again')] }, { since: 5 });
  applyPage(s, { generation: 1, last_seq: 5, messages: [M(4, KA, 'hello'), M(5, KA, 'hello again')] });
  assert.equal(coverage(s).ignored, 2); assert.equal(s.resets, 1);
});
test('fingerprint changes when anything displayed changes, even if counts and seqs stay the same', () => {
  const base = [M(1, KA, 'JOB v1 | khhh888 | build | first request'), M(2, KB, 'RESULT v1 | khhh888 | Auto-delivered by VPS agent. Job done.')];
  const [a] = buildCases(recs(base));
  const [b] = buildCases(recs([M(1, KA, 'JOB v1 | khhh888 | build | a completely different request'), base[1]]));      // reset reuses id and seqs
  assert.notEqual(a.fingerprint, b.fingerprint);
  const other = [M(11, KA, 'JOB v1 | kiii999 | build | other'), M(12, KB, 'RESULT v1 | kiii999 | Auto-delivered by VPS agent. Job done.')];
  const [c1] = buildCases(recs(base)).filter((x) => x.id === 'khhh888'); const c2 = buildCases(recs([...base, ...other])).find((x) => x.id === 'khhh888');
  assert.notEqual(c1.fingerprint, c2.fingerprint, 'a new case that reuses this result text changes the reuse count shown for this case');
  assert.equal(buildCases(recs(base))[0].fingerprint, a.fingerprint, 'identical data gives an identical fingerprint');
});
