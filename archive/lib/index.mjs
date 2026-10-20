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

const KEEP = ['captured_at', 'room', 'generation', 'new_records', 'new_first_seq', 'new_last_seq', 'new_sha256', 'storage'];
const compact = (c) => Object.fromEntries(KEEP.map((k) => [k, c[k]]));

export function addToIndex(data, entry) {
  if (!entry?.ok || !entry.new_records) return;
  const dir = join(data, 'index', entry.room), day = String(entry.captured_at).slice(0, 10);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${day}.jsonl`), JSON.stringify(compact(entry)) + '\n');
  const daysPath = join(dir, 'days.json');
  const idx = existsSync(daysPath) ? JSON.parse(readFileSync(daysPath, 'utf8')) : { days: [] };
  const g = String(entry.generation);
  let d = idx.days.find((x) => x.day === day && x.g === g);
  if (!d) { d = { day, g, first: entry.new_first_seq, last: entry.new_last_seq }; idx.days.push(d); }
  d.first = Math.min(d.first, entry.new_first_seq); d.last = Math.max(d.last, entry.new_last_seq);
  idx.days.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.g < b.g ? -1 : 1));
  writeFileSync(daysPath, JSON.stringify(idx) + '\n');
}

// Builds the index from captures.jsonl when it does not exist yet (first run after this change).
export function ensureIndex(data) {
  const log = join(data, 'captures.jsonl');
  if (existsSync(join(data, 'index')) || !existsSync(log)) return false;
  for (const line of readFileSync(log, 'utf8').split('\n')) if (line.trim()) addToIndex(data, JSON.parse(line));
  return true;
}
