// Server-side helpers for link previews. Files under api/_lib are not routes.
// A pinned case is loaded exactly as the browser loads it (src/lib/snapshot.js): every archive
// file is checked against its manifest hash and every signature is re-verified.
import { loadPinned, parsePin, ARCHIVE_RAW } from '../../src/lib/snapshot.js';
import { parseRoomPage, annotateSignatures } from '../../src/lib/signature.js';
import { parseMessage } from '../../src/lib/protocol.js';
import { buildCases } from '../../src/lib/cases.js';

export const SITE = 'https://proofline-technocore.vercel.app';
const REPO = 'wyc4t/proofline-technocore';
const KEY = /^([a-z0-9][a-z0-9_-]{0,47}):([\w-]{1,64})$/;

async function get(url, as) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${url} returned ${r.status}`);
  return as === 'text' ? r.text() : new Uint8Array(await r.arrayBuffer());
}

export function parseLink(query = {}) {
  const m = KEY.exec(String(query.case ?? ''));
  if (!m) return null;
  return { key: `${m[1]}:${m[2]}`, room: m[1], id: m[2], pinText: query.at ? String(query.at) : null, pin: query.at ? parsePin(query.at) : null };
}

// Returns { case, records, captures, missing } for a pinned link, or null if nothing is archived.
export async function loadPinnedCase({ room, id, pin }) {
  if (!pin) return null;
  const res = await loadPinned({
    room, gen: pin.gen, from: pin.from, to: pin.to,
    fetchText: (u) => get(`${u}?t=${Math.floor(Date.now() / 60e3)}`, 'text'),
    fetchBytes: (u) => get(u, 'bytes'),
    assetUrl: (tag, asset) => `https://github.com/${REPO}/releases/download/${tag}/${asset}`,
  });
  const dec = new TextDecoder();
  const msgs = res.lines.map((l) => parseRoomPage(dec.decode(l)));
  await annotateSignatures(room, msgs);
  const recs = msgs.map((m) => parseMessage(m, room)).filter((p) => p.ok).map((p) => p.record).filter((r) => r.id === id);
  const c = buildCases(recs)[0] || null;
  return c ? { case: c, captures: res.captures, missing: res.missing } : null;
}

export async function loadStats() {
  try { return JSON.parse(await get(`${ARCHIVE_RAW}stats/latest.json?t=${Math.floor(Date.now() / 60e3)}`, 'text')); } catch { return null; }
}

// A short, factual summary of a case, shared by the page metadata and the card image.
export function summarize(c) {
  const sig = c.list.reduce((m, r) => ((m[r.sigStatus] = (m[r.sigStatus] || 0) + 1), m), {});
  const stages = ['request', 'worker', 'result', 'attestation'].map((name, i) => ({ name, n: c.stages[i].length }));
  const seen = stages.filter((s) => s.n).length;
  const parts = [`${seen} of 4 stages observed`, `${c.list.length} ${c.list.length === 1 ? 'record' : 'records'}`];
  if (sig.valid) parts.push(`${sig.valid} ${sig.valid === 1 ? 'signature' : 'signatures'} verified`);
  if (sig.invalid) parts.push(`${sig.invalid} failing`);
  if (c.verdicts.useful || c.verdicts.not) parts.push(`verdicts: ${c.verdicts.useful} useful, ${c.verdicts.not} negative`);
  return { stages, seen, sig, text: parts.join(' · ') };
}

export const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
