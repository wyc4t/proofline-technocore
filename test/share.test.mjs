import test from 'node:test';
import assert from 'node:assert/strict';

const PAGE = '<!doctype html><html><head><title>Proofline · Live evidence graph</title><meta property="og:title" content="Proofline: default"><meta property="og:image" content="https://x/api/card"><meta property="og:image:width" content="1200"><meta name="twitter:image" content="https://x/api/card"></head><body></body></html>';
const STATS = { window_hours: 24, rooms: { kibble: { jobs: { records: 11975, reposted_share_pct: 18.9 }, outcomes: { with_result_pct: 75.1, with_useful_attestation_pct: 17.2 } } } };

async function run(query) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, status: 200, text: async () => (String(url).includes('stats/latest.json') ? JSON.stringify(STATS) : PAGE) });
  try {
    const { default: handler } = await import('../api/share.js');
    let out = {}; const headers = {};
    await handler({ query }, { setHeader: (k, v) => (headers[k] = v), status: (s) => ({ send: (b) => { out = { s, b }; } }), end() {} });
    return { ...out, headers };
  } finally { globalThis.fetch = real; }
}

test('site link: numbers in the description, default card tags replaced, sizes kept', async () => {
  const r = await run({});
  assert.equal(r.s, 200);
  assert.match(r.b, /<meta property="og:description" content="kibble, verified archive: 11,975 jobs posted, 75% got a result, 17% attested useful, 19% reposted titles/);
  assert.equal((r.b.match(/property="og:title"/g) || []).length, 1, 'the default og:title is replaced, not duplicated');
  assert.match(r.b, /og:image:width/);
});

test('live case link: escaped, with its own card image and canonical URL', async () => {
  const r = await run({ case: 'kibble:k123abc' });
  assert.match(r.b, /<title>k123abc · kibble case · Proofline<\/title>/);
  assert.match(r.b, /<meta property="og:image" content="https:\/\/proofline-technocore.vercel.app\/api\/card\?case=kibble:k123abc">/);
  assert.match(r.b, /<meta property="og:url" content="https:\/\/proofline-technocore.vercel.app\/\?case=kibble:k123abc">/);
});

test('malformed case parameters fall back to the site card', async () => {
  const r = await run({ case: '"><script>alert(1)</script>' });
  assert.doesNotMatch(r.b, /<script>alert/);
  assert.match(r.b, /<meta property="og:image" content="https:\/\/proofline-technocore.vercel.app\/api\/card">/);
});
