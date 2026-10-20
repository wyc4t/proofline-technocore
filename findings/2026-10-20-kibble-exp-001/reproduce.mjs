#!/usr/bin/env node
// KIBBLE-EXP-001: the evidence review's required-parts check on kibble, against hand labels.
//   node findings/2026-10-20-kibble-exp-001/reproduce.mjs --data <archive-data> --assets <dir with kibble-2026-10-20 files>
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { check } from '../../archive/check.mjs';
import { classify, sha256 } from '../../archive/lib/records.mjs';
import { parseMessage } from '../../src/lib/protocol.js';
import { reviewCase, EVIDENCE_VERSION } from '../../src/lib/evidence.js';

const here = new URL('.', import.meta.url).pathname;
const { values: v } = parseArgs({ options: { data: { type: 'string' }, assets: { type: 'string' }, json: { type: 'boolean' } } });
const report = check({ data: v.data, assets: v.assets, keepRecords: true });
if (report.problems.length) { console.error(report.problems.join('\n')); process.exit(1); }
const byId = new Map();
for (const m of Object.values(report.records.kibble || {})) for (const p of m.values()) {
  const r = parseMessage({ ...p.rec, sigStatus: classify('kibble', p) }, 'kibble');
  if (r.ok) (byId.get(r.record.id) || byId.set(r.record.id, []).get(r.record.id)).push(r.record);
}
const sets = [['development', 'labels.json'], ['held-out', 'heldout.json']].filter(([, f]) => existsSync(join(here, f)));
const out = { experiment: 'KIBBLE-EXP-001', evidence_version: EVIDENCE_VERSION, code: { 'src/lib/evidence.js': sha256(readFileSync(join(here, '../../src/lib/evidence.js'))) }, sets: {} };
for (const [set, file] of sets) {
  const labels = JSON.parse(readFileSync(join(here, file), 'utf8'));
  const m = { asked: 0, asked_required: 0, required_missed: 0, presence: { both_present: 0, both_missing: 0, false_present: 0, false_missing: 0 } }, rows = [];
  for (const L of labels.cases) {
    const list = byId.get(L.case); if (!list) { rows.push(`MISSING ${L.case}`); continue; }
    const job = list.find((r) => r.stage === 0);
    const res = reviewCase(list.filter((r) => r.stage !== 2 || r.seq === L.seq)).results.find((x) => x.seq === L.seq);
    const got = Object.fromEntries((res?.parts || []).map((p) => [p.id, p.present]));
    for (const [id, lab] of Object.entries(L.parts)) {
      const asked = id in got;
      if (asked) { m.asked++; if (lab.required) m.asked_required++; }
      if (lab.required && !asked) { m.required_missed++; rows.push(`not asked  ${L.case} ${id} (required)`); continue; }
      if (!lab.required) { if (asked) rows.push(`asked, not required  ${L.case} ${id}: ${L.why}`); continue; }
      const k = got[id] === lab.present ? (lab.present ? 'both_present' : 'both_missing') : got[id] ? 'false_present' : 'false_missing';
      m.presence[k]++; if (k.startsWith('false')) rows.push(`${k}  ${L.case} ${id}: ${L.why}`);
    }
    for (const id of Object.keys(got)) if (!(id in L.parts)) { m.asked++; rows.push(`asked, unlabelled  ${L.case} ${id}`); }
  }
  out.sets[set] = { cases: labels.cases.length, ...m, rows };
}
if (v.json) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
console.log(`${out.experiment} · evidence review v${EVIDENCE_VERSION} · evidence.js ${out.code['src/lib/evidence.js'].slice(0, 12)}`);
for (const [set, s] of Object.entries(out.sets)) {
  const p = s.presence, judged = p.both_present + p.both_missing + p.false_present + p.false_missing;
  console.log(`\n${set}: ${s.cases} cases · parts asked ${s.asked}, really required ${s.asked_required} · required but not asked ${s.required_missed}`);
  console.log(`  presence on required parts: ${p.both_present + p.both_missing} of ${judged} right · false present ${p.false_present} · false missing ${p.false_missing}`);
  for (const r of s.rows) console.log('  ' + r);
}
