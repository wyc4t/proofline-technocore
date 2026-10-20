// Evidence archive: raw record handling and signature verification.
// Node 22, no dependencies. Works on the exact bytes of a Technocore room export.
import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

export const VERIFIER_VERSION = '1';
const NL = 0x0a;

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Parse one JSONL line. Integers past 2^53 lose precision in JSON.parse, and upstream
// stores nonces of up to 19 digits, so the nonce is kept as its exact source digits.
export function parseLine(raw) {
  let nonceDigits = null;
  const rec = JSON.parse(raw.toString('utf8'), (key, value, ctx) => {
    if (key === 'nonce' && ctx && typeof ctx.source === 'string') nonceDigits = ctx.source;
    return value;
  });
  if (!rec || typeof rec !== 'object' || !Number.isSafeInteger(rec.seq)) throw new Error('record without a usable seq');
  return { rec, nonceDigits };
}

// Split an export body into complete lines. Upstream cuts an export back to the last
// complete line; a body that still ends mid-line has that tail reported, never stored.
export function splitExport(body) {
  const lines = [];
  const unparseable = [];
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== NL) continue;
    if (i > start) lines.push(body.subarray(start, i));
    start = i + 1;
  }
  const partialTail = start < body.length ? body.length - start : 0;
  const parsed = [];
  for (const raw of lines) {
    try { parsed.push({ raw, ...parseLine(raw) }); }
    catch { unparseable.push(sha256(raw)); }
  }
  return { parsed, unparseable, partialTail };
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(s) {
  let n = 0n;
  for (const c of s) {
    const d = B58.indexOf(c);
    if (d < 0) throw new Error('not base58');
    n = n * 58n + BigInt(d);
  }
  const hex = n === 0n ? '' : n.toString(16);
  const bytes = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  const zeros = s.length - s.replace(/^1+/, '').length;
  return Buffer.concat([Buffer.alloc(zeros), bytes]);
}

const keyCache = new Map();
// did:key:z6Mk... = multibase base58btc of multicodec ed25519-pub (0xed 0x01) + 32-byte key.
export function didKey(did) {
  if (keyCache.has(did)) return keyCache.get(did);
  if (!did.startsWith('did:key:z')) throw new Error('not a base58btc did:key');
  const raw = base58(did.slice('did:key:z'.length));
  if (raw.length !== 34 || raw[0] !== 0xed || raw[1] !== 0x01) throw new Error('not an Ed25519 did:key');
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.subarray(2).toString('base64url') }, format: 'jwk' });
  keyCache.set(did, key);
  return key;
}

// Statuses, following upstream's SIGNING and RENDERING sections:
//  valid      - sig present and verifies over `<room>|<nonce>|<text>`
//  invalid    - sig present and does not verify (or cannot be decoded)
//  no_sig     - writer is a did:key but the record has no sig. Upstream: records written
//               before `sig` existed lack it; treat as "not re-verifiable", not as invalid
//  unsigned   - nickname writer; nothing was claimed, nothing can be checked
// A valid signature binds room, nonce and text to a key. seq and ts are assigned by the
// server and are not signed.
export function classify(room, { rec, nonceDigits }) {
  const from = typeof rec.from === 'string' ? rec.from : '';
  if (!from.startsWith('did:key:')) return 'unsigned';
  if (typeof rec.sig !== 'string') return 'no_sig';
  try {
    if (!/^[A-Za-z0-9_-]{86}$/.test(rec.sig) || !/^\d{1,19}$/.test(nonceDigits || '') || typeof rec.text !== 'string') return 'invalid';
    const msg = Buffer.from(`${room}|${nonceDigits}|${rec.text}`, 'utf8');
    return edVerify(null, msg, didKey(from), Buffer.from(rec.sig, 'base64url')) ? 'valid' : 'invalid';
  } catch { return 'invalid'; }
}

export function readSegment(path) {
  const buf = readFileSync(path);
  return path.endsWith('.gz') ? gunzipSync(buf) : buf;
}
