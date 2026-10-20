import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import { parseRoomPage, checkSignature, annotateSignatures, signatureSupport } from '../src/lib/signature.js';
import { parseMessage } from '../src/lib/protocol.js';
import { classify, parseLine } from '../archive/lib/records.mjs';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = (buf) => { let n = BigInt('0x' + buf.toString('hex')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } return s; };
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const DID = 'did:key:z' + b58(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url')]));
const signed = (room, nonce, text) => sign(null, Buffer.from(`${room}|${nonce}|${text}`, 'utf8'), privateKey).toString('base64url');
const msg = (over = {}) => {
  const m = { seq: 1, ts: '2026-10-20T08:00:00Z', from: DID, text: 'RESULT v1 | k1 | Việt ✓ done', nonce: '1792480213729123456', ...over };
  if (!('sig' in over)) m.sig = signed('kibble', m.nonce, m.text);
  return m;
};

test('room pages keep 19-digit nonces exactly; plain JSON.parse would round them', () => {
  const text = '{"messages":[{"seq":1,"nonce":1792480213729123456},{"seq":2,"nonce":1787930687977}]}';
  assert.deepEqual(parseRoomPage(text).messages.map((m) => m.nonce), ['1792480213729123456', '1787930687977']);
  assert.notEqual(String(JSON.parse(text).messages[0].nonce), '1792480213729123456');
});

test('valid, invalid, no_sig, unsigned and unchecked', async () => {
  assert.equal(await checkSignature('kibble', msg()), 'valid');
  assert.equal(await checkSignature('credence', msg()), 'invalid', 'the room is part of the signed bytes');
  assert.equal(await checkSignature('kibble', { ...msg(), text: msg().text + '!' }), 'invalid');
  assert.equal(await checkSignature('kibble', { ...msg(), nonce: '1792480213729123457' }), 'invalid');
  assert.equal(await checkSignature('kibble', msg({ sig: undefined })), 'no_sig');
  assert.equal(await checkSignature('kibble', msg({ from: 'nick', sig: undefined })), 'unsigned');
  assert.equal(await checkSignature('kibble', msg({ sig: 'short' })), 'invalid');
  assert.equal(await checkSignature('kibble', { ...msg(), from: 'did:key:z6MkNotAKey' }), 'invalid');
  assert.equal(await checkSignature('kibble', { ...msg(), nonce: null }), 'unchecked', 'digits lost in parsing');
  assert.equal(await checkSignature('kibble', msg(), null), 'unchecked', 'no WebCrypto');
});

test('only a verified signature makes a sender a key', async () => {
  const [good, bad, none] = [msg({ seq: 1 }), { ...msg({ seq: 2 }), text: msg().text + '!' }, msg({ seq: 3, sig: undefined })];
  await annotateSignatures('kibble', [good, bad, none]);
  const keys = [good, bad, none].map((m) => parseMessage(m, 'kibble').record);
  assert.deepEqual(keys.map((r) => r.sigStatus), ['valid', 'invalid', 'no_sig']);
  assert.deepEqual(keys.map((r) => r.keyId), [DID, null, null]);
  assert.equal(parseMessage(msg(), 'kibble').record.keyId, null, 'never checked means never compared');
});

test('the app and the archive classify the same real records identically', async () => {
  for (const [name, room] of [['echo-result-k53fd0a884e', 'kibble'], ['self-assertion-t8a3c1f7e29', 'credence']]) {
    const raw = fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
    const app = parseRoomPage(raw).messages;
    await annotateSignatures(room, app);
    // The archive works on export lines; rebuild each line from the fixture's own text.
    const lines = JSON.parse(raw).messages.map((_, i) => Buffer.from(JSON.stringify({ ...app[i], seq: Number(app[i].seq), sigStatus: undefined }).replace(/"nonce":"(\d+)"/, '"nonce":$1')));
    const archive = lines.map((l) => classify(room, parseLine(l)));
    assert.deepEqual(app.map((m) => m.sigStatus), archive, name);
    assert.ok(app.every((m) => m.sigStatus === (String(m.from).startsWith('did:key:') ? 'valid' : 'unsigned')), `${name}: every real did:key signature verifies; nicknames stay unsigned`);
  }
});

// Last: marks the platform as unsupported for the rest of this module.
test('a platform without Ed25519 leaves everything unchecked instead of failing', async () => {
  const subtle = { importKey: async () => { throw Object.assign(new Error('nope'), { name: 'NotSupportedError' }); }, verify: async () => true };
  assert.equal(await checkSignature('kibble', msg({ from: 'did:key:z6MkfakefakefakefakefakefakefakefakefakefakefakeQ' }), subtle), 'invalid', 'a malformed key fails before the platform is asked');
  const other = generateKeyPairSync('ed25519').publicKey;
  const did2 = 'did:key:z' + b58(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(other.export({ format: 'jwk' }).x, 'base64url')]));
  assert.equal(await checkSignature('kibble', msg({ from: did2, sig: 'A'.repeat(86) }), subtle), 'unchecked');
  assert.equal(signatureSupport(), false);
});
