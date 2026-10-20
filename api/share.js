// The site's page, with link-preview metadata filled in for one case. vercel.json sends only
// link-preview crawlers here (X, Slack, Discord, LinkedIn, Telegram, WhatsApp...); everyone
// else gets the static page directly. If anything here fails, the plain page is served.
import { SITE, parseLink, loadPinnedCase, loadStats, summarize, clip } from './_lib/case.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const q = (link) => `case=${encodeURIComponent(link.key).replace(/%3A/gi, ':')}${link.pinText ? `&at=${encodeURIComponent(link.pinText).replace(/%3A/gi, ':')}` : ''}`;

export async function describe(query) {
  const link = parseLink(query);
  if (!link) {
    const k = (await loadStats())?.rooms?.kibble;
    const p = (x) => (x === null || x === undefined ? '?' : `${Math.round(x)}%`);
    return { cache: 1800, url: `${SITE}/`, image: `${SITE}/api/card`, title: 'Proofline: what agent-work records prove',
      description: k ? `kibble, verified archive: ${Number(k.jobs.records).toLocaleString('en-US')} jobs posted, ${p(k.outcomes.with_result_pct)} got a result, ${p(k.outcomes.with_useful_attestation_pct)} attested useful, ${p(k.jobs.reposted_share_pct)} reposted titles. Every signature re-checked.`
        : 'What public agent-work records on Technocore prove, and what they do not. Every signature re-checked.' };
  }
  const base = { url: `${SITE}/?${q(link)}`, image: `${SITE}/api/card?${q(link)}` };
  if (link.pin) {
    const loaded = await loadPinnedCase(link).catch(() => null);
    if (loaded) return { ...base, cache: 86400, title: `${link.id}: ${clip(loaded.case.title, 80)}`,
      description: `${link.room} case, verified snapshot from the Proofline evidence archive: ${summarize(loaded.case).text}. Every signature re-checked.` };
    return { ...base, cache: 300, title: `${link.id} · ${link.room} case · Proofline`, description: 'Pinned case link. Its records are not in the evidence archive yet.' };
  }
  return { ...base, cache: 600, title: `${link.id} · ${link.room} case · Proofline`, description: 'Live case link on Proofline. It shows the case while it is in the live view; a pinned link loads it from the verified archive.' };
}

export default async function handler(req, res) {
  const page = await fetch(`${SITE}/`, { headers: { 'user-agent': 'proofline-share' }, signal: AbortSignal.timeout(10_000) }).then((r) => r.text()).catch(() => null);
  if (!page) { res.status(302).setHeader('Location', `${SITE}/`); res.end(); return; }
  let html = page, cache = 300;
  try {
    const d = await describe(req.query || {});
    cache = d.cache;
    const tags = [
      ['og:url', d.url], ['og:title', d.title], ['og:description', d.description], ['og:image', d.image],
    ].map(([p, v]) => `<meta property="${p}" content="${esc(v)}">`).join('') +
      `<meta name="twitter:title" content="${esc(d.title)}"><meta name="twitter:description" content="${esc(d.description)}"><meta name="twitter:image" content="${esc(d.image)}">`;
    // Drop the page's default card tags, then add this case's.
    html = html.replace(/<meta (property="og:(url|title|description|image)"|name="twitter:(title|description|image)") content="[^"]*">/g, '')
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(d.title)}</title>`)
      .replace('</head>', `${tags}</head>`);
  } catch { /* serve the plain page */ }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', `public, max-age=60, s-maxage=${cache}`);
  res.status(200).send(html);
}
