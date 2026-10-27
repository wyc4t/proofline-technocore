import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseRoomPage, annotateSignatures, annotateContentHashes } from '../src/lib/signature.js';
import { parseMessage } from '../src/lib/protocol.js';
import { buildCases } from '../src/lib/cases.js';
import { parsePin } from '../src/lib/snapshot.js';

// Byte-exact public lines copied from the full Credence g0 preservation bundle:
// records.jsonl SHA-256 4bde2b7a24b9b8533ed80a93ba46afb01be664be0fe63673e6e2e1927fed0783.
// Complete windows 2–7, 4544–4550 and 13135–13143, including non-case records.
const fixture = fs.readFileSync(new URL('./fixtures/guided-examples.jsonl', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../dist/examples.html', import.meta.url), 'utf8');

test('guided pins and key/signature observations match preserved evidence', async () => {
  const byRoom={credence:fixture.trimEnd().split('\n').map(parseRoomPage),kibble:fs.readFileSync(new URL('./fixtures/conflict-k7319be7534.jsonl',import.meta.url),'utf8').trimEnd().split('\n').map(parseRoomPage)};
  for(const [room,messages] of Object.entries(byRoom)){await annotateSignatures(room,messages);await annotateContentHashes(messages)}
  const articles = [...html.matchAll(/<article class="example"([^>]*)>([\s\S]*?)<\/article>/g)];
  assert.equal(articles.length, 4);
  for (const [, attrs, body] of articles) {
    const attr = name => new RegExp(`data-${name}="([^"]+)"`).exec(attrs)?.[1];
    const href = /class="example-action" href="([^"]+)"/.exec(body)[1].replaceAll('&amp;', '&');
    const url = new URL(href, 'https://proofline-technocore.vercel.app/');
    assert.equal(url.searchParams.get('case'), attr('case'));
    assert.equal(url.searchParams.get('guide'), '1', 'example links explicitly opt into the walkthrough');
    const pin = parsePin(url.searchParams.get('at'));
    assert.equal(pin.gen, '0');
    const room=attr('case').split(':')[0],messages=byRoom[room];
    const window = messages.filter(m => m.seq >= pin.from && m.seq <= pin.to);
    if(room==='credence')assert.equal(new Set(window.map(m => m.seq)).size, pin.to - pin.from + 1, 'credence fixture covers every pinned seq; kibble fixture is case-only');
    const c = buildCases(window.map(m => parseMessage(m, room)).filter(p => p.ok).map(p => p.record)).find(c => c.key === attr('case'));
    assert.ok(c);
    assert.equal(c.stages.filter(stage => stage.length).length, 4);
    const valid = c.list.filter(r => r.sigStatus === 'valid').length;
    const noSig = c.list.filter(r => r.sigStatus === 'no_sig').length;
    assert.equal(valid, Number(attr('valid')));
    assert.equal(noSig, Number(attr('no-sig')));
    assert.equal(c.attestation.self, Number(attr('self-attests')));
    assert.equal(c.attestation.other, Number(attr('other-attests')));
    if (valid) assert.ok(body.includes(`has ${valid} records with signatures that verify`));
    else assert.ok(body.includes(`none of its ${noSig} records carries a signature`));
    if(room==='kibble')assert.equal(c.conflicts.length,1);
    if (attr('case') === 'credence:t8a3c1f7e29') {
      assert.ok(c.flags.some(f => f.id === 'requester-posted-work'));
      assert.ok(c.flags.some(f => f.id === 'requester-attested'));
    }
  }
});
