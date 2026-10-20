// Parsing of Technocore room messages into protocol records. Pure: no DOM, no network.
export const KINDS = new Set(['TASK', 'ACCEPT', 'SUBMIT', 'VOUCH', 'JOB', 'CLAIM', 'RESULT', 'DELIVER', 'ATTEST', 'WITNESS', 'DISPUTE', 'RESOLVE']);
// Records about a job that are not one of its four stages (kibble-v1): a host countersign of the job text,
// a challenge, and the challenge's resolution. Their third field is the one they are about.
//   WITNESS v1 | <job_id> | <sha256 of the full JOB line, 16 hex>
//   DISPUTE v1 | <job_id> | fake_result|wrong_hash|spam|not_done|policy | <evidence_hash>
//   RESOLVE v1 | <job_id> | upheld|rejected | <reason>
export const EXTRA_KINDS = new Set(['WITNESS', 'DISPUTE', 'RESOLVE']);
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
  const stage = STAGE[kind] ?? null;
  // sigStatus is set by checkSignature() before parsing (see signature.js). Only a did:key whose signature
  // verifies counts as a key; anything else (nickname, no signature, failed or unchecked) is never compared as one.
  const isDid = from.startsWith('did:key:');
  const sigStatus = !isDid ? 'unsigned' : typeof message.sigStatus === 'string' ? message.sigStatus : 'unchecked';
  const signed = sigStatus === 'valid';
  // body: free text after the structured fields. Workers' ACCEPT/CLAIM carry none; attestations put a verdict before it.
  // An attestation may name the exact result it judges by its hash (sha256 of the result text, 16 or 64 hex),
  // either as rh:<hash> in its text or as a bare hash field before the verdict: ATTEST v1 | id | <hash> | useful | ...
  const HASH = /^(?:rh:)?([0-9a-f]{64}|[0-9a-f]{16})$/i;
  // Only when a known verdict follows: otherwise a hex-looking third field stays the verdict.
  const KNOWN_VERDICT = /^(useful|not|not[ _-]?useful|partial(ly useful)?|invalid|valid|rejected?|accepted?)$/i;
  const hashField = stage === 3 && parts.length > 3 && KNOWN_VERDICT.test(String(parts[3] || '').trim()) ? HASH.exec(String(parts[2] || '').trim()) : null;
  const vAt = hashField ? 3 : 2;
  const verdict = stage === 3 ? String(parts[vAt] || '').toLowerCase() : '';
  const arg = stage === null ? String(parts[2] || '') : '';
  const body = stage === 1 ? '' : parts.slice(stage === 3 ? vAt + 1 : 2).join(' | ');
  const rh = stage === 3 ? (hashField ? hashField[1] : ((/\brh:([0-9a-f]{64}|[0-9a-f]{16})\b/i.exec(body) || [])[1] || '')).toLowerCase() || null : null;
  // Envelope is not enough: each kind must carry the field it is about (request text, result text, verdict).
  if ((stage === 0 && !String(parts[2] || '')) || (stage === 2 && !body) || (stage === 3 && !verdict) || (stage === null && !arg)) return { ok: false, reason: 'malformed', kind };
  return {
    ok: true,
    record: {
      kind, id, room, seq, text,
      caseKey: `${room}:${id}`,
      ts: String(message.ts || ''),
      source: from,                 // whatever the sender called itself; '' when absent
      keyId: signed ? from : null,  // only a did:key whose signature verified counts as a key
      signed, sigStatus, stage, verdict, body, arg, rh,
      // Set by annotateContentHashes() (signature.js) when available: sha256 of the full line (jobs, for WITNESS)
      // and of the result text after the job ID (results, for rh:).
      textHash: message.textHash || null, resultHash: message.resultHash || null,
    },
  };
}
