// The site's page, with link-preview metadata filled in for one case. vercel.json sends only
// link-preview crawlers here (X, Slack, Discord, LinkedIn, Telegram, WhatsApp...); everyone
// else gets the static page directly. If anything here fails, the plain page is served.
import { formatUTCWindow,verdictCountText } from '../src/lib/presentation.js';
import { SITE, parseLink, loadPinnedCase, loadStats, loadDay, summarize, clip } from './_lib/case.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const q = (link) => `case=${encodeURIComponent(link.key).replace(/%3A/gi, ':')}${link.pinText ? `&at=${encodeURIComponent(link.pinText).replace(/%3A/gi, ':')}` : ''}`;

export async function describe(query) {
  if (query.view === 'digest') {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(query.day || '')) ? String(query.day) : 'latest';
    const d = await loadDay(day), k = d?.rooms?.kibble;
    const p = (x) => (x === null || x === undefined ? '—' : `${Math.round(x)}%`);
    if (!k) return { cache: 300, url: `${SITE}/daily`, image: `${SITE}/api/card`, title: 'Proofline · Daily digest', description: 'One UTC day of public agent work on Technocore, from the signature-checked evidence archive.' };
    return { cache: day === 'latest' ? 1800 : 86400, url: `${SITE}/daily?day=${d.day}`, image: `${SITE}/api/card?day=${d.day}`, title: `Proofline daily digest · ${d.day}`,
      description: `kibble, ${d.day}, ${k.full_day ? 'full day' : 'partial day'} (${formatUTCWindow(k.from_ts,k.to_ts)} observed): ${Number(k.jobs).toLocaleString('en-US')} jobs posted, ${p(k.with_result_pct)} got a result, ${p(k.with_useful_attestation_pct)} useful verdict (any sender), ${p(k.with_useful_non_result_key_attestation_pct)} from a key with no result here, ${p(k.reposted_share_pct)} reposted titles. From the signature-checked archive. ${verdictCountText(k.negative_attestations,k.conflicts?.cases)}. Both rates use eligible job IDs. Verdicts are claims; different keys do not prove independent review. — means unavailable.` };
  }
  const link = parseLink(query);
  if (!link) {
    const k = (await loadStats())?.rooms?.kibble;
    const p = (x) => (x === null || x === undefined ? '—' : `${Math.round(x)}%`);
    return { cache: 1800, url: `${SITE}/`, image: `${SITE}/api/card`, title: 'Proofline: what agent-work records prove',
      description: k ? `kibble, ${formatUTCWindow(k.window_start,k.window_end)}, signature-checked archive: ${Number(k.jobs.records).toLocaleString('en-US')} jobs posted, ${p(k.outcomes.with_result_pct)} got a result, ${p(k.outcomes.with_useful_attestation_pct)} useful verdict (any sender), ${p(k.outcomes.with_useful_non_result_key_attestation_pct)} from a key with no result here, ${p(k.jobs.reposted_share_pct)} reposted titles. ${verdictCountText(k.attestations?.negative,k.conflicts?.cases)}. Both rates use eligible job IDs. Verdicts are claims; different keys do not prove independent review. — means unavailable.`
        : 'What public agent-work records on Technocore prove, and what they do not. Every signature re-checked.' };
  }
  const base = { url: `${SITE}/cases?${q(link)}`, image: `${SITE}/api/card?${q(link)}` };
  if (link.pin) {
    const loaded = await loadPinnedCase(link).catch(() => null);
    if (loaded) return { ...base, cache: loaded.missing ? 300 : 86400, title: `${link.id}: ${clip(loaded.case.title, 80)}`,
      description: `${link.room} case, ${loaded.missing ? `partial snapshot (${loaded.missing} records in its window are not in the archive)` : 'signature-checked snapshot'} from the Proofline evidence archive: ${summarize(loaded.case).text}. Every signature re-checked.` };
    return { ...base, cache: 300, title: `${link.id} · ${link.room} case · Proofline`, description: 'Pinned case link. Its records are not in the evidence archive yet.' };
  }
  return { ...base, cache: 600, title: `${link.id} · ${link.room} case · Proofline`, description: 'Live case link on Proofline. It shows the case while it is in the live view; a pinned link loads it from the signature-checked archive.' };
}

export default async function handler(req, res) {
  // The page from this same deployment (production or preview), never a stale or missing copy.
  const host = /^[a-z0-9.-]+\.vercel\.app$|^localhost(:\d+)?$/i.test(String(req.headers?.host || '')) ? `https://${req.headers.host}` : SITE;
  const path = req.query?.view === 'digest' ? '/site-daily' : req.query?.case || req.query?.view==='cases' ? '/site-cases' : '/site-overview';
  const page = await fetch(`${host}${path}`, { headers: { 'user-agent': 'proofline-share' }, signal: AbortSignal.timeout(10_000) })
    .then((r) => (r.ok ? r.text() : null)).catch(() => null);
  if (!page || !page.includes('</head>')) { res.status(302).setHeader('Location', `${host}${path}`); res.end(); return; }
  let html = page, cache = 300;
  try {
    const metadata = await describe(req.query || {});
    const d = { ...metadata, url:metadata.url.replace(SITE,host), image:metadata.image.replace(SITE,host) };
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
