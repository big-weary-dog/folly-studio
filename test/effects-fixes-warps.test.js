// The effects audit's small fixes to the warps and filters, on City of Gods: what each now promises.
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { describe, test } from 'vitest';

import { compileModule } from '../public/js/pattern-core.ts';

import { at, layerOn, layerOf, litShare } from './fixtures/layers.js';

/** The largest difference between two layers' colours and alphas. */
const diff = (A, B) => A.buf.reduce((m, v, i) => Math.max(m, Math.abs(v - B.buf[i])), 0);

describe('anchor', () => {
  test('lineup frames the warps above it in the rig: a move to where a pixel is changes nothing', () => {
    const xyz = ['xyz', {}, 'function pixel(p) { return [p.x, p.y, p.z, 1]; }'], lineup = ['anchor', { lineup: true }];
    const still = ['still', {}, 'function warp(q) { move(q, q.lx, q.ly, q.lz); }'];
    const plain = at(layerOn(['main-arches'], xyz, lineup), 1);
    const moved = at(layerOn(['main-arches'], xyz, still, lineup), 1);
    assert.ok(diff(plain, moved) < 1e-6, `${diff(plain, moved)}`);
  });
  test('every tag it lists survives the compiler\'s cap of 16 options', () => {
    const tags = compileModule(readFileSync('public/patterns/anchor.js', 'utf8'), 'warp').params.tag.options;
    for (const tag of ['left', 'right', 'front', 'back', 'canopy']) assert.ok(tags.includes(tag), tag);
  });
});

describe('rotate', () => {
  test('turns in metres: a round spot turned a quarter on the wide main arches keeps its size', () => {
    const spot = ['spot', { size: 0.5, softness: 0 }];
    const still = litShare(at(layerOn(['main-arches'], spot, ['rotate', { angle: 0 }]), 1));
    const turned = litShare(at(layerOn(['main-arches'], spot, ['rotate', { angle: 0.25 }]), 1));
    assert.ok(Math.abs(turned - still) < 0.1 * still, `${still} → ${turned}`);
  });
});

describe('twist', () => {
  test('wind winds each tower round itself: neither tower takes the other side\'s colour', () => {
    const sides = 'function pixel(p) { return p.Z < p.oz ? [1, 0, 0, 1] : [0, 0, 1, 1]; }';
    const L = at(layerOn(['spires'], ['sides', {}, sides], ['twist', { swirl: 0, spin: 0, wind: 0.5 }]), 1);
    const plain = at(layerOn(['spires'], ['sides', {}, sides]), 1);
    assert.ok(diff(L, plain) < 1e-6, `${diff(L, plain)}`);
  });
});

describe('mask', () => {
  test('by self keys on luminance, so a cutoff cuts saturated colours too', () => {
    const lit = litShare(at(layerOf(['plasma'], ['mask', { by: 'self', cutoff: 0.6, softness: 0.05 }]), 1), 0.5);
    assert.ok(lit < 0.8, `${lit}`);
  });
});

describe('edge-fade', () => {
  const wash = ['colour-wash', { speed: 0 }];
  test('position 0 shows everything and 1 hides it, one side or both', () => {
    for (const both of [false, true]) {
      const [shown, hidden] = [0, 1].map((position) =>
        litShare(at(layerOf(wash, ['edge-fade', { position, both }]), 1), 0.99));
      assert.ok(shown === 1 && hidden === 0, `both ${both}: ${shown}, ${hidden}`);
    }
  });
  test('both moves the far edge in with the near one', () => {
    const fade = (position) => litShare(at(layerOf(wash, ['edge-fade', { position, both: true, width: 0.1 }]), 1),
      0.5);
    assert.ok(fade(0.5) < fade(0.2) - 0.2, `${fade(0.2)} → ${fade(0.5)}`);
  });
});

describe('trails', () => {
  test('a still soft spot keeps its soft edge, at 40 fps as at 20', () => {
    const shares = [40, 20].map((fps) => {
      const L = layerOf(['spot', { size: 0.3, softness: 1 }], ['trails', { decay: 0.9 }]);
      for (let f = 0; f <= 2 * fps; f++) at(L, f / fps);
      return litShare(L, 0.3);
    });
    const alone = litShare(at(layerOf(['spot', { size: 0.3, softness: 1 }]), 2), 0.3);
    assert.ok(shares.every((s) => Math.abs(s - alone) < 0.01), `${alone}: ${shares}`);
  });
});
