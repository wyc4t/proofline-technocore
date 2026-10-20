#!/usr/bin/env node
// Indicative only (see README): among kibble job IDs whose success line names parts the review can look for,
// how often does no result contain all of them, split by whether a key other than a result's author called it useful?
//   node findings/2026-10-20-kibble-exp-001/indicative.mjs --data <archive-data> --assets <dir with kibble-2026-10-20 files>
import { parseArgs } from 'node:util';
import { check } from '../../archive/check.mjs';
import { classify } from '../../archive/lib/records.mjs';
import { parseMessage } from '../../src/lib/protocol.js';
import { reviewCase, EVIDENCE_VERSION } from '../../src/lib/evidence.js';

const { values: v } = parseArgs({ options: { data: { type: 'string' }, assets: { type: 'string' } } });
const report = check({ data: v.data, assets: v.assets, keepRecords: true });
if (report.problems.length) { console.error(report.problems.join('\n')); process.exit(1); }
const byId = new Map();
for (const m of Object.values(report.records.kibble || {})) for (const p of m.values()) {
  const r = parseMessage({ ...p.rec, sigStatus: classify('kibble', p) }, 'kibble');
  if (r.ok) (byId.get(r.record.id) || byId.set(r.record.id, []).get(r.record.id)).push(r.record);
}
let withParts = 0, attested = 0, attestedNone = 0, other = 0, otherNone = 0;
for (const list of byId.values()) {
  const rv = reviewCase(list);
  if (!rv.available || !rv.requirements.deliverables.length || !rv.results.length) continue;
  withParts++;
  const resultKeys = new Set(list.filter((r) => r.stage === 2).map((r) => r.keyId).filter(Boolean));
  const useful = list.some((r) => r.stage === 3 && r.verdict === 'useful' && r.keyId && !resultKeys.has(r.keyId));
  const anyComplete = rv.results.some((x) => x.parts.every((p) => p.present));
  if (useful) { attested++; if (!anyComplete) attestedNone++; } else { other++; if (!anyComplete) otherNone++; }
}
const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
console.log(`evidence review v${EVIDENCE_VERSION} · kibble job IDs with checkable parts and a result: ${withParts}`);
console.log(`  called useful by another key: ${attested}; no result has every part: ${attestedNone} (${pct(attestedNone, attested)})`);
console.log(`  not called useful by another key: ${other}; no result has every part: ${otherNone} (${pct(otherNone, other)})`);
