#!/usr/bin/env node
// Lists the release files waiting in <data>/pending-uploads/<tag>/ as "tag<TAB>path" lines,
// after checking that each one is exactly the file a manifest entry recorded (name, tag and
// SHA-256). Anything else stops the run, so nothing unrecorded is ever published.
//
//   node archive/pending.mjs --data <dir>
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { sha256 } from './lib/records.mjs';

const { values } = parseArgs({ options: { data: { type: 'string' } } });
const dir = join(values.data, 'pending-uploads');
if (!existsSync(dir)) process.exit(0);
const expected = new Map();
for (const l of readFileSync(join(values.data, 'captures.jsonl'), 'utf8').split('\n')) {
  if (!l) continue;
  const s = JSON.parse(l).storage;
  if (s?.kind === 'release') expected.set(`${s.tag}/${s.asset}`, s.gz_sha256);
}
let bad = 0;
for (const tag of readdirSync(dir)) for (const name of readdirSync(join(dir, tag))) {
  const p = join(dir, tag, name);
  if (expected.get(`${tag}/${name}`) === sha256(readFileSync(p))) console.log(`${tag}\t${p}`);
  else { console.error(`not in the manifest or hash differs: ${tag}/${name}`); bad++; }
}
if (bad) process.exit(1);
