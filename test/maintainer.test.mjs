import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseRoomPage, checkSignature } from '../src/lib/signature.js';

// Public archived d-proofline g1 #1, captured 2026-10-20. No signing secrets.
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

test('valid live proof avoids archive fallback', async () => {
  const r = await run(raw);
  assert.equal(r.archiveRequests, 0);
  assert.equal(r.out.className, 'proof ok');
  assert.doesNotMatch(r.out.textContent, /archived copy/);
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
