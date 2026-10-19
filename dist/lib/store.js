// Per-room observation state: coverage, gaps, resets, caps and failures. Pure: the caller does the fetching.
import { parseMessage } from './protocol.js';
export const ROOM_CAP = 2000;
export const PAGE_LIMIT = 200;
export function createRoomState(room) {
  return { room, records: new Map(), generation: null, lastSeq: 0, needsFullReload: false, firstTsAll: null, lastTsAll: null,
    evicted: 0, resets: 0, gaps: [], counts: { protocol: 0, malformed: 0, unsupported: 0, ignored: 0 },
    status: 'loading', error: null, lastOkAt: null };
}
// null = fetch the newest PAGE_LIMIT records; a number = records after that seq (server returns the NEWEST page_limit of them).
export function querySince(state) { return state.needsFullReload || !state.lastSeq ? null : state.lastSeq; }
function reset(state) {
  state.records.clear(); state.lastSeq = 0; state.firstTsAll = null; state.lastTsAll = null; state.evicted = 0; state.gaps = [];
  state.counts = { protocol: 0, malformed: 0, unsupported: 0, ignored: 0 }; state.resets++; state.needsFullReload = true;
}
export function applyPage(state, page, { since = null, cap = ROOM_CAP } = {}) {
  const msgs = Array.isArray(page?.messages) ? page.messages : [];
  const seqs = msgs.map((m) => Number(m.seq)).filter(Number.isFinite);
  const gen = page?.generation;
  const regressed = since !== null && Number.isFinite(Number(page?.last_seq)) && Number(page.last_seq) < since;
  if ((state.generation !== null && gen !== undefined && gen !== state.generation) || regressed) reset(state);
  else if (since === null) state.needsFullReload = false;
  if (gen !== undefined) state.generation = gen;
  const wasReload = state.needsFullReload; // true right after a reset: this page is a partial view of the new epoch
  if (!wasReload && since !== null && seqs.length) {
    const first = Math.min(...seqs);
    if (first > since + 1) state.gaps.push({ afterSeq: since, uptoSeq: first - 1, missed: first - since - 1 });
  }
  for (const m of msgs) {
    const seq = Number(m.seq);
    if (Number.isFinite(seq)) state.lastSeq = Math.max(state.lastSeq, seq);
    const ts = String(m.ts || '');
    if (ts) { if (!state.firstTsAll || ts < state.firstTsAll) state.firstTsAll = ts; if (!state.lastTsAll || ts > state.lastTsAll) state.lastTsAll = ts; }
    if (state.records.has(seq)) continue;
    const p = parseMessage(m, state.room);
    if (p.ok) { state.records.set(seq, p.record); state.counts.protocol++; }
    else if (p.reason === 'malformed') state.counts.malformed++;
    else if (p.reason === 'unsupported-version') state.counts.unsupported++;
    else state.counts.ignored++;
  }
  if (state.records.size > cap) {
    const drop = [...state.records.keys()].sort((a, b) => a - b).slice(0, state.records.size - cap);
    for (const k of drop) state.records.delete(k);
    state.evicted += drop.length;
  }
  return state;
}
export function markOk(state, now) { state.status = 'ok'; state.error = null; state.lastOkAt = now; }
export function markError(state, message, now) { state.status = 'error'; state.error = String(message); state.errorAt = now; }
export function coverage(state) {
  const recs = [...state.records.values()];
  const oldest = recs.reduce((m, r) => (m === null || r.ts < m ? r.ts : m), null);
  const windowStart = state.evicted > 0 ? oldest : state.firstTsAll;
  const spanMs = windowStart && state.lastTsAll ? Math.max(0, Date.parse(state.lastTsAll) - Date.parse(windowStart)) : null;
  return { room: state.room, status: state.status, error: state.error, records: recs.length, evicted: state.evicted, resets: state.resets,
    gaps: state.gaps.length, missed: state.gaps.reduce((n, g) => n + g.missed, 0), malformed: state.counts.malformed,
    unsupported: state.counts.unsupported, ignored: state.counts.ignored, windowStart, windowEnd: state.lastTsAll, spanMs, lastOkAt: state.lastOkAt };
}
export function allRecords(states) { return states.flatMap((s) => [...s.records.values()]); }
