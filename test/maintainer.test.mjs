import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseRoomPage, checkSignature } from '../src/lib/signature.js';

// Public archived d-proofline g1 #1, captured 2026-10-20 (the original statement, now the archive fallback). No signing secrets.
const raw = fs.readFileSync(new URL('./fixtures/maintainer-statement.jsonl', import.meta.url), 'utf8').trim();
// Preserve the exact original numeric nonce and signature while altering only signed text.
const changed = raw.replace('maintain Proofline,', 'maintain Proofline!,');
const source = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('const MAINTAINER='), source.indexOf('\ncheckMaintainer();'));

async function run(live, archived = raw, verifier = checkSignature) {
  const out = {};
  let archiveRequests = 0;
  const context = {
    $: () => out, TextDecoder, parseRoomPage, checkSignature: verifier,
    fetch: async () => new Response(live + '\n'),
    loadPinned: async () => {
      archiveRequests++;
      return { lines: archived ? [new TextEncoder().encode(archived)] : [] };
    },
  };
  await vm.runInNewContext(functions + '\ncheckMaintainer()', context);
  return { out, archiveRequests };
}

test('valid live proof in the owned room avoids archive fallback', async () => {
  // A record in d-proofline-maintainer; its signature check is stubbed, since only the maintainer can sign there.
  const live = JSON.stringify({ ...parseRoomPage(raw), seq: 2, ts: '2026-11-07T12:00:00Z' });
  const rooms = [];
  const r = await run(live, raw, async (room) => { rooms.push(room); return room === 'd-proofline-maintainer' ? 'valid' : 'invalid'; });
  assert.equal(r.archiveRequests, 0);
  assert.deepEqual(rooms, ['d-proofline-maintainer']);
  assert.equal(r.out.className, 'proof ok');
  assert.equal(r.out.textContent, 'signature verified (d-proofline-maintainer #2, 2026-11-07).');
});

test('a statement copied into another room does not verify there', async () => {
  // The real d-proofline #1 signature covers d-proofline, so served from the new room it fails and the archive is used.
  const r = await run(raw);
  assert.equal(r.archiveRequests, 1);
  assert.equal(r.out.className, 'proof ok');
  assert.equal(r.out.textContent, 'signature verified (archived copy of d-proofline #1, 2026-10-20).');
});

test('a statement from another key is never taken as the maintainer\'s', async () => {
  const other = JSON.stringify({ ...parseRoomPage(raw), from: 'did:key:z6MknRguvViuHEyArh199xLnrw5nh8W9makrgY8WLnsKm5ZR' });
  const r = await run(other, raw, async () => 'valid');
  assert.equal(r.archiveRequests, 1);
  assert.match(r.out.textContent, /archived copy of d-proofline #1/);
});

test('the first maintainer statement in the room is used, after other lines', async () => {
  const noise = JSON.stringify({ seq: 1, ts: '2026-11-07T11:59:00Z', from: 'anon', text: 'hello' });
  const live = noise + '\nnot json\n' + JSON.stringify({ ...parseRoomPage(raw), seq: 3 });
  const r = await run(live, raw, async (room) => (room === 'd-proofline-maintainer' ? 'valid' : 'invalid'));
  assert.equal(r.archiveRequests, 0);
  assert.match(r.out.textContent, /d-proofline-maintainer #3/);
});

test('missing, invalid and unsigned live statements fall back to verified archive proof', async () => {
  const withoutSignature = JSON.stringify({ ...parseRoomPage(raw), sig: undefined });
  for (const live of [changed, withoutSignature, '']) {
    const r = await run(live);
    assert.equal(r.archiveRequests, 1);
    assert.equal(r.out.className, 'proof ok');
    assert.match(r.out.textContent, /signature verified \(archived copy/);
    assert.doesNotMatch(r.out.textContent, /room no longer holds it/);
  }
});

test('invalid archive signature cannot be shown as verified', async () => {
  const r = await run(changed, changed);
  assert.equal(r.archiveRequests, 1);
  assert.equal(r.out.className, 'proof bad');
  assert.equal(r.out.textContent, 'the signature does not verify.');
});

test('missing proof remains unavailable, never verified', async () => {
  const r = await run('', '');
  assert.equal(r.archiveRequests, 1);
  assert.equal(r.out.className, 'proof warn');
  assert.doesNotMatch(r.out.textContent, /signature verified/);
});

test('unsupported browser stays unchecked, never verified', async () => {
  const r = await run(raw, raw, async () => 'unchecked');
  assert.equal(r.archiveRequests, 0);
  assert.equal(r.out.className, 'proof warn');
  assert.equal(r.out.textContent, 'your browser cannot check this signature.');
});
