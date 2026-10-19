import test from 'node:test'; import assert from 'node:assert/strict';
import { parseMessage } from '../src/lib/protocol.js'; import { buildCases } from '../src/lib/cases.js'; import { fixture, synthetic } from './helpers.mjs';
const recs = (byRoom) => Object.entries(byRoom).flatMap(([room, ms]) => ms.map((x) => parseMessage(x, room)).filter((p) => p.ok).map((p) => p.record));
test('same id in two rooms is two cases and a foreign room cannot supply the title', () => {
  const cs = buildCases(recs(synthetic('cross-room-forgery').rooms));
  assert.equal(cs.length, 2);
  const kib = cs.find((c) => c.room === 'kibble'); assert.equal(kib.title, 'Real request text'); assert.equal(kib.stages[0].length, 1);
  const cre = cs.find((c) => c.room === 'credence'); assert.equal(cre.status, 'partial');
});
test('kibble case stage counts from the real echo-result fixture', () => {
  const f = fixture('echo-result-k53fd0a884e'); const [c] = buildCases(recs({ kibble: f.messages }));
  assert.deepEqual(c.stages.map((s) => s.length), [1, 6, 5, 1]); assert.equal(c.status, 'all-stages');
});
test('records inside a case are ordered by seq', () => { const f = fixture('echo-result-k53fd0a884e'); const [c] = buildCases(recs({ kibble: [...f.messages].reverse() })); assert.deepEqual(c.list.map((r) => r.seq), [...c.list.map((r) => r.seq)].sort((a, b) => a - b)); });
test('real credence chain keeps 4 stages in its own room', () => { const f = fixture('self-assertion-t8a3c1f7e29'); const cs = buildCases(recs({ credence: f.messages })); assert.ok(cs.every((c) => c.room === 'credence')); assert.ok(cs.find((c) => c.id === 't8a3c1f7e29').stages.every((s) => s.length > 0)); });
// Interpretation (step 3)
const one = (n) => buildCases(recs(synthetic(n).rooms))[0];
test('attestation without a result is "no-result", not independent', () => { const c = one('attestation-only'); assert.equal(c.attestation.state, 'no-result'); assert.equal(c.continuity, 'no-worker'); assert.equal(c.status, 'no-request'); });
test('mixed verdicts are counted, and only the negative flag is set', () => { const c = one('mixed-verdicts'); assert.deepEqual(c.verdicts, { useful: 2, not: 1, other: 0 }); assert.equal(c.negative, true); assert.equal(c.status, 'all-stages'); });
test('there is no lexical similarity score any more', () => { const c = one('echo-and-ok'); assert.equal('semantic' in c, false); assert.equal(c.flags.some((f) => f.id === 'repeats-request'), false); });
test('real echo case: first RESULT repeats the request, the later answers do not', () => {
  const f = fixture('echo-result-k53fd0a884e'); const [c] = buildCases(recs({ kibble: f.messages }));
  const flag = c.flags.find((x) => x.id === 'repeats-request'); assert.deepEqual(flag.seqs, [19719293]);
  assert.ok(c.elapsedFirst <= 5000 && c.elapsedLast > 60000);
});
test('attestations are split into same-key and other-key', () => { const c = one('mixed-verdicts'); assert.deepEqual([c.attestation.self, c.attestation.other], [0, 3]); });
test('identical result and attestation text across cases is flagged, with counts', () => {
  const M = (seq, f, t) => ({ seq, ts: `2026-10-19T10:00:${String(seq).padStart(2, '0')}Z`, from: 'did:key:z6Mk' + f, sig: 's', text: t });
  const ms = [];
  for (const id of ['ka000001', 'kb000002', 'kc000003']) { const b = ms.length; ms.push(M(b + 1, 'REQ', `JOB v1 | ${id} | build | do ${id} something unique`), M(b + 2, 'W' + id, `CLAIM v1 | ${id} | worker`), M(b + 3, 'W' + id, `RESULT v1 | ${id} | Auto-delivered by VPS agent. Job received and processed.`), M(b + 4, 'A' + id, `ATTEST v1 | ${id} | useful | Looks technically sound and complete.`)); }
  const cs = buildCases(recs({ kibble: ms })); assert.equal(cs.length, 3);
  for (const c of cs) { assert.ok(c.flags.some((f) => f.id === 'reused-result' && /2 other cases/.test(f.detail))); assert.ok(c.flags.some((f) => f.id === 'reused-attestation')); }
  assert.ok(cs.every((c) => !c.flags.some((f) => f.id === 'requester-posted-work')), 'requester key never posted a claim or result here');
});
test('requester key that also posted a result is flagged', () => {
  const c = buildCases(recs({ credence: fixture('self-assertion-t8a3c1f7e29').messages })).find((x) => x.id === 't8a3c1f7e29');
  assert.ok(c.flags.some((f) => f.id === 'requester-posted-work'));
});
test('explicit seq citations become links; other nodes get none', () => {
  const c = buildCases(recs({ credence: fixture('self-assertion-t8a3c1f7e29').messages })).find((x) => x.id === 't8a3c1f7e29');
  assert.ok(c.links.some((l) => l.type === 'cites' && l.from === 13143 && l.to === 13139));
  assert.ok(c.links.every((l) => l.type !== 'cites' || (c.list.some((r) => r.seq === l.from) && c.list.some((r) => r.seq === l.to))));
});
test('12 claims: links never reference nodes that are not in the case', () => { const c = one('many-claims'); const seqs = new Set(c.list.map((r) => r.seq)); assert.ok(c.links.every((l) => seqs.has(l.from) && seqs.has(l.to))); assert.equal(c.stages[1].length, 12); });
