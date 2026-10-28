// A small lookup index over captures.jsonl, so a pinned link does not have to download the
// whole capture log, which grows every day.
//
//   index/<room>/days.json          { "days": [{ "day", "g", "first", "last" }, ...] }
//                                   which sequence numbers each UTC capture day holds
//   index/<room>/<YYYY-MM-DD>.jsonl one line per capture with new records that day: the fields
//                                   a reader needs to fetch and check those records
//
// The index only points into the archive; captures.jsonl stays the record. Every line here
// is copied from it, and readers still check each capture against its own hashes.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {renameSync,rmSync} from 'node:fs';
import {storageEpoch,legacyAmbiguousGenerations} from '../../src/lib/archive-epoch.js';

const KEEP = ['captured_at', 'room', 'generation', 'storage_epoch', 'events', 'new_records', 'new_first_seq', 'new_last_seq', 'new_sha256', 'storage'];
const compact = (c) => Object.fromEntries(KEEP.map((k) => [k, c[k]]));

export function addToIndex(data, entry) {
  if (!entry?.ok || !entry.new_records) return;
  const root=join(data,'index',entry.room),epoch=storageEpoch(entry),day=String(entry.captured_at).slice(0,10);
  mkdirSync(root,{recursive:true});
  if(epoch&&!existsSync(join(root,'days.json')))writeFileSync(join(root,'days.json'),JSON.stringify({epoch_format:1,epoch_partitioned:1,days:[]})+'\n');
  const dir=epoch?join(root,`e${epoch}`):root;
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${day}.jsonl`), JSON.stringify(compact(entry)) + '\n');
  const daysPath = join(dir, 'days.json');
  const idx = existsSync(daysPath) ? JSON.parse(readFileSync(daysPath, 'utf8')) : { days: [] };
  const g = String(entry.generation);
  idx.epoch_format=1;idx.epoch_partitioned=1;
  if(entry.storage_epoch==null&&entry.events?.some(e=>e.type==='seq_regression'))idx.legacy_ambiguous_generations=[...new Set([...(idx.legacy_ambiguous_generations||[]),g])];
  let d = idx.days.find((x) => x.day === day && x.g === g && storageEpoch(x) === epoch);
  if (!d) { d = { day, g, storage_epoch:epoch, first: entry.new_first_seq, last: entry.new_last_seq }; idx.days.push(d); }
  d.first = Math.min(d.first, entry.new_first_seq); d.last = Math.max(d.last, entry.new_last_seq);
  if(idx.legacy_ambiguous_generations?.includes(g))idx.days=idx.days.filter(d=>d.g!==g);
  idx.days.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.g < b.g ? -1 : 1));
  writeFileSync(daysPath, JSON.stringify(idx) + '\n');
}

// Builds the index from captures.jsonl when it does not exist yet (first run after this change).
export function ensureIndex(data) {
  const log=join(data,'captures.jsonl');if(!existsSync(log))return false;
  const captures=readFileSync(log,'utf8').split('\n').filter(Boolean).map(JSON.parse),rooms=[...new Set(captures.filter(c=>c.ok&&c.new_records).map(c=>c.room))];
  if(existsSync(join(data,'index'))&&rooms.every(room=>{const p=join(data,'index',room,'days.json');return existsSync(p)&&JSON.parse(readFileSync(p,'utf8')).epoch_format===1&&JSON.parse(readFileSync(p,'utf8')).epoch_partitioned===1}))return false;
  const build=join(data,'.epoch-index-build'),old=join(data,'.epoch-index-old');
  if(existsSync(build)||existsSync(old))throw Error('Incomplete epoch index migration; inspect temporary index directories');
  mkdirSync(build,{recursive:true});
  try{for(const c of captures)addToIndex(build,c);for(const room of rooms){const p=join(build,'index',room,'days.json'),idx=JSON.parse(readFileSync(p,'utf8'));idx.legacy_ambiguous_generations=legacyAmbiguousGenerations(captures,room);idx.days=idx.days.filter(d=>!idx.legacy_ambiguous_generations.includes(d.g));writeFileSync(p,JSON.stringify(idx)+'\n')}
    if(existsSync(join(data,'index')))renameSync(join(data,'index'),old);
    if(existsSync(join(build,'index')))renameSync(join(build,'index'),join(data,'index'));else mkdirSync(join(data,'index'));
    rmSync(old,{recursive:true,force:true});rmSync(build,{recursive:true,force:true});return true;
  }catch(error){if(existsSync(old)&&!existsSync(join(data,'index')))renameSync(old,join(data,'index'));throw error}
}
