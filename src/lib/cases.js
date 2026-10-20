// Groups protocol records into cases and derives STRUCTURAL observations. Nothing here judges quality, identity or truth.
// A case is scoped to ONE room: the same id in two rooms is two cases.
// "Key" comparisons use only senders that are did:key identities whose signature verified (record.keyId).
// Nicknames and missing senders are never compared as keys.
const STOP = new Set('the a an and or to of in for on with is are was were be by from this that it as at into must should can will about after before'.split(' '));
export const words = (text) => new Set(String(text).toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g)?.filter((w) => !STOP.has(w)) || []);
export const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
export const NEGATIVE = new Set(['not', 'reject', 'invalid']);
const MIN_REUSE_LEN = 12;
const label = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const keySet = (list) => new Set(list.map((r) => r.keyId).filter(Boolean));

export function titleFor(list, id) {
  const r = list.find((x) => x.stage === 0);
  if (r) { const p = r.text.split('|').map((x) => x.trim()); return (p[3] || p[2] || r.text).slice(0, 120); }
  const f = list[0];
  return `${f.kind} · ${f.body || '(no text)'}`.slice(0, 120);
}
// Vocabulary test, not a judgement: at least 4 distinct terms in the result and >= 90% of them already occur in the request text.
// A short answer to "return exactly: a b c d" passes it legitimately, so the flag is worded as vocabulary, never as copying.
export function wordingFromRequest(request, result) {
  if (!request) return false;
  const rt = words(result.body); if (rt.size < 4) return false;
  const qt = words(request.body); let n = 0; for (const w of rt) if (qt.has(w)) n++;
  return n / rt.size >= 0.9;
}
// An attestation's rh: names a result by content hash. It matches results of the same case posted before it.
// Identical result text has an identical hash, so one rh: can match several results; all are kept and counted.
export function attestationTargets(attests, results) {
  return attests.filter((a) => a.rh).map((a) => ({ seq: a.seq, rh: a.rh,
    matches: results.filter((r) => r.resultHash && r.resultHash.startsWith(a.rh) && r.seq < a.seq).map((r) => r.seq) }));
}
function extractLinks(list, stages, targets) {
  const bySeq = new Map(list.map((r) => [r.seq, r])), links = [], seen = new Set();
  const add = (from, to, type) => { const k = `${from}>${to}>${type}`; if (!seen.has(k)) { seen.add(k); links.push({ from, to, type }); } };
  for (const r of list) for (const m of r.text.matchAll(/\bseq\s*#?(\d+)/gi)) { const to = Number(m[1]); if (to !== r.seq && bySeq.has(to)) add(r.seq, to, 'cites'); }
  for (const t of targets) for (const to of t.matches) add(t.seq, to, 'hash');
  for (const w of stages[1]) for (const res of stages[2]) if (w.keyId && w.keyId === res.keyId && w.seq < res.seq) add(w.seq, res.seq, 'same-key');
  return links;
}
function reuseIndex(records, stage) {
  const idx = new Map();
  for (const r of records) if (r.stage === stage && norm(r.body).length >= MIN_REUSE_LEN) { const k = norm(r.body); if (!idx.has(k)) idx.set(k, new Set()); idx.get(k).add(r.caseKey); }
  return idx;
}
export function buildCases(records) {
  const grouped = new Map();
  for (const r of records) { if (!grouped.has(r.caseKey)) grouped.set(r.caseKey, []); grouped.get(r.caseKey).push(r); }
  const resultReuse = reuseIndex(records, 2), attestReuse = reuseIndex(records, 3);
  const others = (idx, r, key) => { const s = idx.get(norm(r.body)); return s && norm(r.body).length >= MIN_REUSE_LEN ? s.size - (s.has(key) ? 1 : 0) : 0; };
  return [...grouped].map(([key, list]) => {
    list.sort((a, b) => a.seq - b.seq); // one room per case, so room-scoped seq is a valid order
    const room = list[0].room, id = list[0].id;
    const stages = [0, 1, 2, 3].map((s) => list.filter((r) => r.stage === s));
    const [requests, workers, results, attests] = stages, request = requests[0];
    const extras = list.filter((r) => r.stage === null);
    const targets = attestationTargets(attests, results);
    // A WITNESS binds the exact job text by hash; it matches when a JOB of this case has that hash.
    const witnesses = extras.filter((r) => r.kind === 'WITNESS').map((w) => ({ seq: w.seq, key: w.keyId, source: w.source,
      matches: requests.some((j) => j.textHash && /^[0-9a-f]{16,64}$/i.test(w.arg) && j.textHash.startsWith(w.arg.toLowerCase())),
      checkable: requests.some((j) => j.textHash) }));
    const disputes = extras.filter((r) => r.kind === 'DISPUTE').map((d) => ({ seq: d.seq, reason: d.arg }));
    const resolutions = extras.filter((r) => r.kind === 'RESOLVE').map((r) => ({ seq: r.seq, outcome: r.arg.toLowerCase() }));
    const status = stages.every((s) => s.length) ? 'all-stages' : request ? 'partial' : 'no-request';
    const verdicts = { useful: 0, not: 0, other: 0 };
    for (const a of attests) { if (NEGATIVE.has(a.verdict)) verdicts.not++; else if (a.verdict === 'useful') verdicts.useful++; else verdicts.other++; }
    const requestKeys = keySet(requests), workerKeys = keySet(workers), resultKeys = keySet(results);
    let attestation;
    // Who attested, relative to this case: the key that posted a result (self), the key that posted the request
    // (requester), any other verified key (other), or a sender whose signature did not verify (unknown).
    if (!attests.length) attestation = { state: 'no-attestation', self: 0, requester: 0, other: 0, unknown: 0 };
    else if (!results.length) attestation = { state: 'no-result', self: 0, requester: 0, other: 0, unknown: 0 };
    else if (!resultKeys.size) attestation = { state: 'no-key', self: 0, requester: 0, other: 0, unknown: attests.length };
    else {
      const self = attests.filter((a) => a.keyId && resultKeys.has(a.keyId)).length, unknown = attests.filter((a) => !a.keyId).length;
      const requester = attests.filter((a) => a.keyId && !resultKeys.has(a.keyId) && requestKeys.has(a.keyId)).length;
      attestation = { state: 'ok', self, requester, other: attests.length - self - requester - unknown, unknown };
    }
    const continuity = !workers.length ? 'no-worker' : !results.length ? 'no-result' : !workerKeys.size || !resultKeys.size ? 'no-key'
      : results.some((r) => r.keyId && workerKeys.has(r.keyId)) ? 'observed' : 'not-observed';
    const t = (r) => new Date(r.ts).getTime(), first = results[0], last = results.at(-1);
    const elapsedFirst = request && first ? t(first) - t(request) : null, elapsedLast = request && last ? t(last) - t(request) : null;
    const flags = [];
    const echoes = results.filter((r) => wordingFromRequest(request, r));
    if (echoes.length) flags.push({ id: 'wording-from-request', label: 'Result wording is almost entirely from the request', detail: `Nearly all distinct terms in ${label(echoes.length, 'result', 'results')} already appear in the request text. A short answer that restates the given words can look like this.`, seqs: echoes.map((r) => r.seq) });
    const rr = results.map((r) => [r, others(resultReuse, r, key)]).filter(([, n]) => n > 0);
    if (rr.length) flags.push({ id: 'reused-result', label: 'Identical result text in other cases', detail: `Exact same text also appears in ${label(Math.max(...rr.map(([, n]) => n)), 'other case', 'other cases')} in this window.`, seqs: rr.map(([r]) => r.seq) });
    const ra = attests.map((r) => [r, others(attestReuse, r, key)]).filter(([, n]) => n > 0);
    if (ra.length) flags.push({ id: 'reused-attestation', label: 'Identical attestation text in other cases', detail: `Exact same text also appears in ${label(Math.max(...ra.map(([, n]) => n)), 'other case', 'other cases')} in this window.`, seqs: ra.map(([r]) => r.seq) });
    const rw = [...workers, ...results].filter((r) => r.keyId && requestKeys.has(r.keyId));
    if (rw.length) flags.push({ id: 'requester-posted-work', label: 'Requester key also posted as worker or result', detail: 'The key that posted the request also appears on a claim, accept or result.', seqs: rw.map((r) => r.seq) });
    // A requester attesting its own job is not a pattern to flag: it is the verdict closest to "this met my need",
    // and is counted under "Who attested". A self-attestation is flagged when no other key attested.
    const sa = attests.filter((r) => r.keyId && resultKeys.has(r.keyId));
    if (sa.length && sa.length === attests.filter((r) => r.keyId).length) flags.push({ id: 'self-attested-only', label: 'Only self-attested', detail: 'Every verified attestation in this case comes from a key that posted a result here: the work judged by its own author.', seqs: sa.map((r) => r.seq) });
    if (disputes.length) flags.unshift({ id: 'disputed', label: 'Disputed', detail: `A DISPUTE record challenges this job (${[...new Set(disputes.map((d) => d.reason))].join(', ')}).${resolutions.length ? ` Resolution recorded: ${resolutions.map((r) => r.outcome).join(', ')}.` : ' No resolution is recorded.'} Both are claims by their keys.`, seqs: [...disputes, ...resolutions].map((d) => d.seq) });
    const links = extractLinks(list, stages, targets);
    // Everything the interface displays for this case, so the view can tell when anything shown has changed (not only the record count).
    const fingerprint = [status, JSON.stringify(verdicts), JSON.stringify(attestation), continuity, elapsedFirst, elapsedLast,
      flags.map((f) => `${f.id}:${f.detail}:${f.seqs.join('.')}`).join(';'), links.map((l) => `${l.from}${l.type[0]}${l.to}`).join(','),
      list.map((r) => `${r.seq}:${r.ts}:${r.source}:${r.sigStatus}:${hash(r.text)}`).join(','),
      JSON.stringify([targets, witnesses, disputes, resolutions])].join('|');
    return { key, id, room, list, stages, status, title: titleFor(list, id), verdicts, negative: verdicts.not > 0, attestation, continuity,
      elapsedFirst, elapsedLast, flags, links, targets, witnesses, disputes, resolutions, disputed: disputes.length > 0, fingerprint, latest: list.at(-1)?.ts || '' };
  }).sort((a, b) => new Date(b.latest) - new Date(a.latest));
}
