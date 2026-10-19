// Groups protocol records into cases. A case is scoped to ONE room: the same id in two rooms is two cases.
const STOP = new Set('the a an and or to of in for on with is are was were be by from this that it as at into must should can will about after before'.split(' '));
export function words(text) { return new Set(String(text).toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g)?.filter((w) => !STOP.has(w)) || []); }
export function overlap(a, b) { const aa = words(a), bb = words(b); if (!aa.size || !bb.size) return null; let c = 0; for (const w of aa) if (bb.has(w)) c++; return c / Math.min(aa.size, bb.size); }
export function titleFor(list, id) { const r = list.find((x) => x.stage === 0); if (!r) return `Unresolved reference ${id}`; const p = r.text.split('|').map((x) => x.trim()); return (p[3] || p[2] || r.text).slice(0, 120); }
const RANK = { disputed: 0, complete: 1, partial: 2, orphan: 3 };
export function buildCases(records) {
  const grouped = new Map();
  for (const r of records) { if (!grouped.has(r.caseKey)) grouped.set(r.caseKey, []); grouped.get(r.caseKey).push(r); }
  return [...grouped].map(([key, list]) => {
    list.sort((a, b) => a.seq - b.seq); // one room per case, so room-scoped seq is a valid order
    const room = list[0].room, id = list[0].id;
    const stages = [0, 1, 2, 3].map((s) => list.filter((r) => r.stage === s));
    const request = stages[0][0], result = stages[2][0], attest = stages[3];
    const workers = new Set(stages[1].map((r) => r.source)), resultActors = new Set(stages[2].map((r) => r.source));
    const negative = attest.some((r) => /\|\s*(not|reject|invalid)\s*\|/i.test(r.text));
    const semantic = request && result ? overlap(request.text, result.text) : null;
    const complete = stages.every((s) => s.length > 0);
    const status = negative ? 'disputed' : complete ? 'complete' : request ? 'partial' : 'orphan';
    const elapsed = request && result ? new Date(result.ts) - new Date(request.ts) : null;
    const independent = attest.length ? attest.some((a) => !resultActors.has(a.source)) : null;
    return { key, id, room, list, stages, status, title: titleFor(list, id), negative, semantic, elapsed, independent, workers, resultActors, latest: list.at(-1)?.ts || '' };
  }).sort((a, b) => RANK[a.status] - RANK[b.status] || new Date(b.latest) - new Date(a.latest));
}
