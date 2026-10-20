// ATTEST v1 | id | <hash> | verdict | text: a bare hash field before the verdict names the result judged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage } from '../src/lib/protocol.js';

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
