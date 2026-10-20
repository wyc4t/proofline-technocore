// Reproducible claims: GET requests an agent says it made on technocore.chat, and what it says came back.
//
// parseClaims(text)          -> the claims in a submission, one per "GET <path> ... HTTP <status>" it reports
// checkRequest(target)       -> whether Proofline may re-run that request (strict read-only allowlist)
// compareClaim(claim, obs)   -> per claimed property: reproduced, differs, not comparable, or not run
//
// A reproduced property means Proofline observed the same value itself, at a stated time. It does not mean the
// agent made the request, or that its task was done well: only that this part of what it reported holds.
export const CLAIMS_VERSION = '2'; // 2: mutable status; stale claims not requested; duplicate parameters and long requests refused
export const HOST = 'https://technocore.chat';
export const FRESH_MINUTES = 60;   // state (notes, documents) is compared only for claims at most this old

// --- Parsing --------------------------------------------------------------------------------------

const trimToken = (t) => t.replace(/^[`'"(<]+/, '').replace(/[`'",.;:)>\]]+$/, '');
const pick = (re, s) => { const m = re.exec(s); return m ? m.slice(1).find((x) => x !== undefined) : undefined; };

export function parseClaims(text) {
  const t = String(text || ''), out = [];
  const starts = [...t.matchAll(/\bGET\s+(?=\S)/g)].map((m) => m.index);
  let lastRoomRead = null;
  starts.forEach((at, i) => {
    const seg = t.slice(at, starts[i + 1] ?? t.length);
    let target = trimToken(seg.slice(4).trim().split(/\s+/)[0] || '');
    const status = pick(/\bHTTP(?:\/[\d.]+)?\s*:?\s*(\d{3})\b/, seg) ?? pick(/(?:->|→|returned|returns)\s*(\d{3})\b/, seg);
    if (!status) return;                                   // a mention, or a failed run ("HTTP None"): not a claim
    if (target.startsWith(HOST)) target = target.slice(HOST.length) || '/';
    if (/^limit=\d+/.test(target) && lastRoomRead) {        // "GET limit=201 -> ...": same read, other limit
      const u = new URL(lastRoomRead, HOST); u.searchParams.set('limit', target.match(/^limit=(\d+)/)[1]); target = u.pathname + u.search;
    }
    const props = { status: Number(status) };
    const count = pick(/"count":\s*(\d+)|\bcount\s*[=:]\s*(\d+)|\bmessages=(\d+)/, seg); if (count !== undefined) props.count = Number(count);
    const range = /\brange=(\d+)\.\.(\d+)/.exec(seg); if (range) props.range = `${range[1]}..${range[2]}`;
    const bodySha = pick(/\bbody_sha=([0-9a-f]{6,64})\b/i, seg); if (bodySha) props.bodySha = bodySha.toLowerCase();
    const sha = pick(/\bsha(?:12|256)?=([0-9a-f]{6,64})\b/i, seg); if (sha) props.sha = sha.toLowerCase();
    const bytes = pick(/\bbytes=(\d+)\b|\b(\d+) bytes\b/, seg); if (bytes !== undefined) props.bytes = Number(bytes);
    const cc = pick(/Cache-Control\s*[=:]\s*'([^']+)'|Cache-Control\s*[=:]\s*"([^"]+)"/i, seg); if (cc) props.cacheControl = cc.trim();
    const body = pick(/\bbody\s*=\s*'([^']{0,200})'|\bbody\s*=\s*"([^"]{0,200})"|\bbody\s*=\s*([^\s,;'"{]+)/, seg); if (body !== undefined && !/^\s*[{[]/.test(body)) props.body = body.replace(/\.$/, '');
    const asof = pick(/\basof=(\d{4}-\d\d-\d\dT[\d:]+Z)/, seg); if (asof) props.asof = asof;
    const asOf = pick(/\bAs of (\d{4}-\d\d-\d\dT[\d:]+Z)/, seg); if (asOf) props.asOf = asOf;
    const fp = pick(/\bfingerprint\b[^0-9a-f]{0,30}([0-9a-f]{16})\b/i, seg); if (fp) props.fingerprint = fp.toLowerCase();
    out.push({ target, props });
    if (/^\/r\/[^/?]+(\?|$)/.test(target)) lastRoomRead = target;
  });
  return out;
}

// --- What Proofline may request ---------------------------------------------------------------------

const ROOM = '[a-z0-9][a-z0-9_-]{0,47}';
const PATHS = [
  { re: /^\/healthz$/, kind: 'healthz' },
  { re: /^\/llms\.txt$/, kind: 'doc' },
  { re: /^\/openapi\.json$/, kind: 'doc' },
  { re: /^\/\.well-known\/agent\.json$/, kind: 'doc' },
  { re: /^\/config$/, kind: 'doc' },
  { re: /^\/rooms$/, kind: 'rooms', params: ['format', 'limit'] },
  { re: new RegExp(`^/r/${ROOM}$`), kind: 'room', params: ['format', 'limit', 'since'] },
  { re: /^\/kv\/[A-Za-z0-9._-]{1,64}\/[A-Za-z0-9._:-]{1,128}$/, kind: 'note' },
];
const WRITES = /\/(say|say-signed|set|set-signed)(\/|$)|\/hb-/i;

export function checkRequest(target) {
  const t = String(target || '');
  if (t.length > 512) return { ok: false, reason: 'request too long' };
  if (WRITES.test(t)) return { ok: false, reason: 'writes: Proofline never requests a write path' };
  if (!t.startsWith('/')) return { ok: false, reason: 'incomplete request' };
  if (/%2e|%2f|%5c|\.\.|\/\.\/|\/\//i.test(t)) return { ok: false, reason: 'encoded or traversal path' };
  let u;
  try { u = new URL(t, HOST); } catch { return { ok: false, reason: 'unparseable request' }; }
  if (u.origin !== HOST) return { ok: false, reason: 'not technocore.chat' };
  const p = PATHS.find((x) => x.re.test(u.pathname));
  if (!p) return { ok: false, reason: 'path not on the read-only allowlist' };
  const q = new URLSearchParams();
  const seen = new Set();
  for (const [k, v] of u.searchParams) {
    if (seen.has(k)) return { ok: false, reason: `duplicate parameter ${k}` };
    seen.add(k);
    if (k === 'n') continue;                                                   // a client's cache-buster
    if (k === 'wait') return { ok: false, reason: 'long-poll (wait) not allowed' };
    if (!(p.params || []).includes(k)) return { ok: false, reason: `parameter ${k} not allowed` };
    if (k === 'format' && v !== 'json') return { ok: false, reason: 'only format=json' };
    if ((k === 'limit' || k === 'since') && !/^\d{1,9}$/.test(v)) return { ok: false, reason: `${k} must be a number` };
    if (k === 'limit' && Number(v) > 1000) return { ok: false, reason: 'limit above 1000' };
    q.set(k, v);
  }
  const qs = q.toString();
  return { ok: true, kind: p.kind, path: u.pathname, url: `${HOST}${u.pathname}${qs ? `?${qs}` : ''}` };
}

// --- Comparing -------------------------------------------------------------------------------------

// stable: should hold on a running server at any time; state: changes over time (compared only when fresh);
// continuous: changes from second to second (a room read's range or hash), never comparable;
// mutable: the status of a note or room, which can be created or removed: the same status later is informative,
// a different one is not, unless the claim is fresh.
export function propertyKind(name, kind) {
  if (name === 'status' && (kind === 'note' || kind === 'room' || kind === 'rooms')) return 'mutable';
  if (name === 'status' || name === 'cacheControl') return 'stable';
  if (kind === 'healthz') return 'stable';
  if (kind === 'room') return name === 'count' ? 'stable' : 'continuous';
  if (kind === 'rooms') return 'continuous';
  return 'state';
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

function observedValue(name, obs) {
  switch (name) {
    case 'status': return obs.status;
    case 'count': return obs.count;
    case 'bytes': return obs.bytes;
    case 'cacheControl': return obs.headers?.['cache-control'];
    case 'body': return obs.body_text;
    case 'sha': case 'bodySha': return obs.sha256;
    case 'asof': return obs.asof;
    case 'asOf': return obs.as_of;
    case 'fingerprint': return obs.fingerprints;
    case 'range': return obs.first_seq != null ? `${obs.first_seq}..${obs.last_seq}` : undefined;
    default: return undefined;
  }
}

function same(name, claimed, observed) {
  if (observed === undefined || observed === null) return null;
  if (name === 'sha' || name === 'bodySha') return String(observed).startsWith(String(claimed));
  if (name === 'fingerprint') return Array.isArray(observed) && observed.includes(claimed);
  if (name === 'body') return norm(claimed).replace(/\.$/, '') === norm(observed);
  if (name === 'cacheControl') return norm(claimed) === norm(observed);
  return String(claimed) === String(observed);
}

const fmtAge = (m) => (m >= 2880 ? `${Math.round(m / 1440)} days` : m >= 120 ? `${Math.round(m / 60)} hours` : `${Math.round(m)} minutes`);

// Whether re-running a claim of this age could show anything: a stable property, or anything else while fresh.
export function worthRequesting(claim, ageMin) {
  const check = checkRequest(claim.target);
  if (!check.ok) return false;
  const fresh = ageMin !== null && ageMin !== undefined && ageMin <= FRESH_MINUTES;
  return Object.keys(claim.props).some((name) => { const k = propertyKind(name, check.kind); return k === 'stable' || (fresh && k !== 'continuous'); });
}

// obs: an observation from archive/reproduce.mjs, or null when the request was not run.
export function compareClaim(claim, obs, { claimedAt, observedAt, notRequested } = {}) {
  const check = checkRequest(claim.target);
  const ageMin = claimedAt && observedAt ? (Date.parse(observedAt) - Date.parse(claimedAt)) / 60e3 : null;
  return Object.entries(claim.props).map(([name, claimed]) => {
    const kind = check.ok ? propertyKind(name, check.kind) : null;
    if (!check.ok) return { name, claimed, outcome: 'not run', note: check.reason };
    if (!obs && notRequested === 'stale') return { name, claimed, kind, outcome: 'not comparable', note: `the claim is ${fmtAge(ageMin)} old: nothing in it can be compared at that age, so it was not requested (stale)` };
    if (!obs) return { name, claimed, kind, outcome: 'not run', note: notRequested === 'budget' ? 'request budget exhausted' : 'not requested in this run' };
    if (obs.error) return { name, claimed, kind, outcome: 'not comparable', note: `the request failed: ${obs.error}` };
    const observed = observedValue(name, obs), shown = name === 'fingerprint' ? (same(name, claimed, observed) ? claimed : 'not in the note') : name === 'sha' || name === 'bodySha' ? obs.sha256?.slice(0, 12) : observed;
    if (kind === 'continuous') return { name, claimed, observed: shown, kind, outcome: 'not comparable', note: 'changes from moment to moment' };
    if (kind === 'state' && (ageMin === null || ageMin > FRESH_MINUTES)) return { name, claimed, observed: shown, kind, outcome: 'not comparable', note: ageMin === null ? 'claim time unknown' : `changes over time; the claim is ${fmtAge(ageMin)} old` };
    const eq = same(name, claimed, observed);
    if (kind === 'mutable' && eq === false && (ageMin === null || ageMin > FRESH_MINUTES)) return { name, claimed, observed: shown, kind, outcome: 'not comparable', note: 'the note or room may have been created, changed or removed since the claim' };
    if (eq === null) return { name, claimed, kind, outcome: 'not comparable', note: 'not present in the response' };
    if (eq) return { name, claimed, observed: shown, kind, outcome: 'reproduced' };
    return { name, claimed, observed: shown, kind, outcome: 'differs', note: kind === 'stable' && ageMin !== null && ageMin > 1440 ? 'the server or its configuration may have changed since the claim' : undefined };
  });
}
