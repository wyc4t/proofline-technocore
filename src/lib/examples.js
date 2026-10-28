// Curated case-only bundles are served with this build, not fetched as full room history.
import { digest, splitLines, parsePin } from './snapshot.js';
import { parseRoomPage } from './signature.js';
import { parseMessage } from './protocol.js';
export const GUIDED_CASES = [
  { key: 'credence:tfecd8da94c', pin: 'g0:4544-4550', fixture: 'guided-examples.jsonl', number: 1, exampleId: 'signed-chain', title: 'Signed claims' },
  { key: 'credence:t8a3c1f7e29', pin: 'g0:13135-13143', fixture: 'guided-examples.jsonl', number: 2, exampleId: 'shared-key', title: 'Shared key' },
  { key: 'credence:tee6121dd03', pin: 'g0:2-7', fixture: 'guided-examples.jsonl', number: 3, exampleId: 'preserved-records', title: 'Preserved records' },
  { key: 'kibble:k7319be7534', pin: 'g0:21334912-21337127', fixture: 'conflict-k7319be7534.jsonl', number: 4, exampleId: 'conflicting-verdicts', title: 'Opposing claims' },
];
export async function loadGuidedCase({ key, pin, base, fetchText, fetchBytes }) {
  const known = GUIDED_CASES.find((c) => c.key === key && c.pin === pin);
  if (!known) return null; // Other pins keep the full archive-loading path.
  const manifest = JSON.parse(await fetchText(`${base}examples-data/manifest.json`));
  const e = manifest.cases?.find((c) => c.key === key && c.pin === pin);
  const [room, id] = key.split(':'), file = `${room}-${id}.jsonl`, window = parsePin(pin);
  if (manifest.format !== 'proofline-guided-cases' || manifest.version !== 1 || !e || e.file !== file || !/^[a-f0-9]{64}$/.test(e.sha256)) throw new Error('Invalid guided-case manifest');
  const bytes = await fetchBytes(`${base}examples-data/${file}`);
  if (await digest(bytes) !== e.sha256) throw new Error('Guided-case bundle does not match its manifest hash');
  const lines = splitLines(bytes), seqs = new Set();
  for (const line of lines) {
    const m = parseRoomPage(new TextDecoder().decode(line)), parsed = parseMessage(m, room);
    if (!parsed.ok || parsed.record.id !== id || !Number.isSafeInteger(m.seq) || m.seq < window.from || m.seq > window.to || seqs.has(m.seq)) throw new Error('Guided-case bundle has unexpected records');
    seqs.add(m.seq);
  }
  if (!lines.length || lines.length !== e.case_records || !bytes.length || bytes.at(-1) !== 10) throw new Error('Guided-case bundle is incomplete or malformed');
  return { lines, curated: true, missing: null, captures: [], bundle: { example:{number:e.number,title:e.title,exampleId:e.exampleId}, file, sha256: e.sha256, bytes: bytes.length, records: lines.length } };
}
