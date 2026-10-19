import test from 'node:test'; import assert from 'node:assert/strict';
import { parseMessage } from '../dist/lib/protocol.js'; import { buildCases } from '../dist/lib/cases.js'; import { fixture, synthetic } from './helpers.mjs';
const recs = (byRoom) => Object.entries(byRoom).flatMap(([room, ms]) => ms.map((x) => parseMessage(x, room)).filter((p) => p.ok).map((p) => p.record));
test('same id in two rooms is two cases and a foreign room cannot supply the title', () => {
  const cs = buildCases(recs(synthetic('cross-room-forgery').rooms));
  assert.equal(cs.length, 2);
  const kib = cs.find((c) => c.room === 'kibble'); assert.equal(kib.title, 'Real request text'); assert.equal(kib.stages[0].length, 1);
  const cre = cs.find((c) => c.room === 'credence'); assert.equal(cre.status, 'partial');
});
test('kibble case stage counts from the real echo-result fixture', () => {
  const f = fixture('echo-result-k53fd0a884e'); const [c] = buildCases(recs({ kibble: f.messages }));
  assert.deepEqual(c.stages.map((s) => s.length), [1, 6, 5, 1]); assert.equal(c.status, 'complete');
});
test('records inside a case are ordered by seq', () => { const f = fixture('echo-result-k53fd0a884e'); const [c] = buildCases(recs({ kibble: [...f.messages].reverse() })); assert.deepEqual(c.list.map((r) => r.seq), [...c.list.map((r) => r.seq)].sort((a, b) => a - b)); });
test('real credence chain keeps 4 stages in its own room', () => { const f = fixture('self-assertion-t8a3c1f7e29'); const cs = buildCases(recs({ credence: f.messages })); assert.ok(cs.every((c) => c.room === 'credence')); assert.ok(cs.find((c) => c.id === 't8a3c1f7e29').stages.every((s) => s.length > 0)); });
// Step 3 (interpretation). Pending until implemented; each states the intended behaviour.
test('attestation without a result reports independence as unavailable', { todo: 'step 3' }, () => { const [c] = buildCases(recs(synthetic('attestation-only').rooms)); assert.equal(c.independent, null); });
test('mixed verdicts are counted per verdict, not one flag for the case', { todo: 'step 3' }, () => { const [c] = buildCases(recs(synthetic('mixed-verdicts').rooms)); assert.deepEqual(c.verdicts, { useful: 2, not: 1 }); });
test('a bare "ok" result does not receive a similarity score', { todo: 'step 3' }, () => { const [c] = buildCases(recs(synthetic('echo-and-ok').rooms)); assert.equal(c.semantic, undefined); });
