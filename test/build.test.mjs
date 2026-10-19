import test from 'node:test'; import assert from 'node:assert/strict'; import { execFileSync } from 'node:child_process'; import fs from 'node:fs';
test('committed dist/app.js matches a fresh build of src/', () => { assert.doesNotThrow(() => execFileSync('node', ['scripts/build.mjs', '--check'], { stdio: 'pipe' })); });
test('dist/app.js is a classic script (no import/export) so file:// works', () => { assert.doesNotMatch(fs.readFileSync('dist/app.js', 'utf8'), /^\s*(import|export)\b/m); });
test('index.html loads app.js as a classic deferred script', () => { const h = fs.readFileSync('dist/index.html', 'utf8'); assert.match(h, /<script src="app\.js" defer/); assert.doesNotMatch(h, /type="module"/); });
