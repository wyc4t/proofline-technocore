#!/usr/bin/env node
// Evidence archive collector. Downloads each room's export, keeps only records newer than
// what is already archived (byte for byte, so signatures still re-verify), and appends one
// manifest entry per room per capture to captures.jsonl. Gaps, generation changes and
// failures are recorded; nothing is hidden or repaired.
//
//   node archive/collect.mjs --data <dir> [--rooms credence,kibble] [--release-rooms kibble]
//        [--outbox <dir>] [--base https://technocore.chat]
//   node archive/collect.mjs --data <dir> --import <room>=<export.jsonl>,<headers.txt> --captured-at <ISO>
//
// Rooms in --release-rooms are written to <outbox>/<tag>/<asset>.jsonl.gz for upload as
// GitHub release assets; other rooms are appended to <data>/rooms/<room>/g<gen>/<day>.jsonl.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { sha256, splitExport } from './lib/records.mjs';
import {addLookup} from './lib/lookup.mjs';
import {bootstrapCheckpoint} from './bootstrap.mjs';
import {storageEpoch,archiveGroup,legacyAmbiguousGenerations} from '../src/lib/archive-epoch.js';
import { addToIndex, ensureIndex } from './lib/index.mjs';

export const COLLECTOR_VERSION = '4';
const NL = Buffer.from('\n');

// Pure step: given the previous state of one room and one export body, decide what is new
// and describe it. Returns { entry, newLines, nextState }.
export function ingest({ room, body, generation, serverDate, capturedAt, httpStatus, prev }) {
  const { parsed, unparseable, partialTail } = splitExport(body);
  const events = [];
  const entry = {
    captured_at: capturedAt, room, ok: true, http_status: httpStatus ?? null,
    generation: generation ?? null, server_date: serverDate ?? null,
    export_bytes: body.length, export_sha256: sha256(body), export_records: parsed.length,
    export_first_seq: parsed.length ? parsed[0].rec.seq : null,
    export_last_seq: parsed.length ? parsed[parsed.length - 1].rec.seq : null,
    collector_version: COLLECTOR_VERSION, events,
  };
  if (unparseable.length) events.push({ type: 'unparseable_lines', count: unparseable.length, sha256: unparseable });
  if (partialTail) events.push({ type: 'partial_tail', bytes: partialTail });
  // Only a completely empty body is an empty export. Malformed/truncated bytes are unknown.
  const exportEmpty = body.length === 0;
  const sameGeneration = !prev || generation == null || prev.generation == null || String(generation) === String(prev.generation);
  const emptySince = exportEmpty ? (sameGeneration && prev?.export_empty === true ? prev.empty_observed_since : null) || capturedAt : null;
  if (exportEmpty) events.push({ type: 'empty_export', first_observed_at: emptySince, archived_last_seq: sameGeneration ? prev?.last_seq ?? null : null });

  for (let i = 1; i < parsed.length; i++) {
    const a = parsed[i - 1].rec.seq, b = parsed[i].rec.seq;
    if (b !== a + 1) events.push(b > a + 1 ? { type: 'internal_gap', from: a + 1, to: b - 1 } : { type: 'non_monotonic', after: a, seq: b });
  }

  if(prev?.last_record_sha256!=null&&!/^[0-9a-f]{64}$/.test(prev.last_record_sha256))throw Error('Invalid archived checkpoint hash');
  let epoch = storageEpoch(prev);
  let since = null; // highest seq already archived in this storage epoch
  const checkpoint = prev?.last_record_sha256 && parsed.find(p => p.rec.seq === prev.last_seq);
  const changedCheckpoint = checkpoint && sha256(checkpoint.raw) !== prev.last_record_sha256;
  const generationChanged=prev&&generation!=null&&prev.generation!=null&&String(generation)!==String(prev.generation);
  const inferredBoundary=!generationChanged&&prev&&(entry.export_last_seq!==null&&entry.export_last_seq<prev.last_seq||changedCheckpoint);
  if(inferredBoundary&&(partialTail||unparseable.length||events.some(e=>e.type==='non_monotonic')))throw Error('Cannot establish a storage epoch from an incomplete or non-monotonic export');
  if (!prev) events.push({ type: 'first_capture' });
  else if (generation != null && prev.generation != null && String(generation) !== String(prev.generation)) {
    epoch++;
    events.push({ type: 'generation_change', from: prev.generation, to: generation });
  } else if (entry.export_last_seq !== null && entry.export_last_seq < prev.last_seq) {
    epoch++;
    events.push({ type: 'seq_regression', archived_last_seq: prev.last_seq, export_last_seq: entry.export_last_seq });
  } else if (changedCheckpoint) {
    epoch++;
    events.push({ type: 'sequence_conflict', seq: prev.last_seq, archived_sha256: prev.last_record_sha256, observed_sha256: sha256(checkpoint.raw) });
  } else since = prev.last_seq;
  entry.storage_epoch = storageEpoch({storage_epoch:epoch});
  archiveGroup(generation, epoch); // Validate before any storage path is formed.

  if (since !== null && entry.export_first_seq !== null && entry.export_first_seq > since + 1) {
    events.push({ type: 'gap', from: since + 1, to: entry.export_first_seq - 1 });
  }
  let last = since ?? -Infinity;
  const newLines = [];
  for (const p of parsed) if (p.rec.seq > last) { newLines.push(p); last = p.rec.seq; }
  const newBytes = Buffer.concat(newLines.flatMap((p) => [p.raw, NL]));
  Object.assign(entry, {
    new_records: newLines.length,
    new_first_seq: newLines.length ? newLines[0].rec.seq : null,
    new_last_seq: newLines.length ? newLines[newLines.length - 1].rec.seq : null,
    new_sha256: sha256(newBytes),
  });
  const nextState = {
    generation: generation ?? prev?.generation ?? null,
    storage_epoch: epoch,
    last_record_sha256: parsed.length && entry.export_last_seq === (newLines.length ? entry.new_last_seq : since) ? sha256(parsed.at(-1).raw) : since === prev?.last_seq ? prev?.last_record_sha256 ?? null : null,
    last_seq: newLines.length ? entry.new_last_seq : (since ?? null),
    last_capture: capturedAt,
    export_empty: exportEmpty ? true : parsed.length ? false : null,
    empty_observed_since: emptySince,
    observed_export_last_seq: entry.export_last_seq,
  };
  return { entry, newLines, newBytes, nextState };
}

function store({ data, outbox, room, mode, entry, newLines, newBytes }) {
  if (!newLines.length) { entry.storage = { kind: 'none' }; return; }
  const gen = archiveGroup(entry.generation, storageEpoch(entry));
  if (mode === 'release') {
    const tag = `${room}-${entry.captured_at.slice(0, 10)}`;
    const asset = `${room}-${gen.replace(/e(\d+)$/, '-e$1')}-${entry.new_first_seq}-${entry.new_last_seq}.jsonl.gz`;
    const gz = gzipSync(newBytes, { level: 9 }); // gzip header mtime is 0, so output is deterministic
    mkdirSync(join(outbox, tag), { recursive: true });
    const destination=join(outbox,tag,asset);
    if(existsSync(destination)&&sha256(readFileSync(destination))!==sha256(gz))throw Error('Refusing to replace different bytes at an existing release filename');
    writeFileSync(destination, gz);
    entry.storage = { kind: 'release', tag, asset, gz_bytes: gz.length, gz_sha256: sha256(gz) };
    return;
  }
  const files = new Map();
  for (const p of newLines) {
    const day = /^\d{4}-\d{2}-\d{2}/.test(String(p.rec.ts)) ? String(p.rec.ts).slice(0, 10) : 'undated';
    const rel = join('rooms', room, gen, `${day}.jsonl`);
    if (!files.has(rel)) files.set(rel, []);
    files.get(rel).push(p.raw, NL);
  }
  for (const [rel, parts] of files) {
    mkdirSync(join(data, rel, '..'), { recursive: true });
    appendFileSync(join(data, rel), Buffer.concat(parts));
  }
  entry.storage = { kind: 'git', files: [...files.keys()] };
}

async function fetchExport(base, room) {
  const res = await fetch(`${base}/r/${room}/export`, { signal: AbortSignal.timeout(90_000), headers: { 'user-agent': `proofline-archive/${COLLECTOR_VERSION}` } });
  const body = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { httpStatus: res.status });
  return { body, httpStatus: res.status, generation: res.headers.get('x-room-generation'), serverDate: res.headers.get('date') };
}

async function main() {
  const { values } = parseArgs({ options: {
    data: { type: 'string' }, rooms: { type: 'string', default: 'credence,kibble' },
    'release-rooms': { type: 'string', default: '' }, outbox: { type: 'string', default: 'outbox' },
    base: { type: 'string', default: 'https://technocore.chat' }, 'checkpoint-assets':{type:'string'},
    import: { type: 'string', multiple: true }, 'captured-at': { type: 'string' },
  } });
  if (!values.data) throw new Error('--data is required');
  const data = values.data;
  mkdirSync(data, { recursive: true });
  if (ensureIndex(data)) console.log('built the capture index from captures.jsonl');
  const statePath = join(data, 'state.json');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { rooms: {} };
  const priorCaptures = existsSync(join(data,'captures.jsonl')) ? readFileSync(join(data,'captures.jsonl'),'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  const releaseRooms = new Set(values['release-rooms'].split(',').filter(Boolean));
  const jobs = values.import
    ? values.import.map((spec) => {
      const [room, files] = spec.split('=');
      const [exportFile, headersFile] = files.split(',');
      const h = headersFile ? readFileSync(headersFile, 'utf8') : '';
      const header = (name) => (h.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, 'im')) || [])[1] ?? null;
      return { room, get: async () => ({ body: readFileSync(exportFile), httpStatus: 200, generation: header('x-room-generation'), serverDate: header('date') }) };
    })
    : values.rooms.split(',').filter(Boolean).map((room) => ({ room, get: () => fetchExport(values.base, room) }));

  let failures = 0;
  for (const { room, get } of jobs) {
    const capturedAt = values['captured-at'] || new Date().toISOString();
    let entry;
    try {
      let prev=state.rooms[room];
      if(!prev&&priorCaptures.some(c=>c.ok&&c.room===room&&c.new_records))throw Error('Existing archive history has no cursor state; recover it before collection');
      if(prev?.storage_epoch == null && legacyAmbiguousGenerations(priorCaptures,room).includes(String(prev?.generation??'unknown'))) throw Error('Legacy sequence reuse requires manual archive recovery before collection');
      const got = await get();
      if(prev?.last_seq!=null&&!prev.last_record_sha256&&got.body.length&&(got.generation==null||prev.generation==null||String(got.generation)===String(prev.generation))){
        const end=splitExport(got.body).parsed.at(-1)?.rec.seq;
        if(end>=prev.last_seq)prev=bootstrapCheckpoint({data,assets:values['checkpoint-assets'],room,prev});
      }
      const r = ingest({ room, ...got, capturedAt, prev });
      entry = r.entry;
      store({ data, outbox: values.outbox, room, mode: releaseRooms.has(room) ? 'release' : 'git', ...r });
      try { addLookup(join(data,'lookup'),entry,r.newLines); } catch (err) { entry.events.push({type:'lookup_index_error',error:String(err.message||err)}); }
      state.rooms[room] = r.nextState;
      if (values.import) entry.source = 'import';
    } catch (err) {
      failures++;
      entry = { captured_at: capturedAt, room, ok: false, http_status: err.httpStatus ?? null, error: String(err.message || err), collector_version: COLLECTOR_VERSION };
    }
    appendFileSync(join(data, 'captures.jsonl'), JSON.stringify(entry) + '\n');
    addToIndex(data, entry);
    const ev = (entry.events || []).map((e) => e.type).join(',');
    console.log(`${room}: ${entry.ok ? `+${entry.new_records} (seq ${entry.new_first_seq ?? '-'}..${entry.new_last_seq ?? '-'})${ev ? ' events=' + ev : ''}` : 'FAILED ' + entry.error}`);
  }
  writeFileSync(statePath, JSON.stringify(state, null, 1) + '\n');
  // A failed fetch is evidence too: exit 0 so the run still commits the failure entries.
  if (failures) console.log(`${failures} of ${jobs.length} rooms failed; recorded in captures.jsonl`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
