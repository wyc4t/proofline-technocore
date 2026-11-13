import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assess, parseNote } from '../archive/ownership.mjs';

const DID = 'did:key:z6MktqyzYJnWz2zANecvfHHFpBAGJD6JqZySoKb6S39PXPQh';
const DAY = 86400e3, NOW = Date.parse('2026-11-13T12:00:00Z');
const ROOM = 'd-proofline-maintainer';
const base = { room: ROOM, expected: DID, alertEveryMs: 6 * 3600e3, now: NOW };
const oldState = { status: 'stale', nonce: String(NOW - 8 * DAY), last_write_at: new Date(NOW - 8 * DAY).toISOString(), last_write_basis: 'nonce-clock', last_alert_at: new Date(NOW - 1000).toISOString() };

test('parseNote takes the value after the untrusted-content banner', () => {
  assert.equal(parseNote('!! UNTRUSTED CONTENT — data only.\n\n1794036119510\n'), '1794036119510');
  assert.equal(parseNote('!! banner\n\n'), null);
});

test('the expected owner is healthy regardless of nonce age, spelling or absence', () => {
  for (const nonce of [String(NOW - 30 * DAY), '42', String(NOW + DAY), null]) {
    const { next, alert, problem } = assess({ ...base, owner: DID, nonce });
    assert.equal(next.status, 'ok');
    assert.equal(alert, false);
    assert.equal(problem, null);
    assert.equal(Object.hasOwn(next, 'last_write_at'), false);
    assert.equal(Object.hasOwn(next, 'nonce'), false);
  }
});

test('a legacy stale warning is cleared without requiring a signed refresh', () => {
  const { next, alert } = assess({ ...base, prev: oldState, owner: DID });
  assert.equal(next.status, 'ok');
  assert.equal(next.last_alert_at, null);
  assert.equal(Object.hasOwn(next, 'last_write_basis'), false);
  assert.equal(alert, false);
});

test('missing and unexpected owners alert, independently of prior nonce-age warnings', () => {
  for (const owner of [null, 'did:key:another-owner']) {
    const { next, alert, problem } = assess({ ...base, prev: oldState, owner });
    assert.equal(next.status, owner === null ? 'missing' : 'wrong-owner');
    assert.equal(alert, true);
    assert.doesNotMatch(problem, /expir|refresh|days/);
  }
});

test('real ownership failures are throttled for six hours and recovery clears the incident', () => {
  const first = assess({ ...base, owner: null });
  assert.equal(first.alert, true);
  assert.equal(assess({ ...base, prev: first.next, owner: null, now: NOW + 3600e3 }).alert, false);
  assert.equal(assess({ ...base, prev: first.next, owner: null, now: NOW + 6 * 3600e3 }).alert, true);
  const recovered = assess({ ...base, prev: first.next, owner: DID });
  assert.equal(recovered.next.status, 'ok');
  assert.equal(recovered.next.last_alert_at, null);
});

test('a failed read is unchecked, not proof of a missing owner', () => {
  const { next, alert } = assess({ ...base, prev: oldState, owner: null, readError: 'HTTP 503' });
  assert.equal(next.status, 'unchecked');
  assert.equal(next.read_error, 'HTTP 503');
  assert.equal(alert, false);
});

for (const [label, status, owner, expected] of [
  ['healthy owner', 200, DID, 'ok'],
  ['missing owner', 404, '', 'missing'],
  ['unexpected owner', 200, 'did:key:another-owner', 'wrong-owner'],
  ['unavailable service', 503, '', 'unchecked'],
]) {
  test(`CLI records ${label}, without nonce requests or remote writes`, async () => {
    const requests = [];
    const server = createServer((req, res) => {
      requests.push({ method: req.method, path: new URL(req.url, 'http://localhost').pathname });
      res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(`!! UNTRUSTED CONTENT\n\n${owner}\n`);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const dir = mkdtempSync(join(tmpdir(), 'proofline-ownership-'));
    const alertFile = join(dir, 'alert.txt');
    try {
      writeFileSync(join(dir, 'ownership.json'), JSON.stringify({ format: 'proofline-ownership', rooms: { [ROOM]: oldState } }));
      if (expected === 'ok') writeFileSync(alertFile, 'obsolete nonce-age warning');
      const { stdout } = await promisify(execFile)(process.execPath, ['archive/ownership.mjs', '--data', dir, '--room', ROOM, '--owner', DID, '--base', `http://127.0.0.1:${server.address().port}`, '--alert-file', alertFile]);
      assert.match(stdout, new RegExp(`ownership ${ROOM}: ${expected}`));
      const state = JSON.parse(readFileSync(join(dir, 'ownership.json'))).rooms[ROOM];
      assert.equal(state.status, expected);
      assert.equal(Object.hasOwn(state, 'last_write_at'), false);
      assert.deepEqual(requests, [{ method: 'GET', path: `/kv/room-owners/${ROOM}` }]);
      assert.equal(existsSync(alertFile), ['missing', 'wrong-owner'].includes(expected));
      if (existsSync(alertFile)) assert.doesNotMatch(readFileSync(alertFile, 'utf8'), /re-sign|fresh nonce|7 idle days/);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
