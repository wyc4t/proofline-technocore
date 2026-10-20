// Link-preview image (1200x630 PNG), referenced by the page metadata that /api/share serves
// to link-preview crawlers.
//   /api/card                                   site card with the archive's 24-hour numbers
//   /api/card?case=kibble:k123&at=g0:100-140    pinned case, loaded and verified from the archive
//   /api/card?case=kibble:k123                  live case link (no data: the live view moves on)
// Pinned to @vercel/og 0.11.1: 1.0.x's Node build cannot load as an ES module (it calls require()).
import { ImageResponse } from '@vercel/og';
import { parseLink, loadPinnedCase, loadStats, loadDay, summarize, clip } from './_lib/case.js';

const C = { bg: '#05070a', panel: '#0d1219', line: '#202935', text: '#e5ebf2', muted: '#8696a8', acid: '#d7ff55', blue: '#65bfff', amber: '#ffbe5c', green: '#67e8a5' };
const STAGE_COLOR = [C.acid, C.blue, C.amber, C.green];

// Minimal element builder for the image renderer (React-element shaped objects).
const h = (style, ...children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: children.flat().filter((x) => x !== null && x !== undefined && x !== false) } });

function frame(tag, body, footerLeft) {
  return h({ width: '100%', height: '100%', flexDirection: 'column', background: C.bg, color: C.text, padding: '56px 64px', fontSize: 28 },
    h({ alignItems: 'center', justifyContent: 'space-between' },
      h({ alignItems: 'center', gap: 18 },
        h({ width: 56, height: 56, background: C.acid, color: '#090b05', fontSize: 26, alignItems: 'center', justifyContent: 'center' }, 'P/'),
        h({ fontSize: 30, letterSpacing: 6 }, 'PROOFLINE')),
      h({ fontSize: 20, letterSpacing: 3, color: tag.color, border: `2px solid ${tag.color}`, borderRadius: 40, padding: '8px 20px' }, tag.text)),
    h({ flexDirection: 'column', flexGrow: 1, justifyContent: 'center' }, body),
    h({ justifyContent: 'space-between', color: C.muted, fontSize: 20, borderTop: `1px solid ${C.line}`, paddingTop: 20 },
      h({}, footerLeft || 'Every signature re-checked · not an official FLOP Labs product'),
      h({}, 'proofline-technocore.vercel.app')));
}

function pinnedCard(link, loaded) {
  const c = loaded.case, s = summarize(c), seqs = c.list.map((r) => r.seq);
  const stageRow = h({ gap: 14, marginTop: 34 },
    s.stages.map((st, i) => h({ flexDirection: 'column', flexGrow: 1, flexBasis: 0, gap: 10 },
      h({ height: 14, background: st.n ? STAGE_COLOR[i] : 'transparent', border: `2px solid ${st.n ? STAGE_COLOR[i] : '#55657a'}` }),
      h({ fontSize: 19, letterSpacing: 2, color: st.n ? C.text : C.muted }, `${st.name.toUpperCase()}${st.n > 1 ? ` ×${st.n}` : ''}`))));
  return frame({ text: 'VERIFIED ARCHIVE SNAPSHOT', color: C.blue },
    [h({ fontSize: 22, color: C.muted, letterSpacing: 3 }, `${link.room.toUpperCase()} · CASE`),
      h({ fontSize: 68, marginTop: 6 }, link.id),
      h({ fontSize: 30, color: '#aeb9c7', marginTop: 10, lineHeight: 1.3 }, clip(c.title, 110)),
      stageRow,
      h({ fontSize: 24, color: s.sig.invalid ? '#ff6678' : '#c3cdd9', marginTop: 28 }, s.text),
      loaded.missing ? h({ fontSize: 22, color: C.amber, marginTop: 12 }, `Partial: ${loaded.missing} ${loaded.missing === 1 ? 'record' : 'records'} in this window ${loaded.missing === 1 ? 'is' : 'are'} not in the archive`) : null],
    `records #${Math.min(...seqs)}–#${Math.max(...seqs)} · checked against the archive`);
}

function liveCard(link) {
  return frame({ text: 'LIVE CASE LINK', color: C.amber },
    [h({ fontSize: 22, color: C.muted, letterSpacing: 3 }, `${link.room.toUpperCase()} · CASE`),
      h({ fontSize: 68, marginTop: 6 }, link.id),
      h({ fontSize: 28, color: '#aeb9c7', marginTop: 18, lineHeight: 1.35 }, 'Opens this case while it is in the live view. A pinned link loads it from the verified archive at any time.')]);
}

function siteCard(stats) {
  const k = stats?.rooms?.kibble;
  const n = (x) => (x === null || x === undefined ? '—' : Number(x).toLocaleString('en-US')), p = (x) => (x === null || x === undefined ? '—' : `${Math.round(x)}%`);
  const span = k?.span_minutes ?? 0, full = stats && span >= stats.window_hours * 60 - 30;
  const nums = [['JOBS POSTED', n(k?.jobs?.records)], ['GOT A RESULT', p(k?.outcomes?.with_result_pct)], ['ATTESTED USEFUL', p(k?.outcomes?.with_useful_not_self_pct ?? k?.outcomes?.with_useful_attestation_pct)], ['REPOSTED TITLES', p(k?.jobs?.reposted_share_pct)]];
  return frame({ text: 'VERIFIED ARCHIVE', color: C.acid },
    [h({ fontSize: 46, lineHeight: 1.2 }, 'What public agent-work records on Technocore prove, and what they do not.'),
      k ? h({ gap: 18, marginTop: 40 }, nums.map(([label, v]) => h({ flexDirection: 'column', flexGrow: 1, flexBasis: 0, background: C.panel, border: `1px solid ${C.line}`, padding: '18px 22px' },
        h({ fontSize: 17, letterSpacing: 2, color: C.muted }, label), h({ fontSize: 52, marginTop: 6 }, v)))) : null,
      k ? h({ fontSize: 21, color: C.acid, marginTop: 20, letterSpacing: 1 }, `kibble · ${full ? 'last 24 h' : `last ${Math.floor(span / 60)} h ${span % 60} min`} · ${k.complete ? 'no gaps' : 'has gaps'} · ${n(k.signatures?.valid)} signatures re-checked`) : null]);
}

function dayCard(d) {
  const k = d.rooms.kibble;
  const n = (x) => (x === null || x === undefined ? '—' : Number(x).toLocaleString('en-US')), p = (x) => (x === null || x === undefined ? '—' : `${Math.round(x)}%`);
  const hm = (t) => (t ? String(t).slice(11, 16) : '?');
  const nums = [['JOBS POSTED', n(k.jobs)], ['GOT A RESULT', p(k.with_result_pct)], ['ATTESTED USEFUL', p(k.with_useful_not_self_pct ?? k.with_useful_attestation_pct)], ['REPOSTED TITLES', p(k.reposted_share_pct)]];
  return frame({ text: k.full_day ? 'FULL DAY · NO GAPS' : `PARTIAL DAY · ${hm(k.from_ts)}–${hm(k.to_ts)} UTC`, color: k.full_day ? C.green : C.amber },
    [h({ fontSize: 22, color: C.muted, letterSpacing: 3 }, 'KIBBLE · DAILY DIGEST'),
      h({ fontSize: 64, marginTop: 6 }, d.day),
      h({ gap: 18, marginTop: 30 }, nums.map(([label, v]) => h({ flexDirection: 'column', flexGrow: 1, flexBasis: 0, background: C.panel, border: `1px solid ${C.line}`, padding: '18px 22px' },
        h({ fontSize: 17, letterSpacing: 2, color: C.muted }, label), h({ fontSize: 52, marginTop: 6 }, v)))),
      h({ fontSize: 21, color: '#c3cdd9', marginTop: 20 }, `${n(k.job_ids)} job IDs · ${n(k.requester_keys)} requester keys · ${n(k.records)} records, every signature re-checked`)],
    'From the verified evidence archive · not an official FLOP Labs product');
}

export default async function handler(req, res) {
  const link = parseLink(req.query);
  let element, maxAge = 1800;
  try {
    if (req.query?.day) {
      const d = await loadDay(String(req.query.day));
      if (d?.rooms?.kibble) { element = dayCard(d); maxAge = req.query.day === 'latest' ? 1800 : 86400; }
      else { element = siteCard(await loadStats()); maxAge = 300; }
    } else if (link?.pin) {
      const loaded = await loadPinnedCase(link);
      // A complete archived window never changes, so its card can be cached for good; a partial one may
      // still be filled by a later capture, so it is looked at again soon.
      if (loaded) { element = pinnedCard(link, loaded); maxAge = loaded.missing ? 300 : 31536000; }
      else { element = liveCard(link); maxAge = 300; }                        // not archived yet: look again soon
    } else if (link) element = liveCard(link);
    else element = siteCard(await loadStats());
  } catch { element = siteCard(await loadStats()); maxAge = 300; }
  const img = new ImageResponse(element, { width: 1200, height: 630 });
  const buf = Buffer.from(await img.arrayBuffer());
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', `public, max-age=300, s-maxage=${maxAge}`);
  res.status(200).send(buf);
}
