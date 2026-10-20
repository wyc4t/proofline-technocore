import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaims, checkRequest, compareClaim } from '../src/lib/claims.js';
import { reproduce } from '../archive/reproduce.mjs';

test('claims are parsed from the formats agents use', () => {
  const c = parseClaims("GET https://technocore.chat/r/lobby?format=json&limit=0&n=1788388462975 -> HTTP 200 count=1 range=19622445..19622445 sha=7ebe8db5a1f1 GET /llms.txt -> HTTP 200 Cache-Control='public, max-age=0, s-maxage=300, stale-while-revalidate=60' bytes=24048 GET /healthz -> HTTP 200 body_sha=dc51b8c96c2d bytes=3 GET limit=201 -> HTTP 200 count=200 (ceiling check)");
  assert.deepEqual(c.map((x) => x.target), ['/r/lobby?format=json&limit=0&n=1788388462975', '/llms.txt', '/healthz', '/r/lobby?format=json&limit=201&n=1788388462975']);
  assert.deepEqual(c[0].props, { status: 200, count: 1, range: '19622445..19622445', sha: '7ebe8db5a1f1' });
  assert.equal(c[1].props.cacheControl, 'public, max-age=0, s-maxage=300, stale-while-revalidate=60');
  assert.deepEqual(c[2].props, { status: 200, bodySha: 'dc51b8c96c2d', bytes: 3 });
  assert.deepEqual(parseClaims("GET /healthz → HTTP 200 body='ok'.")[0].props, { status: 200, body: 'ok' });
  assert.equal(parseClaims('GET /r/lobby?format=json&limit=0 -> HTTP None count=None').length, 0, 'a failed run is not a claim');
  const kv = parseClaims('GET /kv/agentscout/top -> HTTP 200, 1784 bytes, asof=2026-10-03T06:01Z. First fingerprint in top: 37773027f5c0117e (score=80)')[0];
  assert.deepEqual(kv.props, { status: 200, bytes: 1784, asof: '2026-10-03T06:01Z', fingerprint: '37773027f5c0117e' });
});

test('only read-only allowlisted requests may be run', () => {
  for (const [t, why] of [['/r/lobby/say/proofline/hello', /writes/], ['/kv/agentscout/top/set/x', /writes/], ['/kv/room-owners/d-x/set-signed/a/b/c/d', /writes/], ['/kv/lobby/hb-me/set/5', /writes/],
    ['.../r/p-1/say/...', /writes/], ['/r/%2E%2E%2Fconfig', /encoded/], ['/r/../healthz', /encoded/], ['/r/lobby?format=json&limit=1&wait=30', /long-poll/], ['/r/lobby?if_absent=1', /parameter/],
    ['/mcp', /allowlist/], ['https://evil.example/healthz', /incomplete/], ['/r/lobby/export', /allowlist/], ['/r/lobby?limit=5000', /above 1000/]]) assert.match(checkRequest(t).reason || 'ALLOWED', why, t);
  assert.equal(checkRequest('/r/lobby?format=json&limit=0&n=123').url, 'https://technocore.chat/r/lobby?format=json&limit=0', 'the cache-buster is dropped');
  assert.equal(checkRequest('/kv/agentscout/digest-latest').ok, true);
});

test('stable properties are compared at any age; state only when fresh; room contents never', () => {
  const obs = { observed_at: '2026-10-20T15:00:00Z', status: 200, count: 200, bytes: 70000, sha256: 'ab'.repeat(32), first_seq: 1, last_seq: 200, headers: {} };
  const r = compareClaim({ target: '/r/lobby?format=json&limit=201', props: { status: 200, count: 201, sha: 'cdcdcdcdcdcd' } }, obs, { claimedAt: '2026-09-02T00:00:00Z', observedAt: obs.observed_at });
  assert.deepEqual(r.map((p) => p.outcome), ['reproduced', 'differs', 'not comparable']);
  assert.match(r[1].note, /may have changed/);
  const note = { observed_at: '2026-10-21T08:30:00Z', status: 200, bytes: 1755, sha256: 'x', asof: '2026-10-21T06:01Z', fingerprints: ['37773027f5c0117e'], headers: {} };
  const claim = { target: '/kv/agentscout/top', props: { status: 200, asof: '2026-10-21T06:01Z', fingerprint: '37773027f5c0117e' } };
  assert.deepEqual(compareClaim(claim, note, { claimedAt: '2026-10-21T08:05:00Z', observedAt: note.observed_at }).map((p) => p.outcome), ['reproduced', 'reproduced', 'reproduced']);
  assert.deepEqual(compareClaim(claim, note, { claimedAt: '2026-10-03T08:05:00Z', observedAt: note.observed_at }).map((p) => p.outcome), ['reproduced', 'not comparable', 'not comparable']);
});

test('the runner never requests a write, requests each URL once, and records the server version', async () => {
  const called = [];
  const fakeFetch = async (url) => { called.push(url); const body = url.endsWith('/openapi.json') ? '{"info":{"version":"0.11.4"}}' : url.endsWith('/healthz') ? 'ok\n' : '{"count":1}';
    return new Response(body, { status: 200, headers: { 'content-type': url.endsWith('/healthz') ? 'text/plain' : 'application/json', 'cache-control': 'public, max-age=0' } }); };
  const items = [{ source: { control: 'x' }, claimedAt: '2026-10-20T15:00:00Z', claims: parseClaims("GET /r/lobby/say/proofline/hello -> HTTP 200 GET /kv/a/b/set/c -> HTTP 200 GET /healthz -> HTTP 200 body='ok' GET /healthz -> HTTP 200 GET /r/lobby?format=json&limit=1&wait=30 -> HTTP 200 GET /r/lobby?format=json&limit=0 -> HTTP 200 count=0") }];
  const run = await reproduce(items, { fetchImpl: fakeFetch, sleep: async () => {} });
  assert.deepEqual(called, ['https://technocore.chat/openapi.json', 'https://technocore.chat/healthz', 'https://technocore.chat/r/lobby?format=json&limit=0']);
  assert.equal(run.server_version, '0.11.4');
  const outcomes = run.items[0].claims.map((c) => c.comparison.map((p) => `${p.name}:${p.outcome}`).join(','));
  assert.deepEqual(outcomes, ['status:not run', 'status:not run', 'status:reproduced,body:reproduced', 'status:reproduced', 'status:not run', 'status:reproduced,count:differs']);
});
