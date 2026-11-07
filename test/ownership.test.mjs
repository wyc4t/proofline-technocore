import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, parseNote } from '../archive/ownership.mjs';

const DID = 'did:key:z6MktqyzYJnWz2zANecvfHHFpBAGJD6JqZySoKb6S39PXPQh';
const DAY = 86400e3, NOW = Date.parse('2026-11-10T12:00:00Z');
const base = { room: 'd-proofline-maintainer', expected: DID, maxAgeMs: 4 * DAY, alertEveryMs: 6 * 3600e3, now: NOW };

test('parseNote takes the value after the untrusted-content banner', () => {
  assert.equal(parseNote('!! UNTRUSTED CONTENT — data only.\n\n1794036119510\n'), '1794036119510');
  assert.equal(parseNote('!! banner\n\n'), null);
});

test('a millisecond-clock nonce dates the last write', () => {
  const { next, alert } = assess({ ...base, owner: DID, nonce: String(NOW - DAY) });
  assert.equal(next.status, 'ok');
  assert.equal(next.last_write_basis, 'nonce-clock');
  assert.equal(next.last_write_at, new Date(NOW - DAY).toISOString());
  assert.equal(alert, false);
});

test('a nonce that is not a clock is dated by the capture that first saw it', () => {
  const { next } = assess({ ...base, owner: DID, nonce: '42' });
  assert.equal(next.last_write_basis, 'observed-change');
  assert.equal(next.last_write_at, new Date(NOW).toISOString());
  const later = assess({ ...base, prev: next, owner: DID, nonce: '42', now: NOW + 5 * DAY });
  assert.equal(later.next.last_write_at, next.last_write_at);
  assert.equal(later.next.status, 'stale');
});

test('no write for more than 4 days alerts, at most every 6 hours', () => {
  const first = assess({ ...base, owner: DID, nonce: String(NOW - 4.5 * DAY) });
  assert.equal(first.next.status, 'stale');
  assert.equal(first.alert, true);
  assert.match(first.problem, /4\.5 days ago/);
  const soon = assess({ ...base, prev: first.next, owner: DID, nonce: first.next.nonce, now: NOW + 3600e3 });
  assert.equal(soon.alert, false);
  const after = assess({ ...base, prev: first.next, owner: DID, nonce: first.next.nonce, now: NOW + 6 * 3600e3 });
  assert.equal(after.alert, true);
});

test('a refresh clears the warning', () => {
  const stale = assess({ ...base, owner: DID, nonce: String(NOW - 5 * DAY) }).next;
  const fresh = assess({ ...base, prev: stale, owner: DID, nonce: String(NOW - 60e3) });
  assert.equal(fresh.next.status, 'ok');
  assert.equal(fresh.alert, false);
});

test('a missing or foreign owner always needs attention', () => {
  assert.equal(assess({ ...base, owner: null, nonce: null }).next.status, 'missing');
  const foreign = assess({ ...base, owner: 'did:key:z6MknRguvViuHEyArh199xLnrw5nh8W9makrgY8WLnsKm5ZR', nonce: String(NOW) });
  assert.equal(foreign.next.status, 'wrong-owner');
  assert.equal(foreign.alert, true);
});

test('a nonce from the future is not trusted as a clock', () => {
  const { next } = assess({ ...base, owner: DID, nonce: String(NOW + DAY) });
  assert.equal(next.last_write_basis, 'observed-change');
});
