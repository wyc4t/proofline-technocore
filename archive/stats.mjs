#!/usr/bin/env node
// Rolling statistics over the evidence archive, for the headline panel on the site.
//
//   node archive/stats.mjs --data <archive-data> [--assets <dir>] [--hours 24] [--out stats.json]
//
// Every number is computed from archived records whose signatures were re-verified, over a
// half-open window [start, end), and says whether the archive covers that window without gaps. Jobs are
// counted per room and job ID, as the app does. Outcome rates only count jobs posted at
// least OUTCOME_GRACE_MIN minutes before the window's end, so recent jobs are not counted
// as unanswered merely because they are recent.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { check } from './check.mjs';
import { classify, sha256, VERIFIER_VERSION } from './lib/records.mjs';
import { parseMessage } from '../src/lib/protocol.js';
import {roomPopulation} from '../src/lib/population.js';
import {splitArchiveGroup} from '../src/lib/archive-epoch.js';
import { NEGATIVE,describeAttestations,conflictingVerdicts } from '../src/lib/cases.js';

export const STATS_VERSION = '5'; // 5: storage epochs isolate reused sequence numbers and job IDs
export const OUTCOME_GRACE_MIN = 30;
const here = new URL('.', import.meta.url).pathname;
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
// Loops, not Math.min(...array): a day of records is far past the engine's argument limit.
const minOf = (xs) => { let m = Infinity; for (const x of xs) if (x < m) m = x; return m; };
const maxOf = (xs) => { let m = -Infinity; for (const x of xs) if (x > m) m = x; return m; };

export function roomStats(room, entries, { fromMs, toMs, gaps = [], unavailable = 0 }) {
  // entries: [{ rec, nonceDigits, raw, gen }] for this room, already verified by check(). Jobs are grouped by
  // generation and ID: sequence numbers and IDs restart with a new generation, so they are never joined across one.
  const inWindow = entries.filter((p) => { const t = Date.parse(p.rec.ts); return t >= fromMs && t < toMs; });
  const sig = { valid: 0, invalid: 0, no_sig: 0, unsigned: 0 };
  const recs = [];
  for (const p of inWindow) {
    const st = classify(room, p);
    sig[st]++;
    const r = parseMessage({ ...p.rec, sigStatus: st }, room);
    if (r.ok) recs.push({ ...r.record, resultHash:r.record.stage===2?sha256(r.record.body):null, gen: String(p.gen ?? '0'), storage_epoch:p.storage_epoch??0 });
  }
  const byId = new Map();
  for (const r of recs) { const k = `${r.gen}:${r.storage_epoch}:${r.id}`; (byId.get(k) || byId.set(k, []).get(k)).push(r); }
  const jobs = recs.filter((r) => r.stage === 0);
  const requesters = new Set(jobs.map((r) => r.keyId).filter(Boolean));
  const active = new Set(recs.map((r) => r.keyId).filter(Boolean));
  let repostedIds = 0, repostedJobRecords = 0;
  const cutoff = toMs - OUTCOME_GRACE_MIN * 60e3;
  const o = { basis_ids: 0, with_claim: 0, with_result: 0, with_attestation: 0, with_useful_attestation: 0, with_useful_non_result_key_attestation: 0 };
  const firstResult = [];
  const conflicts={cases:0,result_text_groups:0};
  for (const list of byId.values()) {
    const groups=conflictingVerdicts(describeAttestations(list.filter(r=>r.stage===3),list.filter(r=>r.stage===2)));
    if(groups.length){conflicts.cases++;conflicts.result_text_groups+=groups.length}
    const js = list.filter((r) => r.stage === 0);
    if (!js.length) continue;
    // Reposted: identical JOB text under one ID from two or more verified keys.
    const byText = new Map();
    for (const r of js) (byText.get(r.text) || byText.set(r.text, []).get(r.text)).push(r);
    const reposted = [...byText.values()].filter((g) => new Set(g.map((r) => r.keyId).filter(Boolean)).size >= 2);
    if (reposted.length) { repostedIds++; repostedJobRecords += reposted.reduce((n, g) => n + g.length, 0); }
    const t0 = minOf(js.map((r) => Date.parse(r.ts)));
    if (t0 > cutoff) continue;
    o.basis_ids++;
    const after = (stage) => list.filter((r) => r.stage === stage && Date.parse(r.ts) >= t0);
    const results = after(2), attests = after(3);
    if (after(1).length) o.with_claim++;
    if (results.length) { o.with_result++; firstResult.push((minOf(results.map((r) => Date.parse(r.ts))) - t0) / 1000); }
    if (attests.length) o.with_attestation++;
    if (attests.some((a) => a.verdict === 'useful')) o.with_useful_attestation++;
    // Compare against ALL result keys in this job's window, including results after the verdict.
    // Only signature-checked keys can qualify. This is a key-role comparison, not independence.
    const resultKeys = new Set(list.filter((r) => r.stage === 2).map((r) => r.keyId).filter(Boolean));
    if (attests.some((a) => a.verdict === 'useful' && a.keyId && !resultKeys.has(a.keyId))) o.with_useful_non_result_key_attestation++;
  }
  const attests = recs.filter((r) => r.stage === 3);
  const ts = inWindow.map((p) => Date.parse(p.rec.ts));
  const first = ts.length ? minOf(ts) : null, last = ts.length ? maxOf(ts) : null;
  return {
    from_ts: first ? new Date(first).toISOString() : null,
    to_ts: last ? new Date(last).toISOString() : null,
    span_minutes: first ? Math.round((last - first) / 60e3) : 0,
    complete: !gaps.length && !unavailable,
    gaps, unavailable_captures: unavailable,
    records: inWindow.length, protocol_records: recs.length, signatures: sig,
    jobs: {
      records: jobs.length, ids: new Set(jobs.map((r) => `${r.gen}:${r.storage_epoch}:${r.id}`)).size, requester_keys: requesters.size,
      reposted_ids: repostedIds, reposted_job_records: repostedJobRecords, reposted_share_pct: pct(repostedJobRecords, jobs.length),
    },
    outcomes: {
      ...o, posted_before: new Date(cutoff).toISOString(),
      with_claim_pct: pct(o.with_claim, o.basis_ids), with_result_pct: pct(o.with_result, o.basis_ids),
      with_attestation_pct: pct(o.with_attestation, o.basis_ids), with_useful_attestation_pct: pct(o.with_useful_attestation, o.basis_ids),
      with_useful_non_result_key_attestation_pct: pct(o.with_useful_non_result_key_attestation, o.basis_ids),
      median_first_result_seconds: median(firstResult),
    },
    attestations: { records: attests.length, negative: attests.filter((a) => NEGATIVE.has(a.verdict)).length },
    conflicts,population:roomPopulation(recs),
    active_keys: active.size,
    ids_without_job: [...byId.values()].filter((l) => !l.some((r) => r.stage === 0)).length,
  };
}

// window: { fromMs, toMs } for a fixed period (a UTC day); otherwise the last `hours` up to the last capture.
export function computeStats({ data, assets, hours = 24, rooms = ['kibble', 'credence'], now = Date.now(), window = null }) {
  const report = check({ data, assets, keepRecords: true });
  if (report.problems.length) throw new Error(`archive integrity problems:\n  ${report.problems.join('\n  ')}`);
  const out = { format: 'proofline-stats', stats_version: STATS_VERSION, generated_at: new Date(now).toISOString(), window_hours: hours, rooms: {},
    code: { verifier_version: VERIFIER_VERSION, 'src/lib/protocol.js': sha256(readFileSync(join(here, '../src/lib/protocol.js'))), 'archive/stats.mjs': sha256(readFileSync(join(here, 'stats.mjs'))), 'src/lib/cases.js':sha256(readFileSync(join(here,'../src/lib/cases.js'))), 'src/lib/population.js':sha256(readFileSync(join(here,'../src/lib/population.js'))), 'src/lib/archive-epoch.js':sha256(readFileSync(join(here,'../src/lib/archive-epoch.js'))) },
    notes: [
      'Counts are per room and job ID, over archived records whose signatures were re-verified, in the half-open window [start, end).',
      `Outcome rates count jobs posted at least ${OUTCOME_GRACE_MIN} minutes before the window ends.`,
      'A reposted ID is a job ID under which two or more verified keys posted identical JOB text.',
      'Jobs are grouped by room generation, storage epoch and job ID.',
      'Storage epochs separate observed counter regressions or conflicting checkpoint bytes; they do not prove an upstream reset cause or distinct real-world tasks.',
      'Useful verdict rates share the eligible job-ID basis; the narrower rate requires a verified attester key with no result record in that job in this window. Different keys do not prove independent parties; verdicts need not name a result.',
      'Conflict cases count observed generation/ID groups with opposite verdicts targeting the same result text by hash, including cases whose request is absent. Text frequencies count records, ignoring case and whitespace, within this room/window.',
      'These describe records, not whether any work was correct or useful.',
    ] };
  for (const room of rooms) {
    const gens = report.records[room] || {};
    const lastCapture = Object.values(report.rooms[room] || {}).map((g) => Date.parse(g.unknown.after_last_successful_capture || 0)).reduce((a, b) => Math.max(a, b), 0);
    const toMs = window ? window.toMs : (lastCapture || now), fromMs = window ? window.fromMs : toMs - hours * 3600e3;
    const entries = Object.entries(gens).flatMap(([g, m]) => [...m.values()].map((p) => ({ ...p, gen: splitArchiveGroup(g).generation, storage_epoch:splitArchiveGroup(g).storage_epoch })));
    // A known gap can only be ruled out of the window if it lies entirely before an archived record dated before
    // the window: seq and ts both increase, so everything below that record is older. Any later gap may hold
    // records from inside the window, and makes the window incomplete.
    const gaps = [], unavailable = [];
    let anyBefore = false; // an archived record dated before the window: the archive reaches back past its start
    for (const [g, info] of Object.entries(report.rooms[room] || {})) {
      let before = -Infinity;
      for (const p of (gens[g] || new Map()).values()) if (Date.parse(p.rec.ts) < fromMs && p.rec.seq > before) before = p.rec.seq;
      if (before > -Infinity) anyBefore = true;
      for (const x of info.known_gaps) if (x.to > before) gaps.push({ generation: splitArchiveGroup(g).generation, storage_epoch:splitArchiveGroup(g).storage_epoch, from: x.from, to: x.to });
      for (const u of info.unknown.not_available_to_this_check) if (u.to > before) unavailable.push(u);
    }
    out.rooms[room] = { ...roomStats(room, entries, { fromMs, toMs, gaps, unavailable: unavailable.length }),
      window_start: new Date(fromMs).toISOString(), window_end: new Date(toMs).toISOString(),
      last_capture: lastCapture ? new Date(lastCapture).toISOString() : null,
      // Whether the archive reaches the window's start and end. "complete" covers gaps inside what was captured;
      // these say whether the window itself was fully captured.
      covers_window_start: anyBefore, covers_window_end: lastCapture >= toMs };
  }
  return out;
}

// Release files for a fixed window: captures made during it, or within two hours after it ends.
export function neededAssetsBetween(capturesText, fromMs, toMs) {
  const out = new Set();
  for (const l of capturesText.split('\n')) {
    if (!l.trim()) continue;
    const c = JSON.parse(l), t = Date.parse(c.captured_at);
    if (c.ok && c.storage?.kind === 'release' && t >= fromMs && t <= toMs + 2 * 3600e3) out.add(`${c.storage.tag}\t${c.storage.asset}`);
  }
  return [...out];
}

// Release files a stats run needs: kibble captures made since the window began (plus margin).
export function neededAssets(capturesText, hours = 24, now = Date.now()) {
  const since = now - (hours + 2) * 3600e3;
  const out = [];
  for (const l of capturesText.split('\n')) {
    if (!l.trim()) continue;
    const c = JSON.parse(l);
    if (c.ok && c.storage?.kind === 'release' && Date.parse(c.captured_at) >= since) out.push(`${c.storage.tag}\t${c.storage.asset}`);
  }
  return [...new Set(out)];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: v } = parseArgs({ options: { data: { type: 'string' }, assets: { type: 'string' }, hours: { type: 'string', default: '24' }, out: { type: 'string' }, 'list-assets': { type: 'boolean' } } });
  if (!v.data) { console.error('usage: node archive/stats.mjs --data <dir> [--assets <dir>] [--hours 24] [--out file] | --list-assets'); process.exit(2); }
  if (v['list-assets']) { console.log(neededAssets(readFileSync(join(v.data, 'captures.jsonl'), 'utf8'), Number(v.hours)).join('\n')); process.exit(0); }
  const s = computeStats({ data: v.data, assets: v.assets, hours: Number(v.hours) });
  const json = JSON.stringify(s, null, 1) + '\n';
  if (v.out) { mkdirSync(dirname(v.out), { recursive: true }); writeFileSync(v.out, json); }
  for (const [room, r] of Object.entries(s.rooms)) console.log(`${room}: ${r.from_ts} .. ${r.to_ts} (${r.span_minutes} min, ${r.complete ? 'complete' : 'INCOMPLETE'}) jobs ${r.jobs.records} ids ${r.jobs.ids} requesters ${r.jobs.requester_keys} reposted ${r.jobs.reposted_share_pct}% | result ${r.outcomes.with_result_pct}% of ${r.outcomes.basis_ids}`);
}
