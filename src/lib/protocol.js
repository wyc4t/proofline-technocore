// Parsing of Technocore room messages into protocol records. Pure: no DOM, no network.
export const KINDS = new Set(['TASK', 'ACCEPT', 'SUBMIT', 'VOUCH', 'JOB', 'CLAIM', 'RESULT', 'DELIVER', 'ATTEST']);
export const STAGE = { TASK: 0, JOB: 0, ACCEPT: 1, CLAIM: 1, SUBMIT: 2, RESULT: 2, DELIVER: 2, VOUCH: 3, ATTEST: 3 };
export const STAGE_NAMES = ['REQUEST', 'WORKER', 'RESULT', 'ATTESTATION'];
export const SUPPORTED_VERSION = 'v1';
const ID = /^[\w-]{1,64}$/;

// Returns { ok:true, record } or { ok:false, reason, kind? }.
// reason: 'not-protocol' (ordinary chatter), 'unsupported-version', 'malformed' (looks like protocol, cannot be used).
export function parseMessage(message, room) {
  const text = String(message?.text ?? '');
  const parts = text.split('|').map((x) => x.trim());
  const head = String(parts[0] || '').split(/\s+/);
  const kind = String(head[0] || '').toUpperCase();
  if (!KINDS.has(kind)) return { ok: false, reason: 'not-protocol' };
  if (parts.length < 2) return { ok: false, reason: 'malformed', kind };
  if (head.length !== 2 || head[1] !== SUPPORTED_VERSION) return { ok: false, reason: 'unsupported-version', kind };
  const id = parts[1];
  const seq = Number(message.seq);
  if (!id || !ID.test(id) || !Number.isFinite(seq)) return { ok: false, reason: 'malformed', kind };
  const from = typeof message.from === 'string' ? message.from : '';
  const stage = STAGE[kind];
  // sigStatus is set by checkSignature() before parsing (see signature.js). Only a did:key whose signature
  // verifies counts as a key; anything else (nickname, no signature, failed or unchecked) is never compared as one.
  const isDid = from.startsWith('did:key:');
  const sigStatus = !isDid ? 'unsigned' : typeof message.sigStatus === 'string' ? message.sigStatus : 'unchecked';
  const signed = sigStatus === 'valid';
  // body: free text after the structured fields. Workers' ACCEPT/CLAIM carry none; attestations put a verdict before it.
  const verdict = stage === 3 ? String(parts[2] || '').toLowerCase() : '';
  const body = stage === 1 ? '' : parts.slice(stage === 3 ? 3 : 2).join(' | ');
  // Envelope is not enough: each kind must carry the field it is about (request text, result text, verdict).
  if ((stage === 0 && !String(parts[2] || '')) || (stage === 2 && !body) || (stage === 3 && !verdict)) return { ok: false, reason: 'malformed', kind };
  return {
    ok: true,
    record: {
      kind, id, room, seq, text,
      caseKey: `${room}:${id}`,
      ts: String(message.ts || ''),
      source: from,                 // whatever the sender called itself; '' when absent
      keyId: signed ? from : null,  // only a did:key whose signature verified counts as a key
      signed, sigStatus, stage, verdict, body,
    },
  };
}
