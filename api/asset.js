// Read-only proxy for the evidence archive's release files.
// Browsers cannot read GitHub release downloads directly (the redirect carries no CORS
// header), so the app asks this function instead. It serves only files named like the
// archive's own, from this repository only, unchanged. The browser then checks every
// file against the archive's manifest hash and re-verifies every signature, so this
// function cannot alter what is shown without the change being detected.
//
//   GET /api/asset?tag=kibble-2026-10-20&asset=kibble-g0-19918961-19920466.jsonl.gz

export const REPO = 'wyc4t/proofline-technocore';
const TAG = /^([a-z0-9][a-z0-9_-]{0,47})-(\d{4}-\d{2}-\d{2})$/;
const ASSET = /^([a-z0-9][a-z0-9_-]{0,47})-g(\d{1,6})(?:-e(\d{1,6}))?-(\d{1,19})-(\d{1,19})\.jsonl\.gz$/;
const MAX_BYTES = 4_400_000; // Vercel's response limit is 4.5 MB

export function validate(tag, asset) {
  const t = TAG.exec(String(tag ?? '')), a = ASSET.exec(String(asset ?? ''));
  if (!t || !a) return 'tag or asset name is not an archive file name';
  if (t[1] !== a[1]) return 'asset does not belong to that room';
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).send('GET only'); return; }
  const { tag, asset } = req.query || {};
  const problem = validate(tag, asset);
  if (problem) { res.status(400).send(problem); return; }
  let upstream;
  try {
    upstream = await fetch(`https://github.com/${REPO}/releases/download/${tag}/${asset}`, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  } catch { res.status(502).send('GitHub did not answer'); return; }
  if (upstream.status === 404) { res.status(404).send('no such archive file'); return; }
  if (!upstream.ok) { res.status(502).send(`GitHub returned ${upstream.status}`); return; }
  const body = Buffer.from(await upstream.arrayBuffer());
  if (body.length > MAX_BYTES) { res.status(413).send('archive file too large to serve here; download it from the release page'); return; }
  res.setHeader('Content-Type', 'application/gzip');
  // Archive files never change: each name is a fixed sequence range.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.status(200).send(body);
}
