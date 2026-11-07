#!/usr/bin/env node
// Maintainer room ownership check, run with every capture.
//
//   node archive/ownership.mjs --data <dir> --room <d-room> --owner <did:key> [--alert-file <path>]
//
// A Technocore ownership note (/kv/room-owners/<room>) is deleted after 7 days without a
// write, and once it is gone the room can never be claimed again (the server refuses a claim
// on any room that has ever held a message). The maintainer's own agent refreshes the note
// daily; this check notices when that refresh has stopped, while there is still time to act.
//
// It reads two public notes, read-only: the owner, and the server's replay counter
// /kv/room-nonce/<room>, which changes on every signed ownership write. The time of the last
// write is the nonce itself when it reads as a millisecond clock (the maintainer's signer uses
// one), otherwise the first capture that saw the new value. The result is kept in
// <data>/ownership.json. When the owner is missing or wrong, or the last write is older than
// --max-age-days (default 4), it writes --alert-file, at most once per --alert-every-hours
// (default 6); the workflow's last step fails on that file, so GitHub sends the usual
// failed-run notice. This script itself always exits 0: it must never block a capture.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const CLOCK_FLOOR = Date.parse('2026-01-01T00:00:00Z');

// A note read is a text/plain body: an untrusted-content banner, a blank line, then the value.
export function parseNote(body) {
  const lines = String(body).split('\n').map((l) => l.trim()).filter(Boolean);
  const value = lines.filter((l) => !l.startsWith('!!')).at(-1);
  return value ?? null;
}

async function readNote(base, ns, key) {
  const res = await fetch(`${base}/kv/${ns}/${encodeURIComponent(key)}`, {
    signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'proofline-archive/ownership' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${ns}: HTTP ${res.status}`);
  return parseNote(await res.text());
}

// Pure: the next state for one room, and whether to alert.
export function assess({ prev, room, expected, owner, nonce, now, maxAgeMs, alertEveryMs }) {
  const at = new Date(now).toISOString();
  let lastWriteAt = prev?.last_write_at ?? null, basis = prev?.last_write_basis ?? null;
  if (nonce !== null && nonce !== (prev?.nonce ?? null)) {
    const n = Number(nonce);
    if (/^\d{13}$/.test(nonce) && n >= CLOCK_FLOOR && n <= now + 10 * 60e3) { lastWriteAt = new Date(n).toISOString(); basis = 'nonce-clock'; }
    else { lastWriteAt = at; basis = 'observed-change'; }
  }
  const ageMs = lastWriteAt ? now - Date.parse(lastWriteAt) : null;
  let status = 'ok', problem = null;
  if (owner === null) { status = 'missing'; problem = `${room} has no ownership note`; }
  else if (owner !== expected) { status = 'wrong-owner'; problem = `${room} is owned by ${owner}, not the maintainer key`; }
  else if (ageMs === null || ageMs > maxAgeMs) {
    status = 'stale';
    problem = ageMs === null ? `${room}: time of the last ownership write is unknown`
      : `${room}: last ownership write ${(ageMs / 86400e3).toFixed(1)} days ago; the note is deleted after 7 days without a write`;
  }
  const lastAlert = prev?.last_alert_at ? Date.parse(prev.last_alert_at) : 0;
  const alert = status !== 'ok' && now - lastAlert >= alertEveryMs;
  const next = {
    room, expected_owner: expected, observed_owner: owner, nonce, last_write_at: lastWriteAt,
    last_write_basis: basis, checked_at: at, status, last_alert_at: alert ? at : (prev?.last_alert_at ?? null),
  };
  return { next, alert, problem };
}

async function main() {
  const { values } = parseArgs({ options: {
    data: { type: 'string' }, room: { type: 'string' }, owner: { type: 'string' },
    base: { type: 'string', default: 'https://technocore.chat' },
    'alert-file': { type: 'string', default: 'ownership-alert.txt' },
    'max-age-days': { type: 'string', default: '4' }, 'alert-every-hours': { type: 'string', default: '6' },
  } });
  if (!values.data || !values.room || !values.owner) throw new Error('--data, --room and --owner are required');
  const path = join(values.data, 'ownership.json');
  const all = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { format: 'proofline-ownership', rooms: {} };
  let owner, nonce;
  try {
    [owner, nonce] = await Promise.all([readNote(values.base, 'room-owners', values.room), readNote(values.base, 'room-nonce', values.room)]);
  } catch (e) {
    console.log(`ownership not checked this time: ${e.message}`);
    return;
  }
  const { next, alert, problem } = assess({
    prev: all.rooms[values.room], room: values.room, expected: values.owner, owner, nonce, now: Date.now(),
    maxAgeMs: Number(values['max-age-days']) * 86400e3, alertEveryMs: Number(values['alert-every-hours']) * 3600e3,
  });
  all.rooms[values.room] = next;
  writeFileSync(path, JSON.stringify(all, null, 1) + '\n');
  console.log(`ownership ${values.room}: ${next.status}${next.last_write_at ? `, last write ${next.last_write_at}` : ''}`);
  const action = next.status === 'stale'
    ? `Refresh it from the maintainer's agent: re-sign /kv/room-owners/${values.room} with a fresh nonce.`
    : 'A room that has held messages cannot be claimed again, so this needs the maintainer to decide what happens next.';
  if (alert) writeFileSync(values['alert-file'], `${problem}. ${action}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.log(`ownership not checked this time: ${e.message}`); });
}
