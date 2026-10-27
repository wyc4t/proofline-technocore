import {storageEpoch,legacyAmbiguousGenerations} from './archive-epoch.js';
// Pinned snapshots: load a fixed window of one room from the evidence archive, check it
// against the archive's own manifest, and hand back the records. Runs in the browser and
// in Node (WebCrypto, DecompressionStream, fetch); the caller supplies the fetch functions.
//
// Old pins select epoch 0: g0:1-3. A later storage epoch is explicit: g0e1:1-3.

export const ARCHIVE_RAW = 'https://raw.githubusercontent.com/wyc4t/proofline-technocore/archive-data/';

export function parsePin(s) {
  const m = /^g(\d{1,6})(?:e(\d{1,6}))?:(\d{1,19})-(\d{1,19})$/.exec(String(s ?? ''));
  if (!m) return null;
  const from = Number(m[3]), to = Number(m[4]), epoch=Number(m[2]||0);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to || to - from > 5_000_000) return null;
  return { gen: m[1], from, to, ...(epoch?{epoch}:{}) };
}
export const formatPin = (gen, from, to, epoch=0) => `g${gen}${storageEpoch({storage_epoch:epoch})?`e${epoch}`:''}:${from}-${to}`;

// Successful captures of this room and generation whose new records overlap the window.
const parseLines = (text) => String(text).split('\n').flatMap((l) => { if (!l.trim()) return []; try { return [JSON.parse(l)]; } catch { return []; } });
const selectCaptures = (list, room, gen, from, to, epoch=0) => list.filter((c) => c.ok !== false && c.room === room && String(c.generation) === String(gen)
  && storageEpoch(c)===epoch && c.new_records && c.new_first_seq <= to && c.new_last_seq >= from);
export function locateCaptures(capturesText, room, gen, from, to, epoch=0){epoch=storageEpoch({storage_epoch:epoch});const list=parseLines(capturesText).filter(c=>c.ok);if(epoch===0&&legacyAmbiguousGenerations(list,room).includes(String(gen)))throw Error('Legacy sequence reuse makes this archive generation ambiguous; recovery is required');return selectCaptures(list,room,gen,from,to,epoch)}

// Same result as locateCaptures, reading only the small index: the room's day list, then the
// day files that can hold the window. Returns null when the archive has no index yet.
export async function locateViaIndex({ room, gen, from, to, epoch=0, fetchText, rawBase = ARCHIVE_RAW }) {
  epoch=storageEpoch({storage_epoch:epoch});
  const indexBase=`${rawBase}index/${room}/${epoch?`e${epoch}/`:''}`;
  let index;
  try { index = JSON.parse(await fetchText(`${indexBase}days.json`)); } catch { return null; }
  if(index.epoch_format!==1)return null;
  if(epoch===0&&index.legacy_ambiguous_generations?.includes(String(gen)))throw Error('Legacy sequence reuse makes this archive generation ambiguous; recovery is required');
  const days=index.days;
  if (!Array.isArray(days)) return null;
  const wanted = days.filter((d) => String(d.g) === String(gen) && storageEpoch(d)===epoch && d.first <= to && d.last >= from);
  const texts = await Promise.all([...new Set(wanted.map(d=>d.day))].map(day => fetchText(`${indexBase}${day}.jsonl`)));
  return selectCaptures(texts.flatMap(parseLines), room, gen, from, to, epoch);
}

// Sequence numbers in [from, to] that no capture covers (gaps, or not captured yet).
export function uncovered(captures, from, to) {
  const ranges = captures.map((c) => [Math.max(from, c.new_first_seq), Math.min(to, c.new_last_seq)]).filter(([a, b]) => a <= b).sort((a, b) => a[0] - b[0]);
  let missing = 0, next = from;
  for (const [a, b] of ranges) { if (a > next) missing += a - next; next = Math.max(next, b + 1); }
  if (next <= to) missing += to - next + 1;
  return missing;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const digest = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));
export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export function splitLines(bytes) {
  const out = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) { if (i > start) out.push(bytes.subarray(start, i)); start = i + 1; }
  return out;
}
const decoder = new TextDecoder();
const seqOf = (line) => { const m = /^\{"seq":(\d+),/.exec(decoder.decode(line.subarray(0, 40))); return m ? Number(m[1]) : null; };
function joinLines(lines) {
  const out = new Uint8Array(lines.reduce((n, l) => n + l.length + 1, 0));
  let o = 0;
  for (const l of lines) { out.set(l, o); o += l.length; out[o++] = 10; }
  return out;
}

// Loads the window. fetchBytes(url) -> Uint8Array; assetUrl(tag, asset) -> URL of a release file.
// Returns { lines: [Uint8Array], captures: [{ captured_at, range, integrity: 'verified' }], missing }.
// Every capture used is checked against the manifest; a mismatch rejects the whole load.
export async function loadPinned({ room, gen, from, to, epoch=0, fetchText, fetchBytes, assetUrl, rawBase = ARCHIVE_RAW }) {
  const captures = await locateViaIndex({ room, gen, from, to, epoch, fetchText, rawBase })
    ?? locateCaptures(await fetchText(`${rawBase}captures.jsonl`), room, gen, from, to, epoch);
  const missing = uncovered(captures, from, to);
  if (!captures.length) return { lines: [], captures: [], missing };
  const fileCache = new Map();
  const gitFile = async (rel) => { if (!fileCache.has(rel)) fileCache.set(rel, splitLines(await fetchBytes(rawBase + rel))); return fileCache.get(rel); };
  const lines = [], used = [];
  for (const c of captures) {
    const range = [c.new_first_seq, c.new_last_seq];
    let capLines, integrity;
    if (c.storage?.kind === 'release') {
      const gz = await fetchBytes(assetUrl(c.storage.tag, c.storage.asset));
      if (await digest(gz) !== c.storage.gz_sha256) throw new Error(`archive file ${c.storage.asset} does not match the manifest`);
      capLines = splitLines(await gunzip(gz));
      integrity = 'verified';
    } else if (c.storage?.kind === 'git') {
      // Every file of the capture is needed to re-hash it. Captures cover ten minutes (one or two
      // files); only the archive's first capture, the full credence history, is large.
      const all = [];
      for (const f of c.storage.files || []) all.push(...await gitFile(f));
      capLines = all.filter((l) => { const s = seqOf(l); return s !== null && s >= range[0] && s <= range[1]; }).sort((a, b) => seqOf(a) - seqOf(b));
      if (await digest(joinLines(capLines)) !== c.new_sha256) throw new Error(`archived records of the capture at ${c.captured_at} do not match the manifest`);
      integrity = 'verified';
    } else continue;
    for (const l of capLines) { const s = seqOf(l); if (s !== null && s >= from && s <= to) lines.push(l); }
    used.push({ captured_at: c.captured_at, range, integrity });
  }
  lines.sort((a, b) => seqOf(a) - seqOf(b));
  // Missing = every seq in the window not actually loaded: not captured, in a gap between captures, or
  // inside one capture (an export that skipped numbers). Technocore numbers every record, so none is optional.
  const loaded = new Map();for(const line of lines){const seq=seqOf(line),prior=loaded.get(seq);if(prior&&(prior.length!==line.length||!prior.every((v,i)=>v===line[i])))throw Error('Conflicting bytes for one sequence number in the selected storage epoch');loaded.set(seq,line)}
  return { lines:[...loaded.values()], captures: used, missing: (to - from + 1) - loaded.size };
}
