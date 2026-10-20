// Pinned snapshots: load a fixed window of one room from the evidence archive, check it
// against the archive's own manifest, and hand back the records. Runs in the browser and
// in Node (WebCrypto, DecompressionStream, fetch); the caller supplies the fetch functions.
//
// A pin is "g<generation>:<from seq>-<to seq>", e.g. "g0:19924995-19925140".

export const ARCHIVE_RAW = 'https://raw.githubusercontent.com/wyc4t/proofline-technocore/archive-data/';

export function parsePin(s) {
  const m = /^g(\d{1,6}):(\d{1,19})-(\d{1,19})$/.exec(String(s ?? ''));
  if (!m) return null;
  const from = Number(m[2]), to = Number(m[3]);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to || to - from > 5_000_000) return null;
  return { gen: m[1], from, to };
}
export const formatPin = (gen, from, to) => `g${gen}:${from}-${to}`;

// Successful captures of this room and generation whose new records overlap the window.
export function locateCaptures(capturesText, room, gen, from, to) {
  const out = [];
  for (const line of String(capturesText).split('\n')) {
    if (!line.trim()) continue;
    let c; try { c = JSON.parse(line); } catch { continue; }
    if (!c.ok || c.room !== room || String(c.generation) !== String(gen) || !c.new_records) continue;
    if (c.new_first_seq <= to && c.new_last_seq >= from) out.push(c);
  }
  return out;
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
export async function loadPinned({ room, gen, from, to, fetchText, fetchBytes, assetUrl, rawBase = ARCHIVE_RAW }) {
  const captures = locateCaptures(await fetchText(`${rawBase}captures.jsonl`), room, gen, from, to);
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
  return { lines, captures: used, missing };
}
