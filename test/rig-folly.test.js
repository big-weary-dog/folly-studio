// The Folly's rig reproduces the cathedral.json era exactly: three saved looks (legacy layers on group ids; rose
// rings, strands and every pixel field; a composed look with globals and automation, its chains converted to the one
// rule) render to the same DMX bytes, frame for frame, as they did before the rig
// (test/fixtures/rigs/folly-frames.json, frozen then).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import * as core from '../public/js/pattern-core.ts';
import { upgradeLook } from '../shared/chain-order.ts';
import { folly } from './fixtures/rigs.js';

const frozen = JSON.parse(readFileSync(new URL('./fixtures/rigs/folly-frames.json', import.meta.url), 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');

describe('the Folly renders saved looks byte for byte as before the rig', () => {
  for (const { name, look: saved, sha256, sampled } of frozen.looks) {
    test(name, () => {
      const look = upgradeLook(saved).look;
      const scene = core.prepareScene(folly);
      core.setLibrary([]);
      const layers = look.layers.map((l) => core.prepareLayer(scene, l, core.compileLayer(l)));
      const g = core.prepareLook({ globals: look.globals, automation: look.automation, bpm: look.bpm });
      const rgb = new Float32Array(scene.count * 3), full = new Uint8Array(scene.frameChannels);
      const all = createHash('sha256');
      for (let f = 0; f < frozen.frames; f++) {
        const r = core.renderFrame(scene, layers, f / 40, rgb, g);
        assert.deepEqual(r.errors, []);
        core.toChannels(scene, r.rgb, full);
        all.update(full);
        if (f % frozen.every === 0) assert.equal(sha(full).slice(0, 16), sampled[f], `frame ${f}`);
      }
      assert.equal(all.digest('hex'), sha256, `all ${frozen.frames} frames`);
    });
  }
});
