// Signature checks, following technocore.chat SIGNING: Ed25519 over the UTF-8 bytes of
// `<room>|<nonce>|<text>`, with the key taken from the sender's did:key. Uses WebCrypto, so
// the same code runs in the browser and in Node. Pure apart from a per-key import cache.
//
// Statuses (the archive's archive/lib/records.mjs uses the same four, plus `unchecked`):
//   valid      the signature verifies: this key signed this room, nonce and text
//   invalid    a signature is present and does not verify
//   no_sig     a did:key sender with no signature; upstream says to treat it as
//              "not re-verifiable", not invalid (records from before signatures existed)
//   unsigned   a nickname sender: nothing was claimed, nothing can be checked
//   unchecked  this browser cannot check it (no Ed25519 in WebCrypto, or the nonce's exact
//              digits were lost in parsing)
// seq and ts are assigned by the server and are not signed.

export const SIG_STATUSES = ['valid', 'invalid', 'no_sig', 'unsigned', 'unchecked'];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// Room pages carry nonces of up to 19 digits, past 2^53, which JSON.parse rounds. The reviver
// keeps each nonce as its exact digits where the browser exposes the source text, and as
// null (unchecked) where it does not and the value could have been rounded.
export function parseRoomPage(text) {
  return JSON.parse(text, (key, value, ctx) => {
    if (key !== 'nonce') return value;
    if (ctx && typeof ctx.source === 'string' && /^\d{1,19}$/.test(ctx.source)) return ctx.source;
    if (Number.isSafeInteger(value) && value >= 0) return String(value);
    return typeof value === 'string' && /^\d{1,19}$/.test(value) ? value : null;
  });
}

function base58(s) {
  let n = 0n;
  for (const c of s) {
    const d = B58.indexOf(c);
    if (d < 0) throw new Error('not base58');
    n = n * 58n + BigInt(d);
  }
  let hex = n === 0n ? '' : n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const zeros = s.length - s.replace(/^1+/, '').length;
  const out = new Uint8Array(zeros + hex.length / 2);
  for (let i = 0; i < hex.length / 2; i++) out[zeros + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// did:key:z6Mk... = multibase base58btc of multicodec ed25519-pub (0xed 0x01) + 32-byte key.
export function didKeyBytes(did) {
  if (!did.startsWith('did:key:z')) throw new Error('not a base58btc did:key');
  const raw = base58(did.slice('did:key:z'.length));
  if (raw.length !== 34 || raw[0] !== 0xed || raw[1] !== 0x01) throw new Error('not an Ed25519 did:key');
  return raw.slice(2);
}

const fromBase64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const keyCache = new Map();
let supported = null; // null = not yet known; false once the platform refuses Ed25519

export async function checkSignature(room, m, subtle = globalThis.crypto?.subtle) {
  const from = typeof m?.from === 'string' ? m.from : '';
  if (!from.startsWith('did:key:')) return 'unsigned';
  if (typeof m.sig !== 'string') return 'no_sig';
  if (!/^[A-Za-z0-9_-]{86}$/.test(m.sig) || typeof m.text !== 'string') return 'invalid';
  if (m.nonce === null) return 'unchecked';
  if (typeof m.nonce !== 'string' || !/^\d{1,19}$/.test(m.nonce)) return 'invalid';
  if (!subtle || supported === false) return 'unchecked';
  let bytes;
  try { bytes = didKeyBytes(from); } catch { return 'invalid'; }
  if (!keyCache.has(from)) keyCache.set(from, subtle.importKey('raw', bytes, { name: 'Ed25519' }, false, ['verify']));
  let key;
  try { key = await keyCache.get(from); supported = true; }
  catch (e) {
    if (e?.name === 'NotSupportedError' || e?.name === 'NotImplementedError' || (supported !== true && e instanceof TypeError)) { supported = false; return 'unchecked'; }
    return 'invalid';
  }
  try {
    const data = new TextEncoder().encode(`${room}|${m.nonce}|${m.text}`);
    return (await subtle.verify({ name: 'Ed25519' }, key, fromBase64url(m.sig), data)) ? 'valid' : 'invalid';
  } catch { return 'invalid'; }
}

// Sets message.sigStatus on every message of a page before the page is applied.
export async function annotateSignatures(room, messages, subtle) {
  await Promise.all((messages || []).map(async (m) => { m.sigStatus = await checkSignature(room, m, subtle); }));
  return messages;
}

export const signatureSupport = () => supported;
