// The rig (SPEC "Rig") through the core, on the Folly's and on a fictional mini rig (z up, GRB, 2 universes of 300
// channels): nothing in the core, the addressing or the group rules assumes the Folly.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { ledRanges } from '../public/js/fseq.js';
import {
  compilePattern, flashRegions, groupsByTag, pixelsForGroups, prepareLayer, prepareScene, renderFrame, tagCentres,
  toChannels,
} from '../public/js/pattern-core.js';
import { mini, RIGS } from './fixtures/rigs.js';

for (const [name, rig] of Object.entries(RIGS)) {
  describe(`the ${name} rig`, () => {
    const scene = prepareScene(rig);

    test('fixtures tile the pixels: u, i and n run along each, zones in order of appearance', () => {
      for (const [j, f] of rig.fixtures.entries()) {
        for (let i = 0; i < f.count; i++) {
          const k = f.start + i;
          assert.equal(scene.fixture[k], j);
          assert.equal(scene.zones[scene.zone[k]], f.zone ?? f.id);
          assert.deepEqual([scene.i[k], scene.n[k]], [i, f.count]);
          assert.equal(scene.u[k], f.count > 1 ? i / (f.count - 1) : 0);
        }
      }
      assert.deepEqual(scene.zones, [...new Set(rig.fixtures.map((f) => f.zone ?? f.id))]);
    });

    test('positions fill 0..1 inside the bounds, in the pattern frame', () => {
      for (const [a, P, p] of [[0, scene.X, scene.x], [1, scene.Y, scene.y], [2, scene.Z, scene.z]]) {
        assert.equal(Math.min(...p), 0, `axis ${a}`);
        assert.equal(Math.max(...p), 1, `axis ${a}`);
        assert.equal(Math.min(...P), scene.bounds.min[a]);
        assert.equal(Math.max(...P), scene.bounds.max[a]);
      }
    });

    test('the root holds every LED, groups sit in their parents, tags find groups outermost first', () => {
      assert.equal(pixelsForGroups(scene, []).length, scene.count);
      assert.equal(pixelsForGroups(scene, [scene.root.id]).length, scene.count);
      for (const g of rig.groups) {
        if (g.parent == null) continue;
        const parent = new Set(pixelsForGroups(scene, [g.parent]));
        for (const k of pixelsForGroups(scene, [g.id])) assert.ok(parent.has(k), `${g.id} pixel ${k}`);
      }
      assert.deepEqual(groupsByTag(scene, 'all').map((g) => g.id), [scene.root.id]);
      for (const tag of ['arch', 'rose', 'wash']) {
        const found = groupsByTag(scene, tag);
        assert.ok(found.length, `${name} tags ${tag}`);
        assert.deepEqual(pixelsForGroups(scene, [], [tag]), pixelsForGroups(scene, found.map((g) => g.id)));
      }
      assert.deepEqual(groupsByTag(scene, 'nothing-has-this'), []);
    });

    test('each LED\'s three channels go to its address in the rig\'s colour order, within its frame', () => {
      const { channelsPerUniverse: cpu, universes, order } = rig.output;
      assert.equal(scene.frameChannels, cpu * universes);
      for (const k of [0, 1, scene.count >> 1, scene.count - 1]) {
        const rgb = new Float32Array(scene.count * 3);
        rgb.set([1, 0.5, 0.25], 3 * k);
        const ch = toChannels(scene, rgb);
        assert.equal(ch.length, cpu * universes);
        const base = (rig.pixels.universe[k] - 1) * cpu + rig.pixels.channel[k] - 1;
        const want = { R: 255, G: 128, B: 64 };
        assert.deepEqual(Array.from(ch.subarray(base, base + 3)), [...order].map((c) => want[c]), `LED ${k}`);
        assert.equal(ch.reduce((n, v) => n + (v > 0), 0), 3);
      }
      const used = ledRanges(rig).reduce((n, [, c]) => n + c, 0);
      assert.equal(used, scene.count * 3, 'the sparse ranges hold every LED\'s channels, and only them');
    });

    test('flash regions: the whole, then each lit top-level group', () => {
      const regions = flashRegions(scene);
      assert.deepEqual(regions[0], { id: scene.root.id, idx: null, large: true });
      const top = rig.groups.filter((g) => g.parent === scene.root.id).map((g) => g.id);
      assert.deepEqual(regions.slice(1).map((r) => r.id), top);
    });
  });
}

describe('the mini rig: its own axes, attrs, tags and addressing', () => {
  const scene = prepareScene(mini);
  const probe = (code, layer = {}) => {
    const L = prepareLayer(scene, { id: 'p', ...layer }, compilePattern(code));
    const { rgb, errors } = renderFrame(scene, [L], 0);
    assert.deepEqual(errors, []);
    return { L, rgb };
  };

  test('z up and the front at −y: pattern x is rig y, y is rig z, z is rig x', () => {
    const k = mini.fixtures.find((f) => f.id === 'lintel').start + 3;
    const [rx, ry, rz] = mini.pixels.pos.slice(3 * k, 3 * k + 3);
    assert.deepEqual([scene.X[k], scene.Y[k], scene.Z[k]], [ry, rz, rx]);
    assert.equal(scene.y[k], 1, 'the lintel is the top');
    const side = (id) => Array.from(pixelsForGroups(scene, [id])).map((j) => scene.z[j]);
    assert.ok(side('post-left').every((z) => z < 0.5) && side('post-right').every((z) => z > 0.5), 'left is left');
  });

  test('ring and sector (and row, petal), attr(), is() and centres() read the rig', () => {
    const panel = mini.fixtures.find((f) => f.id === 'panel');
    const { rgb } = probe(`function pixel(p) {
      return [p.ring === p.row && p.sector === p.petal ? p.ring / 4 : 9, p.attr('col') / 7 + p.attr('nope', 0),
        p.is('rose') ? 1 : p.is('flood') ? 0.5 : 0];
    }`);
    for (let k = 0; k < mini.count; k++) {
      const i = k - panel.start, onPanel = i >= 0 && i < panel.count;
      assert.equal(rgb[3 * k], onPanel ? mini.pixels.attrs.ring[k] / 4 : 0, `ring ${k}`);
      assert.ok(Math.abs(rgb[3 * k + 1] - (onPanel ? (i % 8) / 7 : 0)) < 1e-6, `col ${k}`);
      assert.equal(rgb[3 * k + 2], onPanel ? 1 : mini.fixtures.at(-1).start <= k ? 0.5 : 0, `tags ${k}`);
    }
    assert.equal(scene.sector[0], -1, 'no sector: −1');
    assert.deepEqual(tagCentres(scene, 'rose'), [[-0.5, 1.35, 0]], 'a centre in rig axes, turned to the pattern frame');
    const { rgb: c } = probe('function pixel() { const o = centres("rose")[0]; return [o[0] + 1, o[1] / 2, 0]; }');
    assert.ok(Math.abs(c[0] - 0.5) < 1e-6 && Math.abs(c[1] - 0.675) < 1e-6);
  });

  test('tags carry a look between rigs: unknown ids fall back to them, known ids win, no tags is an error', () => {
    const lit = (layer) => prepareLayer(scene, { id: 'l', ...layer }, compilePattern('function pixel() {}')).idx.length;
    assert.equal(lit({ groups: ['rose-window'], tags: ['rose'] }), 64, 'the Folly\'s rose lands on the panel');
    assert.equal(lit({ groups: ['main-arches', 'gate'], tags: ['wash'] }), 80 + 4, 'known ids plus the tags');
    assert.equal(lit({ groups: ['gate'], tags: ['wash'] }), 80, 'every id known: tags change nothing');
    assert.equal(lit({ tags: ['canopy'] }), 20, 'tags alone');
    assert.equal(lit({ groups: ['spires'], tags: ['tower'] }), 0, 'nothing tagged so here: nothing lit');
    assert.throws(() => lit({ groups: ['rose-window'] }), /unknown group "rose-window"/);
  });

  test('a frame is 2 × 300 channels, GRB', () => {
    const rgb = new Float32Array(scene.count * 3).fill(0);
    rgb[0] = 1;                                         // LED 0 red: universe 1, channel 1, so G R B → slot 2
    const ch = toChannels(scene, rgb);
    assert.equal(ch.length, 600);
    assert.deepEqual(Array.from(ch.subarray(0, 3)), [0, 255, 0]);
    const panel = mini.fixtures.find((f) => f.id === 'panel').start;
    rgb.fill(0); rgb[3 * panel + 1] = 1;                // the panel's first LED green: universe 2, channel 1
    assert.equal(toChannels(scene, rgb).indexOf(255), 300);
  });
});

describe('a malformed rig is refused', () => {
  const broken = (change) => {
    const rig = structuredClone(mini);
    change(rig);
    return () => prepareScene(rig);
  };
  test('with the reason', () => {
    assert.throws(broken((r) => { r.fixtures[1].start += 1; }), /fixture lintel must start at 30/);
    assert.throws(broken((r) => { r.fixtures.pop(); }), /fixtures cover 144 of 148/);
    assert.throws(broken((r) => { r.axes.up = '+x'; }), /three different axes/);
    assert.throws(broken((r) => { r.axes.front = 'south'; }), /axes.front/);
    assert.throws(broken((r) => { r.output.order = 'RGBW'; }), /output.order/);
    assert.throws(broken((r) => { r.pixels.attrs.ring.pop(); }), /attrs.ring must have 148/);
    assert.throws(broken((r) => { delete r.output; }), /universes and channelsPerUniverse/);
    assert.throws(broken((r) => { r.pixels.pos.pop(); }), /pixels.pos/);
    assert.throws(() => prepareScene({ count: 1 }), /not a rig/);
  });
});
