import fs from 'node:fs';
import { parseRoomPage, annotateSignatures } from '../src/lib/signature.js';
// Fixtures are parsed the way the app parses room pages (nonces kept as exact digits).
export const fixture = (n) => parseRoomPage(fs.readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
// Real captured fixtures: every signature is checked for real, as the app does before parsing.
export const verifiedFixture = async (n, room) => { const f = fixture(n); await annotateSignatures(room ?? f.room, f.messages); return f; };
// Synthetic fixtures carry placeholder signatures. They stand for records whose signature
// verified, so their did:key senders are marked valid; nicknames stay unsigned.
export const synthetic = (n) => {
  const s = fixture('synthetic')[n];
  for (const ms of Object.values(s.rooms || {})) for (const m of ms) if (typeof m.from === 'string' && m.from.startsWith('did:key:') && m.sig) m.sigStatus = 'valid';
  return s;
};
