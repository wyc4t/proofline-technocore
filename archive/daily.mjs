#!/usr/bin/env node
// Daily digest: the statistics of one UTC day, from the evidence archive.
//
//   node archive/daily.mjs --data <archive-data> --list-assets --day YYYY-MM-DD   release files the day needs
//   node archive/daily.mjs --data <archive-data> --assets <dir> --day YYYY-MM-DD  compute and save the day
//
// Writes stats/daily/<day>.json (the full statistics, as archive/stats.mjs computes them) and keeps
// stats/daily/index.json: one entry per day with the headline numbers and how much of the day the
// archive covers. A day is "full" only if the archive reaches back before its start, was captured
// past its end, and has no known gaps or missing files inside it.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { computeStats, neededAssetsBetween } from './stats.mjs';

const pick = (r) => r && ({
  full_day: !!(r.covers_window_start && r.covers_window_end && r.complete),
  covers_window_start: r.covers_window_start, covers_window_end: r.covers_window_end, complete: r.complete,
  from_ts: r.from_ts, to_ts: r.to_ts, records: r.records,
  jobs: r.jobs.records, job_ids: r.jobs.ids, requester_keys: r.jobs.requester_keys, reposted_share_pct: r.jobs.reposted_share_pct,
  with_result_pct: r.outcomes.with_result_pct, with_useful_attestation_pct: r.outcomes.with_useful_attestation_pct,
  median_first_result_seconds: r.outcomes.median_first_result_seconds,
  attestations: r.attestations.records, negative_attestations: r.attestations.negative, active_keys: r.active_keys,
});

export function dayWindow(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('day must be YYYY-MM-DD');
  const fromMs = Date.parse(`${day}T00:00:00Z`);
  return { fromMs, toMs: fromMs + 86400e3 };
}

export function computeDay({ data, assets, day }) {
  const s = computeStats({ data, assets, window: dayWindow(day) });
  const dir = join(data, 'stats', 'daily');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${day}.json`), JSON.stringify({ ...s, day }, null, 1) + '\n');
  const indexPath = join(dir, 'index.json');
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { format: 'proofline-daily', days: [] };
  index.days = index.days.filter((d) => d.day !== day);
  index.days.push({ day, generated_at: s.generated_at, stats_version: s.stats_version, rooms: Object.fromEntries(Object.entries(s.rooms).map(([k, r]) => [k, pick(r)])) });
  index.days.sort((a, b) => (a.day < b.day ? 1 : -1));
  writeFileSync(indexPath, JSON.stringify(index, null, 1) + '\n');
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: v } = parseArgs({ options: { data: { type: 'string' }, assets: { type: 'string' }, day: { type: 'string' }, 'list-assets': { type: 'boolean' } } });
  if (!v.data || !v.day) { console.error('usage: node archive/daily.mjs --data <dir> [--assets <dir>] --day YYYY-MM-DD [--list-assets]'); process.exit(2); }
  const w = dayWindow(v.day);
  if (v['list-assets']) { console.log(neededAssetsBetween(readFileSync(join(v.data, 'captures.jsonl'), 'utf8'), w.fromMs, w.toMs).join('\n')); process.exit(0); }
  const s = computeDay({ data: v.data, assets: v.assets, day: v.day });
  for (const [room, r] of Object.entries(s.rooms)) {
    const p = pick(r);
    console.log(`${v.day} ${room}: ${p.full_day ? 'full day' : `partial (start ${p.covers_window_start ? 'covered' : 'not covered'}, end ${p.covers_window_end ? 'covered' : 'not covered'}, ${p.complete ? 'no gaps' : 'gaps'})`} · jobs ${p.jobs} · result ${p.with_result_pct}% · useful ${p.with_useful_attestation_pct}% · reposted ${p.reposted_share_pct}%`);
  }
}
