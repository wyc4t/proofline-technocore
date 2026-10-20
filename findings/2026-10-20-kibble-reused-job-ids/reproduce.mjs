#!/usr/bin/env node
// Reproduces every number in README.md from an export bundle (see archive/EXPORT.md).
//   node findings/2026-10-20-kibble-reused-job-ids/reproduce.mjs <bundle dir>
// Reads only the bundle. Fails if the bundle's files do not match its MANIFEST.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const dir = process.argv[2];
if (!dir) { console.error('usage: reproduce.mjs <bundle dir>'); process.exit(2); }
const sha = (b) => createHash('sha256').update(b).digest('hex');
const manifestBytes = readFileSync(join(dir, 'MANIFEST.json'));
const manifest = JSON.parse(manifestBytes);
for (const [name, f] of Object.entries(manifest.files)) {
  if (sha(readFileSync(join(dir, name))) !== f.sha256) { console.error(`${name} does not match MANIFEST.json`); process.exit(1); }
}
const raw = readFileSync(join(dir, 'records.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const cases = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'));
const textBySeq = new Map(raw.map((r) => [r.seq, r.text]));

// Job (request) records, with the title as the fourth |-separated field: JOB v1 | id | category | title | details
const jobs = cases.flatMap((c) => c.records.filter((r) => r.kind === 'JOB').map((r) => ({ ...r, id: c.id, text: textBySeq.get(r.seq) })));
const title = (t) => (t.split('|')[3] || '').trim();
const fromTitle = (j) => j.id === 'k' + sha(title(j.text)).slice(0, 10);

const reused = cases.filter((c) => new Set(c.records.filter((r) => r.kind === 'JOB' && r.key).map((r) => r.key)).size >= 2);
const jobsIn = (c) => c.records.filter((r) => r.kind === 'JOB');
const sum = (f) => reused.reduce((n, c) => n + f(c), 0);
const stageTotal = (i) => cases.reduce((n, c) => n + c.stages[i], 0);
const reqKeys = new Set(reused.flatMap((c) => jobsIn(c).map((r) => r.key)));
const otherJobKeys = new Set(cases.filter((c) => !reused.includes(c)).flatMap((c) => jobsIn(c).map((r) => r.key)));

const out = {
  bundle: sha(manifestBytes),
  window: manifest.window,
  seqs_missing_from_archive: manifest.coverage.seqs_missing_from_archive,
  signatures: manifest.signatures,
  job_records: jobs.length,
  distinct_job_ids: new Set(jobs.map((j) => j.id)).size,
  job_records_with_id_from_title: jobs.filter(fromTitle).length,
  ids_with_jobs_from_2plus_verified_keys: reused.length,
  of_which_id_from_title: reused.filter((c) => jobsIn(c).every((r) => fromTitle({ id: c.id, text: textBySeq.get(r.seq) }))).length,
  of_which_identical_job_text: reused.filter((c) => new Set(jobsIn(c).map((r) => textBySeq.get(r.seq))).size === 1).length,
  verified_keys_per_reused_id: reused.map((c) => new Set(jobsIn(c).map((r) => r.key)).size).sort((a, b) => b - a),
  job_records_under_reused_ids: sum((c) => c.stages[0]),
  worker_records_under_reused_ids: `${sum((c) => c.stages[1])} of ${stageTotal(1)}`,
  result_records_under_reused_ids: `${sum((c) => c.stages[2])} of ${stageTotal(2)}`,
  attestation_records_under_reused_ids: `${sum((c) => c.stages[3])} of ${stageTotal(3)}`,
  distinct_requester_keys_on_reused_ids: reqKeys.size,
  of_which_also_requested_any_other_id: [...reqKeys].filter((k) => otherJobKeys.has(k)).length,
};

// Categories: kibble's published format lists explain|research|review|build|coordinate.
const SPEC = new Set(['explain', 'research', 'review', 'build', 'coordinate']);
const category = (seq) => (textBySeq.get(seq).split('|')[2] || '').trim();
const inSpec = (list) => `${list.filter((r) => SPEC.has(category(r.seq))).length} of ${list.length}`;
out.reused_job_records_using_a_spec_category = inSpec(reused.flatMap(jobsIn));
out.other_job_records_using_a_spec_category = inSpec(cases.filter((c) => !reused.includes(c)).flatMap(jobsIn));

// Open question: IDs with no observed JOB.
const noJob = cases.filter((c) => c.stages[0] === 0);
const start = Date.parse(manifest.window.first_ts);
const late = cases.filter((c) => Date.parse(c.records[0].ts) >= start + 60 * 60e3);
out.ids_without_observed_job = noJob.length;
out.of_which_first_record_is_attest = noJob.filter((c) => c.records[0].kind === 'ATTEST').length;
out.ids_first_seen_60min_plus_into_window = late.length;
out.of_which_without_observed_job = `${late.filter((c) => c.stages[0] === 0).length} (${Math.round(100 * late.filter((c) => c.stages[0] === 0).length / late.length)}%)`;
console.log(JSON.stringify(out, null, 1));
