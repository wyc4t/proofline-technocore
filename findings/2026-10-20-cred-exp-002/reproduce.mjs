#!/usr/bin/env node
// CRED-EXP-002: run the evidence review on the pre-registered credence cases and compare with labels.json.
//
//   node findings/2026-10-20-cred-exp-002/reproduce.mjs --data <archive-data> [--assets <dir>]
//
// Uses only the evidence archive (integrity and signatures are checked first) and src/lib/evidence.js.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { check } from '../../archive/check.mjs';
import { classify, sha256 } from '../../archive/lib/records.mjs';
import { parseMessage } from '../../src/lib/protocol.js';
import { reviewCase, buildReuseIndex, EVIDENCE_VERSION } from '../../src/lib/evidence.js';

const here = new URL('.', import.meta.url).pathname;
const { values: v } = parseArgs({ options: { data: { type: 'string' }, assets: { type: 'string' }, json: { type: 'boolean' } } });
if (!v.data) { console.error('usage: reproduce.mjs --data <archive-data> [--assets <dir>]'); process.exit(2); }

const report = check({ data: v.data, assets: v.assets, keepRecords: true });
if (report.problems.length) { console.error(report.problems.join('\n')); process.exit(1); }
const recs = [];
for (const m of Object.values(report.records.credence || {})) for (const p of m.values()) {
  const r = parseMessage({ ...p.rec, sigStatus: classify('credence', p) }, 'credence');
  if (r.ok) recs.push(r.record);
}
const byId = new Map();
for (const r of recs) (byId.get(r.id) || byId.set(r.id, []).get(r.id)).push(r);
const index = buildReuseIndex(recs);
const labels = JSON.parse(readFileSync(join(here, 'labels.json'), 'utf8'));
const heldout = JSON.parse(readFileSync(join(here, 'heldout.json'), 'utf8'));

const rows = [];
for (const L of [...labels.cases.map((c) => ({ ...c, set: 'development' })), ...heldout.cases.map((c) => ({ ...c, set: 'held-out' }))]) {
  const list = byId.get(L.case);
  if (!list) { rows.push({ ...L, got: 'not in archive', match: false }); continue; }
  const review = reviewCase(list, { index });
  const resultSeqs = new Set(list.filter((r) => r.stage === 2).map((r) => r.seq));
  const perResult = L.seqs.every((s) => resultSeqs.has(s));
  const got = perResult ? review.results.find((x) => x.seq === L.seqs[0])?.class : review.summary?.class;
  const why = perResult ? review.results.find((x) => x.seq === L.seqs[0])?.reasons.join(' ') : review.summary?.compliance.text;
  rows.push({ set: L.set, case: L.case, seqs: L.seqs, level: perResult ? 'result' : 'case', expected: L.expected, got, match: got === L.expected, why });
}

// Across the whole room: every case with a task.
const dist = { noncompliant: 0, insufficient: 0, supported: 0, none: 0 };
let violatedCases = 0, positiveOnUnsupported = 0, cases = 0;
for (const list of byId.values()) {
  const r = reviewCase(list, { index });
  if (!r.available) continue;
  cases++;
  dist[r.summary.class || 'none']++;
  if (r.summary.compliance.level === 'violated') violatedCases++;
  if (r.positiveAttestations && r.summary.class !== 'supported') positiveOnUnsupported++;
}

const out = {
  experiment: labels.experiment, evidence_version: EVIDENCE_VERSION,
  code: { 'src/lib/evidence.js': sha256(readFileSync(join(here, '../../src/lib/evidence.js'))), 'src/lib/protocol.js': sha256(readFileSync(join(here, '../../src/lib/protocol.js'))) },
  agreement: Object.fromEntries(['development', 'held-out'].map((set) => { const r = rows.filter((x) => x.set === set); return [set, `${r.filter((x) => x.match).length} of ${r.length}`]; })),
  never_verified: rows.every((r) => r.got !== 'verified'),
  rows, room: { cases_with_task: cases, by_class: dist, cases_with_instruction_violated: violatedCases, cases_called_useful_without_supported_result: positiveOnUnsupported },
};
if (v.json) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
console.log(`${out.experiment} · evidence review v${EVIDENCE_VERSION} · evidence.js ${out.code['src/lib/evidence.js'].slice(0, 12)}`);
for (const r of rows) console.log(`${r.match ? 'ok  ' : 'DIFF'} ${r.set.padEnd(11)} ${r.case} ${r.level === 'result' ? '#' + r.seqs[0] : 'case'} expected ${r.expected}, got ${r.got}${r.match ? '' : `: ${r.why}`}`);
console.log(`agreement: development ${out.agreement.development}, held-out ${out.agreement['held-out']} · never reports "verified": ${out.never_verified}`);
console.log(`credence, all cases with a task: ${cases} · noncompliant ${dist.noncompliant} · insufficient ${dist.insufficient} · supported ${dist.supported} · no result ${dist.none}`);
console.log(`instruction violated: ${violatedCases} cases · called useful without a supported result: ${positiveOnUnsupported} cases`);
