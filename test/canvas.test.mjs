import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fitCanvas } from '../src/lib/canvas.js';

function setup() {
  let width = 300, height = 150;
  const transforms = [], labels = [];
  const canvas = { width: 300, height: 150, get clientWidth() { return width; }, get clientHeight() { return height; },
    getBoundingClientRect: () => ({ width, height }), setAttribute() {} };
  const ctx = { setTransform: (...args) => transforms.push(args), clearRect() {}, fillText: (...args) => labels.push(args),
    beginPath() {}, arc() {}, fill() {}, stroke() {}, setLineDash() {} };
  canvas.getContext = () => ctx;
  return { canvas, ctx, transforms, labels, box: (w, h) => { width = w; height = h; } };
}

test('graph redraw fits a changed layout without a window resize', () => {
  const s = setup();
  const source = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const graph = source.slice(source.indexOf("const canvas=$('#graph')"), source.indexOf('// The maintainer\'s key'));
  const context = { fitCanvas, $: selector => selector === '#graph' ? s.canvas : { style: {} }, devicePixelRatio: 2,
    selected: { id: 'example', status: 'all-stages', stages: [0, 1, 2, 3].map(seq => [{ seq, kind: 'record' }]), links: [] },
    STATUS_LABEL: { 'all-stages': 'ALL 4 STAGES' }, STAGE_NAMES: ['REQUEST', 'WORKER', 'RESULT', 'ATTESTATION'], MAX_NODES: 7 };
  vm.createContext(context);
  vm.runInContext(graph + '\nresizeCanvas()', context);
  s.box(1000, 600); // Delayed CSS layout settles, with no window.resize event.
  vm.runInContext('drawGraph()', context);
  assert.equal(s.canvas.width, 2000);
  assert.equal(s.canvas.height, 1200);
  assert.deepEqual(s.transforms.at(-1), [2, 0, 0, 2, 0, 0]);
  assert.ok(s.labels.some(([text, x]) => text === 'ATTESTATION' && x === 900));
});

test('hidden graph can be shown again with a new size and pixel ratio', () => {
  const s = setup();
  s.box(0, 0);
  assert.equal(fitCanvas(s.canvas, s.ctx, 2), null);
  s.box(800, 400);
  assert.deepEqual(fitCanvas(s.canvas, s.ctx, 1), { width: 800, height: 400 });
  assert.equal(s.canvas.width, 800);
  fitCanvas(s.canvas, s.ctx, 2);
  assert.equal(s.canvas.width, 1600);
  assert.equal(s.canvas.height, 800);
});

test('fractional boxes use the actual bitmap ratio and cap retina allocation', () => {
  const s = setup();
  s.box(641.25, 399.75);
  fitCanvas(s.canvas, s.ctx, 3);
  assert.equal(s.canvas.width, 1283);
  assert.equal(s.canvas.height, 800);
  assert.deepEqual(s.transforms.at(-1), [1283 / 641.25, 0, 0, 800 / 399.75, 0, 0]);
});
