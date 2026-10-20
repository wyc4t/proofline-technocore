#!/usr/bin/env node
// Reproduce the archive's claims from downloaded evidence alone.
//
//   node archive/check.mjs --data <archive-data checkout> [--assets <dir of release assets>]
//        [--case <room>:<id>] [--json]
//
// 1. Integrity: every capture's stored bytes hash to the manifest's new_sha256
//    (and, for release assets, the file hashes to gz_sha256).
// 2. Verification status of every archived record (valid / invalid / no_sig / unsigned).
// 3. Coverage per room and generation: observed continuous runs of seq, known gaps,
//    and what is unknown (before the first archived record, after the last capture,
//    captures whose bytes were not available to this check).
// 4. Optionally, every archived protocol record of one case, with its status.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { sha256, splitExport, classify, VERIFIER_VERSION } from './lib/records.mjs';
import { parseMessage } from '../src/lib/protocol.js';

const here = new URL('.', import.meta.url).pathname;

function listFiles(dir) {
  const out = [];
  if (!dir || !existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p)); else out.push(p);
  }
  return out;
}

const runs = (seqs) => {
  const out = [];
  for (const s of seqs) {
    const last = out[out.length - 1];
    if (last && s === last[1] + 1) last[1] = s; else out.push([s, s]);
  }
  return out;
};

export function check({ data, assets, caseRef }) {
  const captures = readFileSync(join(data, 'captures.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  // Release files: those supplied with --assets, plus any still waiting in pending-uploads.
  const assetPaths = new Map([...listFiles(join(data, 'pending-uploads')), ...listFiles(assets)].map((p) => [basename(p), p]));
  const gitCache = new Map();
  const gitLines = (rel) => {
    if (!gitCache.has(rel)) gitCache.set(rel, splitExport(readFileSync(join(data, rel))).parsed);
    return gitCache.get(rel);
  };

  const rooms = {};
  const problems = [];
  const room = (name, gen) => {
    rooms[name] ??= {};
    return (rooms[name][`g${gen}`] ??= {
      captures: 0, failed_captures: [], unavailable: [], records: new Map(), events: [], first_capture: null, last_ok_capture: null,
    });
  };

  for (const c of captures) {
    if (!c.ok) { room(c.room, 'unknown').failed_captures.push({ at: c.captured_at, error: c.error }); continue; }
    const g = room(c.room, c.generation ?? 'unknown');
    g.captures++;
    g.first_capture ??= c.captured_at;
    g.last_ok_capture = c.captured_at;
    for (const e of c.events || []) if (!['first_capture'].includes(e.type)) g.events.push({ at: c.captured_at, ...e });
    if (!c.new_records) continue;
    let lines;
    if (c.storage?.kind === 'release') {
      const p = assetPaths.get(c.storage.asset);
      if (!p) { g.unavailable.push({ from: c.new_first_seq, to: c.new_last_seq, asset: c.storage.asset, tag: c.storage.tag }); continue; }
      const gz = readFileSync(p);
      if (sha256(gz) !== c.storage.gz_sha256) { problems.push(`${c.storage.asset}: file hash does not match manifest`); continue; }
      lines = splitExport(gunzipSync(gz)).parsed;
    } else {
      lines = (c.storage?.files || []).flatMap(gitLines).filter((p) => p.rec.seq >= c.new_first_seq && p.rec.seq <= c.new_last_seq);
      lines.sort((a, b) => a.rec.seq - b.rec.seq);
    }
    const bytes = Buffer.concat(lines.flatMap((p) => [p.raw, Buffer.from('\n')]));
    if (sha256(bytes) !== c.new_sha256 || lines.length !== c.new_records) {
      problems.push(`${c.room} capture ${c.captured_at}: stored bytes do not match manifest (seq ${c.new_first_seq}..${c.new_last_seq})`);
      continue;
    }
    for (const p of lines) g.records.set(p.rec.seq, p);
  }

  const report = { verifier_version: VERIFIER_VERSION, parser_sha256: sha256(readFileSync(join(here, '../src/lib/protocol.js'))), problems, rooms: {} };
  let caseRecords = null;
  const [caseRoom, caseId] = caseRef ? caseRef.split(':') : [];
  for (const [name, gens] of Object.entries(rooms)) {
    report.rooms[name] = {};
    for (const [gen, g] of Object.entries(gens)) {
      const seqs = [...g.records.keys()].sort((a, b) => a - b);
      const status = { valid: 0, invalid: 0, no_sig: 0, unsigned: 0 };
      const invalid = [];
      for (const s of seqs) {
        const st = classify(name, g.records.get(s));
        status[st]++;
        if (st === 'invalid') invalid.push(s);
      }
      const recs = seqs.map((s) => g.records.get(s).rec);
      report.rooms[name][gen] = {
        records: seqs.length,
        verification: status,
        invalid_seqs: invalid,
        observed_continuous_runs: runs(seqs).map(([from, to]) => ({ from, to })),
        known_gaps: g.events.filter((e) => e.type === 'gap' || e.type === 'internal_gap').map(({ from, to, at }) => ({ from, to, recorded_at: at })),
        resets: g.events.filter((e) => e.type === 'generation_change' || e.type === 'seq_regression'),
        other_events: g.events.filter((e) => !['gap', 'internal_gap', 'generation_change', 'seq_regression'].includes(e.type)),
        unknown: {
          before_first_archived_seq: seqs.length ? seqs[0] : null,
          after_last_successful_capture: g.last_ok_capture,
          earlier_generations: 'not established by this archive',
          not_available_to_this_check: g.unavailable,
        },
        failed_captures: g.failed_captures,
        captures: g.captures,
        first_capture: g.first_capture,
        record_time_span: recs.length ? { first_ts: recs[0].ts, last_ts: recs[recs.length - 1].ts } : null,
      };
      if (name === caseRoom) {
        caseRecords ??= [];
        for (const s of seqs) {
          const p = g.records.get(s);
          const parsed = parseMessage(p.rec, name);
          if (parsed.ok && parsed.record.id === caseId) caseRecords.push({ generation: gen, seq: s, ts: p.rec.ts, kind: parsed.record.kind, from: p.rec.from ?? null, signature: classify(name, p), text: p.rec.text });
        }
      }
    }
  }
  if (caseRef) report.case = { ref: caseRef, records: caseRecords ?? [] };
  return report;
}

function summary(r) {
  const out = [`verifier v${r.verifier_version} · parser ${r.parser_sha256.slice(0, 12)}`];
  out.push(r.problems.length ? `INTEGRITY PROBLEMS:\n  ${r.problems.join('\n  ')}` : 'integrity: every available capture matches its manifest hash');
  for (const [name, gens] of Object.entries(r.rooms)) for (const [gen, g] of Object.entries(gens)) {
    out.push(`\n${name} ${gen}: ${g.records} records, ${g.captures} captures since ${g.first_capture ?? '-'}`);
    if (g.records) {
      out.push(`  signatures: ${Object.entries(g.verification).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      out.push(`  observed continuous: ${g.observed_continuous_runs.map((x) => `${x.from}..${x.to}`).join(', ')}`);
      out.push(`  records dated ${g.record_time_span.first_ts} .. ${g.record_time_span.last_ts}`);
    }
    out.push(`  known gaps: ${g.known_gaps.length ? g.known_gaps.map((x) => `${x.from}..${x.to}`).join(', ') : 'none'}`);
    if (g.resets.length) out.push(`  resets: ${g.resets.length}`);
    out.push(`  unknown: anything before seq ${g.unknown.before_first_archived_seq ?? '-'}, anything after ${g.unknown.after_last_successful_capture ?? '-'}, earlier generations` +
      (g.unknown.not_available_to_this_check.length ? `, ${g.unknown.not_available_to_this_check.length} capture(s) whose files were not supplied` : ''));
    if (g.failed_captures.length) out.push(`  failed captures: ${g.failed_captures.length}`);
  }
  if (r.case) {
    out.push(`\ncase ${r.case.ref}: ${r.case.records.length} protocol records`);
    for (const c of r.case.records) out.push(`  seq ${c.seq} ${c.ts} ${c.kind} ${c.signature} ${c.from ?? '(no sender)'}`);
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { data: { type: 'string' }, assets: { type: 'string' }, case: { type: 'string' }, json: { type: 'boolean' } } });
  if (!values.data) { console.error('usage: node archive/check.mjs --data <dir> [--assets <dir>] [--case room:id] [--json]'); process.exit(2); }
  const r = check({ data: values.data, assets: values.assets, caseRef: values.case });
  console.log(values.json ? JSON.stringify(r, null, 1) : summary(r));
  if (r.problems.length) process.exitCode = 1;
}
