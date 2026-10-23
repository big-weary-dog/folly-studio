// Rhythm (library-docs/rhythm.md) and the text param kind it reads (SPEC-library "Pattern code"): steps on the beat,
// decay, swing, lines dealt to places, the busy-line dip that keeps it under the flash check, and the kind through
// compile, resolve, the look's schema, the generators and the Studio's row.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import {
  compileLayer, FlashWatch, normalizeParams, pixelsForGroups, prepareLayer, prepareLook, prepareScene, renderFrame,
  resolveParams,
} from '../public/js/pattern-core.ts';
import { normaliseParam } from '../public/js/ui/bindings.ts';
import { buildCatalog } from '../src/generate/catalog.ts';
import { expand } from '../src/generate/expand.ts';
import { cog, mini } from './fixtures/rigs.js';

const CODE = readFileSync(new URL('../public/patterns/rhythm.js', import.meta.url), 'utf8');
const lib = (name) => readFileSync(new URL(`../public/patterns/${name}.js`, import.meta.url), 'utf8');
const WHITE = { id: 'w', kind: 'source', code: 'function pixel() { return [1, 1, 1]; }' };
const scene = prepareScene(mini);
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} ≉ ${b}`);

/** White through rhythm with `params` on all of mini at 120 bpm: t → the red of LED k. */
function play(params, bpm = 120) {
  const layer = { id: 'l', groups: ['all'], modules: [WHITE, { id: 'r', kind: 'filter', code: CODE, params }] };
  const L = prepareLayer(scene, layer, compileLayer(layer)), look = prepareLook({ bpm });
  return (t, k = 0) => {
    const { rgb, errors } = renderFrame(scene, [L], t, null, look);
    assert.deepEqual(errors, []);
    return rgb[3 * k];
  };
}
const first = (id) => pixelsForGroups(scene, [id])[0];

describe('rhythm', () => {
  test('a hit lights it and fades, squared, over decay; x is 0.6; rests are dark', () => {
    const at = play({ pattern: 'X...x...', decay: 0.25 });   // a step 0.125 s: X at 0, x at 0.5, loop 1 s
    near(at(1), 1, 'on the X');
    near(at(1.125), 0.25, 'half the decay');
    near(at(1.3), 0, 'after the decay');
    near(at(1.5), 0.6, 'on the x');
  });

  test('it seeks exactly: a frame is the same whatever came before', () => {
    const a = play({ pattern: 'X..x.X..', swing: 0.4 }), b = play({ pattern: 'X..x.X..', swing: 0.4 });
    for (const t of [9.3, 0.2, 4.71]) a(t);
    for (const t of [0.05, 0.4, 2.77]) near(a(t), b(t), `t ${t}`);
  });

  test('swing makes every second step late; steps sets their length', () => {
    near(play({ pattern: '.X..' })(1.15), 0.81, 'straight: the hit at 1.125');
    near(play({ pattern: '.X..', swing: 1 })(1.15), 0, 'swing 1: not until 1.1875');
    near(play({ pattern: '.X..', swing: 1 })(1.1875), 1, 'swing 1: its hit');
    near(play({ pattern: 'X.', steps: 1, decay: 0.5 })(2.25), 0.25, 'a step a beat: the hit at 2');
  });

  test('amount and invert', () => {
    near(play({ pattern: 'X...', amount: 0.4 })(1.3), 0.6, 'amount 0.4 between hits');
    near(play({ pattern: 'X...', invert: true })(1), 0, 'invert: cut out on the hit');
    near(play({ pattern: 'X...', invert: true })(1.3), 1, 'invert: back between');
  });

  test('several tags: line i on the i-th tag, other places untouched', () => {
    const at = play({ pattern: 'X... ..X.', tag: 'arch rose' });
    const gate = first('gate'), panel = first('panel'), flood = first('floods');
    near(at(1, gate), 1, 'line 1 on the arch');
    near(at(1, panel), 0, 'line 2 rests on the rose');
    near(at(1.25, panel), 1, 'line 2 hits');
    near(at(1, flood), 1, 'the floods are in no tag');
    const single = play({ pattern: 'X...', tag: 'arch' });
    near(single(1.3, gate), 0, 'the arch rests');
    near(single(1.3, panel), 1, 'the rose is untouched');
  });

  test('one tag deals the lines to its parts in turn', () => {
    const at = play({ pattern: 'X... ..X.', tag: 'ring' });
    near(at(1, first('panel-ring-1')), 1, 'ring 1: line 1');
    near(at(1, first('panel-ring-2')), 0, 'ring 2: line 2');
    near(at(1, first('panel-ring-3')), 1, 'ring 3: line 1 again');
  });

  test('a line over 3 hits a second only dips a quarter; one at 2 a second keeps its depth', () => {
    near(play({ pattern: 'XXXX', decay: 0.02 })(1.06), 0.75, '8 a second');
    near(play({ pattern: 'X...', decay: 0.02 })(1.06), 0, '2 a second');
  });

  test('a kit across City of Gods passes the flash check', () => {
    const cogScene = prepareScene(cog), N = cogScene.count;
    const layer = { id: 'l', groups: ['cathedral'], modules: [{ id: 'b', kind: 'source', code: lib('bars') },
      { id: 'r', kind: 'filter', code: CODE, params: { tag: 'tower arch rose', decay: 0.2,
        pattern: 'X.......X.X..... ....X.......X... x.x.x.x.x.x.x.x.' } }] };
    const L = prepareLayer(cogScene, layer, compileLayer(layer)), look = prepareLook({ bpm: 120 });
    const watch = new FlashWatch(cogScene, null, { record: true }), lum = new Float32Array(N);
    for (let f = 0; f < 160; f++) {
      const { rgb } = renderFrame(cogScene, [L], f / 40, null, look);
      for (let k = 0; k < N; k++) lum[k] = 0.2126 * rgb[3 * k] + 0.7152 * rgb[3 * k + 1] + 0.0722 * rgb[3 * k + 2];
      watch.frame(lum, f * 25);
    }
    assert.ok(watch.report().large.maxHz <= 3, `large flashing at ${watch.report().large.maxHz} a second`);
  });
});

describe('the text param kind', () => {
  test('compile keeps printable text up to 256; resolve falls back to the default', () => {
    const schema = normalizeParams({ p: { type: 'text', value: 'X..x' }, e: { type: 'text' } });
    assert.deepEqual(schema.p, { type: 'text', value: 'X..x' });
    assert.equal(schema.e.value, '');
    assert.throws(() => normalizeParams({ p: { type: 'text', value: 'x'.repeat(257) } }), /param "p": text/);
    assert.throws(() => normalizeParams({ p: { type: 'text', value: 'a\nb' } }), /param "p": text/);
    assert.deepEqual(resolveParams(schema, { p: 'x x' }).p, 'x x');
    assert.deepEqual(resolveParams(schema, { p: 7 }).p, 'X..x');
    assert.deepEqual(resolveParams(schema, { p: 'é' }).p, 'X..x');
  });

  test('the generators read it and hold it to the kind; the Studio shows it as text', () => {
    const catalog = buildCatalog([{ name: 'rhythm', kind: 'filter', title: 'Rhythm', code: CODE }]);
    assert.deepEqual(catalog.modules.get('rhythm').params.pattern.type, 'text');
    const look = (v) => expand({ title: 'T', summary: 'S', layers: [{ title: 'L', groups: ['cathedral'],
      blend: 'add', level: 1, modules: [{ use: 'rhythm', params: [{ name: 'pattern', value: v }] }] }] }, catalog);
    const ok = look('X... ..x.');
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.look.layers[0].modules[0].params.pattern, 'X... ..x.');
    const bad = look('x'.repeat(300));
    assert.equal(bad.look.layers[0].modules[0].params.pattern, undefined);
    assert.ok(bad.notes.some((n) => /pattern: not text/.test(n)), bad.notes.join('; '));
    const p = normaliseParam('pattern', normalizeParams({ pattern: { type: 'text', value: 'X.' } }).pattern);
    assert.equal(p.kind, 'text');
    assert.equal(p.value, 'X.');
    const lines = normalizeParams({ p: { type: 'text', value: 'X. .x', lines: true }, q: { type: 'text', lines: 1 } });
    assert.deepEqual(lines.p, { type: 'text', value: 'X. .x', lines: true });
    assert.equal(lines.q.lines, undefined);
    assert.equal(normaliseParam('p', lines.p).lines, true);
    assert.equal(normaliseParam('rhythm', normalizeParams({ pattern: { type: 'text', value: '' } }).pattern).lines,
      undefined);
  });
});
