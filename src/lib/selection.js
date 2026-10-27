// Keep only the currently selected case beyond the bounded live store. Nothing is persisted.
import { buildCases } from './cases.js';
export function roomEpoch(state) { return `${state?.generation ?? 'unknown'}:${state?.resets ?? 0}`; }
export function retainSelection(previous, currentCases, liveRecords, states) {
  if (!previous) return null;
  const state = states.find((s) => s.room === previous.room);
  const sameEpoch = previous.liveEpoch === roomEpoch(state);
  const current = sameEpoch ? currentCases.find((c) => c.key === previous.key) : null;
  const records = new Map(previous.list.map((r) => [r.seq, r]));
  if (current) for (const r of current.list) records.set(r.seq, r);
  // Include other live cases only for reuse-pattern context, never another epoch of this case.
  const context = liveRecords.filter((r) => r.caseKey !== previous.key);
  const selected = buildCases([...context, ...records.values()]).find((c) => c.key === previous.key);
  const inView = new Set(current?.list.map((r) => r.seq) || []);
  return { ...selected, liveEpoch: previous.liveEpoch, liveGeneration: previous.liveGeneration,
    retained: !sameEpoch || [...records.keys()].some((seq) => !inView.has(seq)), epochChanged: !sameEpoch };
}
