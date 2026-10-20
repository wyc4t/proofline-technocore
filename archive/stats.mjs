#!/usr/bin/env node
// Rolling statistics over the evidence archive, for the headline panel on the site.
//
//   node archive/stats.mjs --data <archive-data> [--assets <dir>] [--hours 24] [--out stats.json]
//
// Every number is computed from archived records whose signatures were re-verified, over a
// stated window, and says whether the archive covers that window without gaps. Jobs are
// counted per room and job ID, as the app does. Outcome rates only count jobs posted at
// least OUTCOME_GRACE_MIN minutes before the window's end, so recent jobs are not counted
// as unanswered merely because they are recent.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { check } from './check.mjs';
import { classify, sha256, VERIFIER_VERSION } from './lib/records.mjs';
import { parseMessage } from '../src/lib/protocol.js';
import { NEGATIVE } from '../src/lib/cases.js';

export const STATS_VERSION = '1';
export const OUTCOME_GRACE_MIN = 30;
const here = new URL('.', import.meta.url).pathname;
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);

export function roomStats(room, entries, { fromMs, toMs, gaps = [], unavailable = 0 }) {
  // entries: [{ rec, nonceDigits, raw }] for this room, any generation, already verified by check()
  const inWindow = entries.filter((p) => { const t = Date.parse(p.rec.ts); return t >= fromMs && t <= toMs; });
  const sig = { valid: 0, invalid: 0, no_sig: 0, unsigned: 0 };
  const recs = [];
  for (const p of inWindow) {
    const st = classify(room, p);
    sig[st]++;
    const r = parseMessage({ ...p.rec, sigStatus: st }, room);
    if (r.ok) recs.push(r.record);
  }
  const byId = new Map();
  for (const r of recs) (byId.get(r.id) || byId.set(r.id, []).get(r.id)).push(r);
  const jobs = recs.filter((r) => r.stage === 0);
  const requesters = new Set(jobs.map((r) => r.keyId).filter(Boolean));
  const active = new Set(recs.map((r) => r.keyId).filter(Boolean));
  let repostedIds = 0, repostedJobRecords = 0;
  const cutoff = toMs - OUTCOME_GRACE_MIN * 60e3;
  const o = { basis_ids: 0, with_claim: 0, with_result: 0, with_attestation: 0, with_useful_attestation: 0 };
  const firstResult = [];
  for (const list of byId.values()) {
    const js = list.filter((r) => r.stage === 0);
    if (!js.length) continue;
    const keys = new Set(js.map((r) => r.keyId).filter(Boolean));
    if (keys.size >= 2) { repostedIds++; repostedJobRecords += js.length; }
    const t0 = Math.min(...js.map((r) => Date.parse(r.ts)));
    if (t0 > cutoff) continue;
    o.basis_ids++;
    const after = (stage) => list.filter((r) => r.stage === stage && Date.parse(r.ts) >= t0);
    const results = after(2), attests = after(3);
    if (after(1).length) o.with_claim++;
    if (results.length) { o.with_result++; firstResult.push((Math.min(...results.map((r) => Date.parse(r.ts))) - t0) / 1000); }
    if (attests.length) o.with_attestation++;
    if (attests.some((a) => a.verdict === 'useful')) o.with_useful_attestation++;
  }
  const attests = recs.filter((r) => r.stage === 3);
  const ts = inWindow.map((p) => Date.parse(p.rec.ts));
  const first = ts.length ? Math.min(...ts) : null, last = ts.length ? Math.max(...ts) : null;
  return {
    from_ts: first ? new Date(first).toISOString() : null,
    to_ts: last ? new Date(last).toISOString() : null,
    span_minutes: first ? Math.round((last - first) / 60e3) : 0,
    complete: !gaps.length && !unavailable,
    gaps, unavailable_captures: unavailable,
    records: inWindow.length, protocol_records: recs.length, signatures: sig,
    jobs: {
      records: jobs.length, ids: new Set(jobs.map((r) => r.id)).size, requester_keys: requesters.size,
      reposted_ids: repostedIds, reposted_job_records: repostedJobRecords, reposted_share_pct: pct(repostedJobRecords, jobs.length),
    },
    outcomes: {
      ...o, posted_before: new Date(cutoff).toISOString(),
      with_claim_pct: pct(o.with_claim, o.basis_ids), with_result_pct: pct(o.with_result, o.basis_ids),
      with_attestation_pct: pct(o.with_attestation, o.basis_ids), with_useful_attestation_pct: pct(o.with_useful_attestation, o.basis_ids),
      median_first_result_seconds: median(firstResult),
    },
    attestations: { records: attests.length, negative: attests.filter((a) => NEGATIVE.has(a.verdict)).length },
    active_keys: active.size,
    ids_without_job: [...byId.values()].filter((l) => !l.some((r) => r.stage === 0)).length,
  };
}

export function computeStats({ data, assets, hours = 24, rooms = ['kibble', 'credence'], now = Date.now() }) {
  const report = check({ data, assets, keepRecords: true });
  if (report.problems.length) throw new Error(`archive integrity problems:\n  ${report.problems.join('\n  ')}`);
  const out = { format: 'proofline-stats', stats_version: STATS_VERSION, generated_at: new Date(now).toISOString(), window_hours: hours, rooms: {},
    code: { verifier_version: VERIFIER_VERSION, 'src/lib/protocol.js': sha256(readFileSync(join(here, '../src/lib/protocol.js'))), 'archive/stats.mjs': sha256(readFileSync(join(here, 'stats.mjs'))) },
    notes: [
      'Counts are per room and job ID, over archived records whose signatures were re-verified.',
      `Outcome rates count jobs posted at least ${OUTCOME_GRACE_MIN} minutes before the window ends.`,
      'A reposted ID is a job ID whose JOB records come from two or more verified keys.',
      'These describe records, not whether any work was correct or useful.',
    ] };
  for (const room of rooms) {
    const gens = report.records[room] || {};
    const lastCapture = Object.values(report.rooms[room] || {}).map((g) => Date.parse(g.unknown.after_last_successful_capture || 0)).reduce((a, b) => Math.max(a, b), 0);
    const toMs = lastCapture || now, fromMs = toMs - hours * 3600e3;
    const entries = Object.values(gens).flatMap((m) => [...m.values()]);
    const inWin = entries.filter((p) => Date.parse(p.rec.ts) >= fromMs);
    const lo = inWin.length ? Math.min(...inWin.map((p) => p.rec.seq)) : Infinity;
    const gaps = Object.values(report.rooms[room] || {}).flatMap((g) => g.known_gaps).filter((g) => g.to >= lo).map(({ from, to }) => ({ from, to }));
    const unavailable = Object.values(report.rooms[room] || {}).flatMap((g) => g.unknown.not_available_to_this_check).filter((u) => u.to >= lo).length;
    out.rooms[room] = { ...roomStats(room, entries, { fromMs, toMs, gaps, unavailable }), window_start: new Date(fromMs).toISOString(), last_capture: lastCapture ? new Date(lastCapture).toISOString() : null };
  }
  return out;
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
