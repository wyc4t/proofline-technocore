// Groups protocol records into cases and derives STRUCTURAL observations. Nothing here judges quality, identity or truth.
// A case is scoped to ONE room: the same id in two rooms is two cases.
const STOP = new Set('the a an and or to of in for on with is are was were be by from this that it as at into must should can will about after before'.split(' '));
export const words = (text) => new Set(String(text).toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g)?.filter((w) => !STOP.has(w)) || []);
export const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
export const NEGATIVE = new Set(['not', 'reject', 'invalid']);
const MIN_REUSE_LEN = 12;
const label = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function titleFor(list, id) {
  const r = list.find((x) => x.stage === 0);
  if (r) { const p = r.text.split('|').map((x) => x.trim()); return (p[3] || p[2] || r.text).slice(0, 120); }
  const f = list[0];
  return `${f.kind} · ${f.body || '(no text)'}`.slice(0, 120);
}
// A result "repeats the request" when it has at least 4 distinct terms and >= 90% of them already occur in the request text.
export function repeatsRequest(request, result) {
  if (!request) return false;
  const rt = words(result.body); if (rt.size < 4) return false;
  const qt = words(request.body); let n = 0; for (const w of rt) if (qt.has(w)) n++;
  return n / rt.size >= 0.9;
}
function extractLinks(list, stages) {
  const bySeq = new Map(list.map((r) => [r.seq, r])), links = [], seen = new Set();
  const add = (from, to, type) => { const k = `${from}>${to}>${type}`; if (!seen.has(k)) { seen.add(k); links.push({ from, to, type }); } };
  for (const r of list) for (const m of r.text.matchAll(/\bseq\s+(\d{3,})/gi)) { const to = Number(m[1]); if (to !== r.seq && bySeq.has(to)) add(r.seq, to, 'cites'); }
  for (const w of stages[1]) for (const res of stages[2]) if (w.source === res.source && w.seq < res.seq) add(w.seq, res.seq, 'same-key');
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
    const status = stages.every((s) => s.length) ? 'all-stages' : request ? 'partial' : 'no-request';
    const verdicts = { useful: 0, not: 0, other: 0 };
    for (const a of attests) { if (NEGATIVE.has(a.verdict)) verdicts.not++; else if (a.verdict === 'useful') verdicts.useful++; else verdicts.other++; }
    const requestKeys = new Set(requests.map((r) => r.source)), workerKeys = new Set(workers.map((r) => r.source)), resultKeys = new Set(results.map((r) => r.source));
    const self = attests.filter((a) => resultKeys.has(a.source)).length;
    const attestation = { state: !attests.length ? 'no-attestation' : !results.length ? 'no-result' : 'ok', self, other: attests.length - self };
    const continuity = !workers.length ? 'no-worker' : !results.length ? 'no-result' : results.some((r) => workerKeys.has(r.source)) ? 'observed' : 'not-observed';
    const t = (r) => new Date(r.ts).getTime(), first = results[0], last = results.at(-1);
    const elapsedFirst = request && first ? t(first) - t(request) : null, elapsedLast = request && last ? t(last) - t(request) : null;
    const flags = [];
    const echoes = results.filter((r) => repeatsRequest(request, r));
    if (echoes.length) flags.push({ id: 'repeats-request', label: 'Result text repeats the request', detail: `Nearly all distinct terms in ${label(echoes.length, 'result', 'results')} already appear in the request text.`, seqs: echoes.map((r) => r.seq) });
    const rr = results.map((r) => [r, others(resultReuse, r, key)]).filter(([, n]) => n > 0);
    if (rr.length) flags.push({ id: 'reused-result', label: 'Identical result text in other cases', detail: `Exact same text also appears in ${label(Math.max(...rr.map(([, n]) => n)), 'other case', 'other cases')} in this window.`, seqs: rr.map(([r]) => r.seq) });
    const ra = attests.map((r) => [r, others(attestReuse, r, key)]).filter(([, n]) => n > 0);
    if (ra.length) flags.push({ id: 'reused-attestation', label: 'Identical attestation text in other cases', detail: `Exact same text also appears in ${label(Math.max(...ra.map(([, n]) => n)), 'other case', 'other cases')} in this window.`, seqs: ra.map(([r]) => r.seq) });
    const rw = [...workers, ...results].filter((r) => requestKeys.has(r.source));
    if (rw.length) flags.push({ id: 'requester-posted-work', label: 'Requester key also posted as worker or result', detail: 'The key that posted the request also appears on a claim, accept or result.', seqs: rw.map((r) => r.seq) });
    const ra2 = attests.filter((r) => requestKeys.has(r.source));
    if (ra2.length) flags.push({ id: 'requester-attested', label: 'Requester key also attested', detail: 'The key that posted the request also appears on an attestation.', seqs: ra2.map((r) => r.seq) });
    return { key, id, room, list, stages, status, title: titleFor(list, id), verdicts, negative: verdicts.not > 0, attestation, continuity,
      elapsedFirst, elapsedLast, flags, links: extractLinks(list, stages), workers: workerKeys, resultActors: resultKeys, latest: list.at(-1)?.ts || '' };
  }).sort((a, b) => new Date(b.latest) - new Date(a.latest));
}
