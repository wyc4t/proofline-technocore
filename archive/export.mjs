#!/usr/bin/env node
// Builds a citable, reproducible bundle for one room and one fixed sequence window of the
// archive: the raw records, the cases Proofline builds from them, and a manifest that pins
// every input. Running it again on the same archive gives byte-identical files, so a
// finding can cite the bundle ID and anyone can regenerate and compare.
//
//   node archive/export.mjs --data <archive-data> [--assets <dir>] --room <room>
//        [--generation 0] [--from-seq N] [--to-seq M] --out <dir> [--allow-gaps]
//
// Writes <out>/records.jsonl, <out>/cases.json and <out>/MANIFEST.json, and prints the
// bundle ID (SHA-256 of MANIFEST.json). See archive/EXPORT.md for the format.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { check } from './check.mjs';
import { sha256, classify, VERIFIER_VERSION } from './lib/records.mjs';
import { parseMessage } from '../src/lib/protocol.js';
import { buildCases } from '../src/lib/cases.js';

import {storageEpoch,archiveGroup} from '../src/lib/archive-epoch.js';
export const EXPORT_VERSION = '2';
const here = new URL('.', import.meta.url).pathname;
const codeHash = (rel) => sha256(readFileSync(join(here, rel)));

export function exportBundle({ data, assets, room, generation = '0', epoch=0, fromSeq, toSeq, allowGaps = false }) {
  const report = check({ data, assets, keepRecords: true });
  if (report.problems.length) throw new Error(`archive integrity problems:\n  ${report.problems.join('\n  ')}`);
  const gen = archiveGroup(generation,epoch);
  const recs = report.records[room]?.[gen];
  if (!recs?.size) throw new Error(`no archived records for ${room} ${gen}`);
  const seqs = [...recs.keys()].sort((a, b) => a - b);
  const from = fromSeq ?? seqs[0], to = toSeq ?? seqs.at(-1);
  const inWindow = seqs.filter((s) => s >= from && s <= to);
  const missing = (to - from + 1) - inWindow.length;
  if (missing && !allowGaps) throw new Error(`${missing} sequence numbers in ${from}..${to} are not in the archive (a gap, or outside what was captured). Narrow the window or pass --allow-gaps.`);

  const lines = inWindow.map((s) => recs.get(s));
  const rawBytes = Buffer.concat(lines.flatMap((p) => [p.raw, Buffer.from('\n')]));
  const status = { valid: 0, invalid: 0, no_sig: 0, unsigned: 0 };
  const parsed = [];
  for (const p of lines) {
    const st = classify(room, p);
    status[st]++;
    const r = parseMessage({ ...p.rec, sigStatus: st }, room);
    if (r.ok) parsed.push(r.record);
  }
  const cases = buildCases(parsed)
    .map((c) => ({
      key: c.key, room: c.room, id: c.id, title: c.title, status: c.status,
      stages: c.stages.map((s) => s.length), verdicts: c.verdicts, negative: c.negative,
      attestation: c.attestation, continuity: c.continuity,
      elapsed_first_ms: c.elapsedFirst, elapsed_last_ms: c.elapsedLast,
      flags: c.flags.map((f) => ({ id: f.id, seqs: f.seqs })),
      records: c.list.map((r) => ({ seq: r.seq, kind: r.kind, ts: r.ts, from: r.source || null, sig_status: r.sigStatus, key: r.keyId })),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const casesBytes = Buffer.from(JSON.stringify(cases, null, 1) + '\n');

  const roomReport = report.rooms[room][gen];
  const overlaps = (a, b) => a <= to && b >= from;
  const manifest = {
    format: 'proofline-export', export_version: EXPORT_VERSION,
    room, generation: String(generation), storage_epoch:storageEpoch({storage_epoch:epoch}),
    window: { from_seq: from, to_seq: to, first_ts: lines[0]?.rec.ts ?? null, last_ts: lines.at(-1)?.rec.ts ?? null },
    coverage: {
      records_in_window: inWindow.length,
      seqs_missing_from_archive: missing,
      known_gaps_in_window: roomReport.known_gaps.filter((g) => overlaps(g.from, g.to)).map(({ from: f, to: t }) => ({ from: f, to: t })),
      note: 'Complete for this window when seqs_missing_from_archive is 0. Says nothing about earlier generations or anything outside the window.',
    },
    files: {
      'records.jsonl': { sha256: sha256(rawBytes), bytes: rawBytes.length, records: lines.length, note: 'byte-exact lines of the room export, ascending seq' },
      'cases.json': { sha256: sha256(casesBytes), bytes: casesBytes.length, cases: cases.length, protocol_records: parsed.length },
    },
    signatures: status,
    code: {
      verifier_version: VERIFIER_VERSION,
      'src/lib/protocol.js': codeHash('../src/lib/protocol.js'),
      'src/lib/cases.js': codeHash('../src/lib/cases.js'),
      'archive/lib/records.mjs': codeHash('lib/records.mjs'),
      'archive/export.mjs': codeHash('export.mjs'),
      'src/lib/archive-epoch.js':codeHash('../src/lib/archive-epoch.js'),
    },
    archive_inputs: report.captures
      .filter((c) => c.ok && c.room === room && String(c.generation) === String(generation) && storageEpoch(c)===epoch && c.new_records && overlaps(c.new_first_seq, c.new_last_seq))
      .map((c) => ({ captured_at: c.captured_at, new_first_seq: c.new_first_seq, new_last_seq: c.new_last_seq, new_sha256: c.new_sha256,
        stored: c.storage.kind === 'release' ? `release ${c.storage.tag}/${c.storage.asset}` : `archive-data ${c.storage.files.join(', ')}` })),
    limits: [
      'A valid signature shows that a key signed room, nonce and text; not who holds the key, nor that the work is correct.',
      'seq and ts are assigned by Technocore and are not signed.',
      'Cases group records by room and ID. An ID reused by several requests is one case here.',
      'Capture times are the collector\'s claim, backed by git commit and release upload times.',
    ],
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 1) + '\n');
  return { rawBytes, casesBytes, manifestBytes, manifest, cases, bundleId: sha256(manifestBytes) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: v } = parseArgs({ options: {
    data: { type: 'string' }, assets: { type: 'string' }, room: { type: 'string' }, generation: { type: 'string', default: '0' }, epoch: {type:'string',default:'0'},
    'from-seq': { type: 'string' }, 'to-seq': { type: 'string' }, out: { type: 'string' }, 'allow-gaps': { type: 'boolean' },
  } });
  if (!v.data || !v.room || !v.out) { console.error('usage: node archive/export.mjs --data <dir> [--assets <dir>] --room <room> [--from-seq N] [--to-seq M] --out <dir>'); process.exit(2); }
  try {
    const b = exportBundle({ data: v.data, assets: v.assets, room: v.room, generation: v.generation, epoch:Number(v.epoch),
      fromSeq: v['from-seq'] ? Number(v['from-seq']) : undefined, toSeq: v['to-seq'] ? Number(v['to-seq']) : undefined, allowGaps: v['allow-gaps'] });
    mkdirSync(v.out, { recursive: true });
    writeFileSync(join(v.out, 'records.jsonl'), b.rawBytes);
    writeFileSync(join(v.out, 'cases.json'), b.casesBytes);
    writeFileSync(join(v.out, 'MANIFEST.json'), b.manifestBytes);
    const m = b.manifest;
    console.log(`${m.room} g${m.generation} seq ${m.window.from_seq}..${m.window.to_seq} (${m.window.first_ts} .. ${m.window.last_ts})`);
    console.log(`${m.files['records.jsonl'].records} records, ${m.files['cases.json'].cases} cases, ${m.coverage.seqs_missing_from_archive} seqs missing; signatures ${JSON.stringify(m.signatures)}`);
    console.log(`bundle ${b.bundleId}`);
  } catch (e) { console.error(String(e.message || e)); process.exit(1); }
}
