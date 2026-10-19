import test from 'node:test'; import assert from 'node:assert/strict'; import { execFileSync } from 'node:child_process'; import fs from 'node:fs';
test('committed dist/app.js matches a fresh build of src/', () => { assert.doesNotThrow(() => execFileSync('node', ['scripts/build.mjs', '--check'], { stdio: 'pipe' })); });
test('dist/app.js is a classic script (no import/export) so file:// works', () => { assert.doesNotMatch(fs.readFileSync('dist/app.js', 'utf8'), /^\s*(import|export)\b/m); });
test('index.html loads app.js as a classic deferred script', () => { const h = fs.readFileSync('dist/index.html', 'utf8'); assert.match(h, /<script src="app\.js" defer/); assert.doesNotMatch(h, /type="module"/); });
test('about dialog explains every status label and flag the app can show', () => {
  const h = fs.readFileSync('dist/index.html', 'utf8'); const about = h.slice(h.indexOf('<dialog id="aboutDialog"'), h.indexOf('</dialog>'));
  for (const t of ['All 4 stages', 'Partial', 'Request not seen', 'Negative', 'Result text repeats the request', 'Identical result or attestation text', 'Requester key also posted', 'Unavailable', 'Solid line', 'Dashed line', 'unparsed', 'missed', 'reset', 'delayed']) assert.ok(about.includes(t), `about is missing: ${t}`);
});
