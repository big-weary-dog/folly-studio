// public/js/flash-guard.ts: the Studio's live flash guard reaches the same verdicts as the bake check
// (src/frames.ts) on the Folly's rig, with the same limits: large-area flashing over three a second dims the
// preview; slow change, small shimmer, flashing on small regions alone and a wave crossing the building do not.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { FlashGuard } from '../public/js/flash-guard.ts';
import { ledRanges, writeFseq } from '../public/js/fseq.ts';
import { FlashWatch, pixelsForGroups, prepareScene, tagCentres } from '../public/js/pattern-core.ts';
import { analyzeFrames, parseFseq } from '../src/frames.ts';
import { folly as rig } from './fixtures/rigs.js';

const N = rig.count, scene = prepareScene(rig);
const inGroup = (id) => {
  const mask = new Uint8Array(N);
  for (const k of pixelsForGroups(scene, [id])) mask[k] = 1;
  return (k) => mask[k] === 1;
};
const [inRose, inSpirelets] = [inGroup('rose-window'), inGroup('spirelets')];
const square = (hz) => (t) => (Math.floor(t * hz * 2) % 2 ? 0 : 1);
// A bright shell bursting from the rose `hz` times a second, out to 25 m: each place lit once a burst.
const [O] = tagCentres(scene, 'rose');
const far = Float64Array.from({ length: N },
  (_, k) => Math.hypot(scene.X[k] - O[0], scene.Y[k] - O[1], scene.Z[k] - O[2]));
const burst = (hz) => (t, k) => Math.exp(-(((far[k] - 25 * ((t * hz) % 1)) / 1.5) ** 2));

/**
 * Both verdicts for `seconds` of a look: level(t, k) → 0..1 grey. The guard sees frames at `fps`
 * (what a slow preview shows); the bake check sees 40 fps.
 */
function verdicts(level, { seconds = 3, fps = 40, limits } = {}) {
  const guard = new FlashGuard(rig, limits);
  const rgb = new Float32Array(N * 3);
  let dimmed = false;
  for (let f = 0; f < seconds * fps; f++) {
    const t = f / fps;
    for (let k = 0; k < N; k++) rgb.fill(level(t, k), 3 * k, 3 * k + 3);
    dimmed = guard.observe(rgb, t * 1000) || dimmed;
  }
  const ranges = ledRanges(rig);
  const cc = ranges.reduce((n, [, c]) => n + c, 0);
  const at = new Int32Array(scene.frameChannels).fill(-1);
  for (let o = 0, r = 0; r < ranges.length; r++) for (let i = 0; i < ranges[r][1]; i++) at[ranges[r][0] + i] = o++;
  const frames = seconds * 40, data = new Uint8Array(frames * cc);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < N; k++) {
      const a = scene.addr[k];
      const v = Math.round(level(f / 40, k) * 255);
      data[f * cc + at[a]] = data[f * cc + at[a + 1]] = data[f * cc + at[a + 2]] = v;
    }
  }
  const watch = new FlashWatch(scene, limits, { record: true });
  const blocked = !analyzeFrames(parseFseq(writeFseq({ frames, data, ranges })), scene, watch).flicker.ok;
  return { dimmed, blocked };
}

describe('the Studio flash guard', () => {
  test('same verdicts as src/frames.ts', () => {
    const cases = {
      'white strobe, 10 Hz': [(t) => square(10)(t), true],
      'white strobe, 5 Hz': [(t) => square(5)(t), true],
      'white strobe, 4 Hz': [(t) => square(4)(t), true],
      'white strobe, 3 Hz (WCAG allows three)': [(t) => square(3)(t), false],
      'slow breathe, 0.5 Hz': [(t) => 0.5 - 0.5 * Math.cos(Math.PI * t), false],
      'bright shimmer above 0.8': [(t) => (Math.floor(t * 40) % 2 ? 1 : 0.86), false],
      'rose window strobe, 8 Hz': [(t, k) => (inRose(k) ? square(8)(t) : 0.15), true],
      'spirelets strobe, 8 Hz (a small region: a warning only)': [(t, k) => (inSpirelets(k) ? square(8)(t) : 0.15),
        false],
      'a burst from the rose, 1 Hz': [burst(1), false],
      'a burst from the rose, 2 Hz (crossing arches and spires in turn)': [burst(2), false],
      'a burst from the rose, 5 Hz': [burst(5), true],
    };
    for (const [name, [level, expected]] of Object.entries(cases)) {
      const { dimmed, blocked } = verdicts(level);
      assert.equal(blocked, expected, `bake check: ${name}`);
      assert.equal(dimmed, expected, `guard: ${name}`);
    }
  });

  test('both take the server\'s limits', () => {
    const strobe4 = (t) => square(4)(t);
    assert.deepEqual(verdicts(strobe4, { limits: { perSecond: 5 } }), { dimmed: false, blocked: false });
    const rose = (t, k) => (inRose(k) ? square(8)(t) : 0.15);
    assert.deepEqual(verdicts(rose, { limits: { area: 0.5 } }), { dimmed: false, blocked: false },
      'the rose is under half the rig');
    const dim = (t) => 0.3 + 0.15 * square(5)(t);
    assert.deepEqual(verdicts(dim), { dimmed: true, blocked: true });
    assert.deepEqual(verdicts(dim, { limits: { delta: 0.2 } }), { dimmed: false, blocked: false });
  });

  test('a slow preview still catches a strobe it can see, and lets go after it stops', () => {
    assert.equal(verdicts((t) => square(5)(t), { fps: 12 }).dimmed, true, '5 Hz shown at 12 fps');
    const guard = new FlashGuard(rig);
    const rgb = new Float32Array(N * 3);
    let t = 0, on = false;
    for (; t < 2000; t += 25) on = guard.observe(rgb.fill(square(10)(t / 1000)), t);
    assert.equal(on, true);
    for (; t < 3000; t += 25) on = guard.observe(rgb.fill(0.5), t);
    assert.equal(on, true, 'held a moment, so the view does not blink');
    for (; t < 6000; t += 25) on = guard.observe(rgb.fill(0.5), t);
    assert.equal(on, false);
    guard.reset();
    assert.equal(guard.observe(rgb, t), false);
  });
});
