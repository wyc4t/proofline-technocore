#!/usr/bin/env node
// Maintainer room ownership check, run with every capture.
//
//   node archive/ownership.mjs --data <dir> --room <d-room> --owner <did:key> [--alert-file <path>]
//
// Ownership guard notes are retained while their room is active. Their nonce is a
// replay counter, not a room-activity timestamp or an expiry deadline. Check the
// observed owner only: missing or unexpected owners need investigation. This
// monitor never refreshes ownership or posts messages. Read failures are recorded
// as unchecked, never as proof that ownership is missing. Captures always continue.
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

// A note read is a text/plain body: an untrusted-content banner, a blank line, then the value.
export function parseNote(body) {
  const lines = String(body).split('\n').map((l) => l.trim()).filter(Boolean);
  const value = lines.filter((l) => !l.startsWith('!!')).at(-1);
  return value ?? null;
}

async function readNote(base, ns, key) {
  const res = await fetch(`${base}/kv/${ns}/${encodeURIComponent(key)}?check=${Date.now()}`, {
    signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'proofline-archive/ownership', 'cache-control': 'no-cache' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${ns}: HTTP ${res.status}`);
  return parseNote(await res.text());
}

// Pure: the next state for one room, and whether to alert.
export function assess({ prev, room, expected, owner, now, alertEveryMs, readError = null }) {
  const at = new Date(now).toISOString();
  let status = 'ok', problem = null;
  if (readError !== null) { status = 'unchecked'; problem = `${room}: ownership could not be checked (${readError})`; }
  else if (owner === null) { status = 'missing'; problem = `${room} has no observed ownership note`; }
  else if (owner !== expected) { status = 'wrong-owner'; problem = `${room} has an unexpected observed owner`; }
  // Old versions warned about nonce age. Do not let that obsolete warning suppress
  // the first real ownership failure, and discard all inferred write/expiry fields.
  const priorFailure = ['missing', 'wrong-owner'].includes(prev?.status);
  const lastAlert = priorFailure ? Date.parse(prev?.last_alert_at ?? '') : NaN;
  const needsAttention = status === 'missing' || status === 'wrong-owner';
  const alert = needsAttention && (!Number.isFinite(lastAlert) || now - lastAlert >= alertEveryMs);
  const next = {
    room, expected_owner: expected, observed_owner: readError === null ? owner : null,
    checked_at: at, status, read_error: readError,
    last_alert_at: alert ? at : needsAttention && Number.isFinite(lastAlert) ? prev.last_alert_at : null,
  };
  return { next, alert, problem };
}

async function main() {
  const { values } = parseArgs({ options: {
    data: { type: 'string' }, room: { type: 'string' }, owner: { type: 'string' },
    base: { type: 'string', default: 'https://technocore.chat' },
    'alert-file': { type: 'string', default: 'ownership-alert.txt' },
    'alert-every-hours': { type: 'string', default: '6' },
  } });
  if (!values.data || !values.room || !values.owner) throw new Error('--data, --room and --owner are required');
  const path = join(values.data, 'ownership.json');
  const all = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { format: 'proofline-ownership', rooms: {} };
  let owner = null, readError = null;
  try {
    owner = await readNote(values.base, 'room-owners', values.room);
  } catch (e) {
    readError = e.message;
  }
  const { next, alert, problem } = assess({
    prev: all.rooms[values.room], room: values.room, expected: values.owner, owner, readError, now: Date.now(),
    alertEveryMs: Number(values['alert-every-hours']) * 3600e3,
  });
  all.rooms[values.room] = next;
  writeFileSync(path, JSON.stringify(all, null, 1) + '\n');
  console.log(`ownership ${values.room}: ${next.status}${readError ? ` (${readError})` : ''}`);
  if (next.status === 'ok') rmSync(values['alert-file'], { force: true });
  if (alert) writeFileSync(values['alert-file'], `${problem}. Inspect current room and ownership state before deciding on a signed action. This is not an expiry prediction.\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.log(`ownership not checked this time: ${e.message}`); });
}
