// Deterministic build from byte-exact, versioned public fixtures. No network and no data publication.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {GUIDED_CASES} from '../src/lib/examples.js';
import {parseMessage} from '../src/lib/protocol.js';
import {parsePin} from '../src/lib/snapshot.js';
export function exampleOutputs(root = new URL('../', import.meta.url)) {
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const outputs = new Map(), cases = [];
  for (const item of GUIDED_CASES) {
    const [room,id] = item.key.split(':'), pin = parsePin(item.pin);
    const source = fs.readFileSync(new URL(`test/fixtures/${item.fixture}`, root));
    const raw = source.toString('utf8').trimEnd().split('\n').filter(line => {
      const m = JSON.parse(line), p = parseMessage(m,room);
      return p.ok && p.record.id === id && m.seq >= pin.from && m.seq <= pin.to;
    });
    const bytes = raw.join('\n')+'\n', file = `${room}-${id}.jsonl`;
    outputs.set(`dist/examples-data/${file}`, bytes);
    cases.push({key:item.key,pin:item.pin,file,sha256:sha(bytes),case_records:raw.length,bytes:Buffer.byteLength(bytes),source_fixture:item.fixture,source_fixture_sha256:sha(source)});
  }
  outputs.set('dist/examples-data/manifest.json', JSON.stringify({format:'proofline-guided-cases',version:1,scope:'Selected case records only. Other records in the pinned sequence window are omitted. Hashes check delivered bytes, not independent capture time or completeness.',cases},null,2)+'\n');
  return outputs;
}
