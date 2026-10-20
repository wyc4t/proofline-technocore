#!/usr/bin/env node
// Re-runs the read-only GET requests that agents report in their results, and compares what Proofline observes
// with what they claimed. Proofline's observations are its own records, kept apart from the archived ones.
//
//   node archive/reproduce.mjs --data <archive-data> [--assets <dir>] --new          new credence claims (archive job)
//   node archive/reproduce.mjs --data <archive-data> --experiment <findings dir>     CRED-EXP-003
//
// Limits: only requests that pass checkRequest() (src/lib/claims.js); one at a time, at least 1 s apart, at most
// MAX_REQUESTS per run, 10 s timeout, 2 MB response cap, redirects not followed.
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { parseClaims, checkRequest, compareClaim, CLAIMS_VERSION, HOST } from '../src/lib/claims.js';

export const RUNNER_VERSION = '1';
export const MAX_REQUESTS = 40;
const MAX_BYTES = 2 * 1024 * 1024;
const UA = 'proofline-reproduce/1 (+https://github.com/wyc4t/proofline-technocore)';
const here = new URL('.', import.meta.url).pathname;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

async function readCapped(res) {
  const reader = res.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > MAX_BYTES) { await reader.cancel(); throw new Error('response over 2 MB'); } chunks.push(value); }
  const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out;
}

// One GET, recorded with everything needed to check it later.
export async function observe(url, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const check = checkRequest(url.startsWith(HOST) ? url.slice(HOST.length) : url);
  if (!check.ok || check.url !== url) throw new Error(`refusing ${url}: ${check.reason || 'not in canonical form'}`);
  const observed_at = now().toISOString();
  try {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(10_000) });
    const bytes = await readCapped(res);
    const h = (k) => res.headers.get(k) ?? undefined;
    const o = { observed_at, url, status: res.status, headers: { 'content-type': h('content-type'), 'cache-control': h('cache-control'), 'content-length': h('content-length'), 'x-room-generation': h('x-room-generation') }, bytes: bytes.length, sha256: sha256(bytes) };
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (bytes.length <= 512) o.body_text = text;
    if (/json/.test(o.headers['content-type'] || '') || /^\s*\{/.test(text)) {
      try { const j = JSON.parse(text); if (typeof j.count === 'number') o.count = j.count; if (j.first_seq != null) { o.first_seq = j.first_seq; o.last_seq = j.last_seq; } if (j.info?.version) o.version = j.info.version; } catch { /* not JSON */ }
    }
    const asof = /\basof=(\d{4}-\d\d-\d\dT[\d:]+Z)/.exec(text); if (asof) o.asof = asof[1];
    const asOf = /\bAs of (\d{4}-\d\d-\d\dT[\d:]+Z)/.exec(text); if (asOf) o.as_of = asOf[1];
    if (check.kind === 'note') o.fingerprints = [...new Set(text.match(/\b[0-9a-f]{16}\b/g) || [])].slice(0, 100);
    return o;
  } catch (e) { return { observed_at, url, error: String(e?.message || e) }; }
}

// items: [{ source, claimedAt, claims: [{ target, props }] }]. Each distinct URL is requested once per run.
export async function reproduce(items, { fetchImpl = fetch, spacingMs = 1000, max = MAX_REQUESTS, now = () => new Date(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const urls = new Map();
  for (const it of items) for (const c of it.claims) { const k = checkRequest(c.target); if (k.ok && !urls.has(k.url)) urls.set(k.url, null); }
  const wanted = [...urls.keys()].slice(0, max - 1);
  let first = true;
  const get = async (u) => { if (!first) await sleep(spacingMs); first = false; return observe(u, { fetchImpl, now }); };
  const version = await get(`${HOST}/openapi.json`);
  for (const u of wanted) urls.set(u, await get(u));
  const server_version = version.version || null;
  return {
    format: 'proofline-reproduction', runner_version: RUNNER_VERSION, claims_version: CLAIMS_VERSION, server_version,
    started_at: version.observed_at, requests: wanted.length + 1, skipped_over_limit: Math.max(0, urls.size - wanted.length),
    items: items.map((it) => ({ ...it, claims: it.claims.map((c) => { const k = checkRequest(c.target); const obs = k.ok ? urls.get(k.url) || null : null;
      return { ...c, url: k.ok ? k.url : null, refused: k.ok ? undefined : k.reason, observation: obs, comparison: compareClaim(c, obs, { claimedAt: it.claimedAt, observedAt: obs?.observed_at }) }; }) })),
  };
}

// --- Archive helpers ----------------------------------------------------------------------------------

async function credenceRecords(data, assets) {
  const { check } = await import('./check.mjs');
  const { classify } = await import('./lib/records.mjs');
  const { parseMessage } = await import('../src/lib/protocol.js');
  const report = check({ data, assets, keepRecords: true });
  if (report.problems.length) throw new Error(report.problems.join('\n'));
  const out = [];
  for (const [g, m] of Object.entries(report.records.credence || {})) for (const p of m.values()) {
    const r = parseMessage({ ...p.rec, sigStatus: classify('credence', p) }, 'credence');
    if (r.ok) out.push({ ...r.record, gen: g.replace(/^g/, '') });
  }
  return out;
}

const summarize = (run) => {
  const n = { reproduced: 0, differs: 0, 'not comparable': 0, 'not run': 0 };
  for (const it of run.items) for (const c of it.claims) for (const p of c.comparison) n[p.outcome]++;
  return n;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: v } = parseArgs({ options: { data: { type: 'string' }, assets: { type: 'string' }, experiment: { type: 'string' }, new: { type: 'boolean' }, 'dry-run': { type: 'boolean' } } });
  if (!v.data || (!v.experiment && !v.new)) { console.error('usage: reproduce.mjs --data <dir> (--new | --experiment <dir>)'); process.exit(2); }

  if (v.experiment) {
    const pre = JSON.parse(readFileSync(join(v.experiment, 'prereg.json'), 'utf8'));
    const recs = await credenceRecords(v.data, v.assets);
    const items = [];
    for (const h of pre.historical) {
      const r = recs.find((x) => x.id === h.case && x.seq === h.seq);
      if (!r) { console.error(`not in the archive: ${h.case} #${h.seq}`); continue; }
      items.push({ source: { room: 'credence', case: h.case, seq: h.seq, from: r.source }, claimedAt: r.ts, claims: parseClaims(r.body) });
    }
    const nowIso = new Date().toISOString();
    for (const c of pre.controls) items.push({ source: { control: c.id }, claimedAt: nowIso, claims: parseClaims(c.text) });
    const run = await reproduce(items);
    writeFileSync(join(v.experiment, 'run.json'), JSON.stringify(run, null, 1) + '\n');
    console.log(`server ${run.server_version} · ${run.requests} requests · ${JSON.stringify(summarize(run))}`);
    process.exit(0);
  }

  // --new: claims in credence results and attestations archived since the last run.
  const dir = join(v.data, 'reproductions'); mkdirSync(dir, { recursive: true });
  const statePath = join(dir, 'state.json');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  const recs = await credenceRecords(v.data, v.assets);
  const gen = recs.reduce((g, r) => (Number(r.gen) > Number(g) ? r.gen : g), '0');
  const maxSeq = recs.filter((r) => r.gen === gen).reduce((m, r) => Math.max(m, r.seq), 0);
  if (!state || state.generation !== gen) {                      // first run: start from now, do not replay history
    writeFileSync(statePath, JSON.stringify({ generation: gen, last_seq: maxSeq, since: new Date().toISOString() }, null, 1) + '\n');
    console.log(`reproduction starts after credence g${gen} seq ${maxSeq}`); process.exit(0);
  }
  const fresh = recs.filter((r) => r.gen === gen && r.seq > state.last_seq && (r.stage === 2 || r.stage === 3)).sort((a, b) => a.seq - b.seq);
  const items = fresh.map((r) => ({ source: { room: 'credence', generation: gen, case: r.id, seq: r.seq, kind: r.kind, from: r.source, sig: r.sigStatus }, claimedAt: r.ts, claims: parseClaims(r.body) })).filter((it) => it.claims.length);
  if (items.length && !v['dry-run']) {
    const run = await reproduce(items);
    const day = run.started_at.slice(0, 10);
    appendFileSync(join(dir, `${day}.jsonl`), JSON.stringify(run) + '\n');
    console.log(`reproduced ${items.length} records · server ${run.server_version} · ${JSON.stringify(summarize(run))}`);
  } else console.log(`no new credence claims (${fresh.length} new results and attestations)`);
  if (!v['dry-run']) writeFileSync(statePath, JSON.stringify({ ...state, last_seq: Math.max(state.last_seq, maxSeq), last_run: new Date().toISOString() }, null, 1) + '\n');
}
