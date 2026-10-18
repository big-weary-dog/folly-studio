// The timeline: look.duration / look.bpm, layer.clips. Envelope maths and the renderer's skip
// (pattern-core.js), validation (api.js, generate/validate.js) and baking a look's duration.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compilePattern, layerEnvelope, lookDuration, normalizeClips, prepareLayer, prepareScene, renderFrame,
} from '../public/js/pattern-core.js';
import { writeFseq } from '../public/js/fseq.js';
import { createServer } from '../src/app.js';
import { validateLayers } from '../src/api.js';
import { bakeSeconds } from '../src/bake.js';
import { createRenderBox } from '../src/render-box.js';
import { parseFseq } from '../src/frames.js';
import { validateLook } from '../src/generate/validate.js';

const STUDIO = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC = path.join(STUDIO, 'public');
const rig = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data/rig.json'), 'utf8'));
const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const WHITE = 'function pixel() { return [1, 1, 1]; }';
const RED = 'function pixel() { return [1, 0, 0]; }';
/** A clip as the API and the runtime keep it. */
const clip = (start, end, fadeIn = 0, fadeOut = 0) => ({ start, end, fadeIn, fadeOut });
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-timeline-'));
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

describe('layerEnvelope', () => {
  test('no clips: always on', () => {
    for (const clips of [undefined, null, []]) {
      for (const t of [-1, 0, 5, 1e6]) assert.equal(layerEnvelope(clips, t), 1);
    }
  });

  test('a hard clip is [start, end): on from start, off at end', () => {
    const c = [{ start: 2, end: 4 }];
    assert.equal(layerEnvelope(c, 1.999), 0);
    assert.equal(layerEnvelope(c, 2), 1);
    assert.equal(layerEnvelope(c, 3.999), 1);
    assert.equal(layerEnvelope(c, 4), 0);
    assert.equal(layerEnvelope(c, 100), 0);
  });

  test('fades ramp linearly', () => {
    const c = [{ start: 10, end: 20, fadeIn: 2, fadeOut: 4 }];
    assert.equal(layerEnvelope(c, 10), 0);
    near(layerEnvelope(c, 10.5), 0.25);
    near(layerEnvelope(c, 11), 0.5);
    assert.equal(layerEnvelope(c, 12), 1);
    assert.equal(layerEnvelope(c, 16), 1);
    near(layerEnvelope(c, 17), 0.75);
    near(layerEnvelope(c, 19), 0.25);
    assert.equal(layerEnvelope(c, 20), 0);
  });

  test('fades longer than the clip shrink in proportion', () => {
    const c = [{ start: 0, end: 4, fadeIn: 6, fadeOut: 6 }]; // → 2 s and 2 s: a triangle
    near(layerEnvelope(c, 1), 0.5);
    near(layerEnvelope(c, 2), 1);
    near(layerEnvelope(c, 3), 0.5);
    const lop = [{ start: 0, end: 3, fadeIn: 3, fadeOut: 1 }]; // → 2.25 s and 0.75 s
    near(layerEnvelope(lop, 1.125), 0.5);
    near(layerEnvelope(lop, 2.25), 1);
    near(layerEnvelope(lop, 2.625), 0.5);
    for (let t = 0; t < 3; t += 0.01) assert.ok(layerEnvelope(lop, t) <= 1);
  });

  test('several clips; gaps are dark; back to back has no hole', () => {
    const c = [{ start: 0, end: 1 }, { start: 1, end: 2, fadeIn: 0.5 }, { start: 5, end: 6 }];
    assert.equal(layerEnvelope(c, 0.5), 1);
    assert.equal(layerEnvelope(c, 1), 0); // the second clip fades in from its start
    near(layerEnvelope(c, 1.25), 0.5);
    assert.equal(layerEnvelope(c, 3), 0);
    assert.equal(layerEnvelope(c, 5.5), 1);
    assert.equal(layerEnvelope([{ start: 0, end: 1 }, { start: 1, end: 2 }], 1), 1);
  });
});

describe('normalizeClips and lookDuration', () => {
  test('sorts, defaults fades, drops bad and overlapping clips, caps at 32', () => {
    assert.equal(normalizeClips(undefined), null);
    assert.equal(normalizeClips([]), null);
    assert.equal(normalizeClips([{ start: 3, end: 1 }, null, { start: 'x', end: 2 }]), null);
    const messy = [{ start: 5, end: 6 }, { start: 0, end: 2, fadeIn: -1, fadeOut: 0.5 }, { start: 1, end: 3 }];
    assert.deepEqual(normalizeClips(messy), [clip(0, 2, 0, 0.5), clip(5, 6)]);
    assert.equal(normalizeClips(Array.from({ length: 40 }, (_, i) => ({ start: i, end: i + 0.5 }))).length, 32);
  });

  test('lookDuration: 30 by default, held to 1..600', () => {
    assert.equal(lookDuration({}), 30);
    assert.equal(lookDuration(null), 30);
    assert.equal(lookDuration({ duration: '45' }), 30);
    assert.equal(lookDuration({ duration: 45.5 }), 45.5);
    assert.equal(lookDuration({ duration: 0.2 }), 1);
    assert.equal(lookDuration({ duration: 9999 }), 600);
  });
});

describe('renderFrame with clips', () => {
  const scene = prepareScene(rig);

  /** A hand-made "compiled" pattern that counts its calls and records the t it was given. */
  function spy(color = [1, 1, 1]) {
    const s = { pixels: 0, frames: 0, t: null };
    s.compiled = { pixel: (p, t) => { s.pixels++; s.t = t; return color; }, frame: () => { s.frames++; }, params: {} };
    return s;
  }

  test('carries clips through prepareLayer', () => {
    const L = prepareLayer(scene, { id: 'a', clips: [{ start: 4, end: 5 }, { start: 1, end: 2, fadeIn: 0.5 }] },
      compilePattern(WHITE));
    assert.deepEqual(L.clips, [clip(1, 2, 0.5), clip(4, 5)]);
    assert.equal(prepareLayer(scene, { id: 'b' }, compilePattern(WHITE)).clips, null);
    assert.equal(prepareLayer(scene, { id: 'c', clips: [] }, compilePattern(WHITE)).clips, null);
  });

  test('outside its clips a layer does not run at all: no frame(), no pixel()', () => {
    const s = spy();
    const L = prepareLayer(scene, { id: 'a', clips: [{ start: 1, end: 2 }] }, s.compiled);
    const out = new Float32Array(scene.count * 3);
    for (const t of [0, 0.999, 2, 2.5, 30]) {
      renderFrame(scene, [L], t, out);
      assert.ok(out.every((v) => v === 0), `dark at t = ${t}`);
    }
    assert.equal(s.pixels, 0);
    assert.equal(s.frames, 0);
    renderFrame(scene, [L], 1.5, out);
    assert.equal(s.frames, 1);
    assert.equal(s.pixels, scene.count);
    assert.equal(out[0], 1);
  });

  test('the envelope scales the level; t stays show time', () => {
    const s = spy([0.8, 0.4, 0.2]);
    const L = prepareLayer(scene, { id: 'a', level: 0.5, clips: [{ start: 10, end: 20, fadeIn: 4 }] }, s.compiled);
    const { rgb } = renderFrame(scene, [L], 11);
    near(rgb[0], 0.8 * 0.5 * 0.25, 1e-6);
    near(rgb[1], 0.4 * 0.5 * 0.25, 1e-6);
    assert.equal(s.t, 11, 'pattern time is show time, not clip time');
    // Blends other than add see the scaled level too.
    const base = prepareLayer(scene, { id: 'base' }, compilePattern('function pixel() { return [0, 0, 1]; }'));
    const over = prepareLayer(scene, { id: 'o', blend: 'over', clips: [clip(0, 2, 2)] }, compilePattern(RED));
    const mixed = renderFrame(scene, [base, over], 1).rgb;
    near(mixed[0], 0.5, 1e-6);
    near(mixed[2], 0.5, 1e-6);
  });

  test('a layer with clips that never start is free; other layers render as before', () => {
    const s = spy();
    const off = prepareLayer(scene, { id: 'off', clips: [{ start: 500, end: 600 }] }, s.compiled);
    const on = prepareLayer(scene, { id: 'on' }, compilePattern('function pixel() { return [0.25, 0.5, 0.75]; }'));
    const { rgb, errors } = renderFrame(scene, [off, on], 3);
    assert.deepEqual(errors, []);
    assert.equal(s.pixels, 0);
    near(rgb[0], 0.25, 1e-6);
    near(rgb[2], 0.75, 1e-6);
  });
});

describe('validation', () => {
  const layer = (clips, extra = {}) => ({ code: WHITE, clips, ...extra });

  test('API: clips are cleaned, sorted and kept to the millisecond', () => {
    const [l] = validateLayers([layer([{ start: 5, end: 6.00049 }, { start: 0, end: 2, fadeIn: 0.5 }])]);
    assert.deepEqual(l.clips, [
      { start: 0, end: 2, fadeIn: 0.5, fadeOut: 0 },
      { start: 5, end: 6, fadeIn: 0, fadeOut: 0 },
    ]);
    const [none] = validateLayers([layer([])]);
    assert.equal('clips' in none, false, 'empty clips: always on, stored as no clips');
    assert.equal('clips' in validateLayers([{ code: WHITE }])[0], false);
    // Fades longer than the clip are kept; the envelope shrinks them when it plays.
    assert.deepEqual(validateLayers([layer([clip(0, 1, 3, 3)])])[0].clips, [clip(0, 1, 3, 3)]);
  });

  test('API: overlaps, out-of-range and malformed clips are refused', () => {
    const refuse = (clips, re) => assert.throws(() => validateLayers([layer(clips)]),
      (e) => e.status === 400 && re.test(e.message), JSON.stringify(clips));
    refuse([{ start: 0, end: 3 }, { start: 2, end: 4 }], /clips overlap/);
    refuse([{ start: 4, end: 6 }, { start: 0, end: 4.5 }], /clips overlap/);
    refuse([{ start: -1, end: 2 }], /start must be a number of seconds from 0 to 600/);
    refuse([{ start: 0, end: 601 }], /end must be/);
    refuse([{ start: 2, end: 2 }], /end must be after start/);
    refuse([{ start: 3, end: 2 }], /end must be after start/);
    refuse([{ start: 0, end: 1, fadeIn: -0.5 }], /fadeIn must be/);
    refuse([{ start: 0, end: 1, fadeOut: NaN }], /fadeOut must be/);
    refuse([{ start: '0', end: 1 }], /start must be/);
    refuse([{ end: 1 }], /start must be/);
    refuse([[0, 1]], /clip 1 must be an object/);
    refuse({ start: 0, end: 1 }, /clips must be an array/);
    refuse(Array.from({ length: 33 }, (_, i) => ({ start: i, end: i + 0.5 })), /at most 32 clips/);
    const most = Array.from({ length: 32 }, (_, i) => clip(i, i + 1));
    assert.equal(validateLayers([layer(most)])[0].clips.length, 32);
  });

  test('generator: clips and duration are normalised, bad ones dropped and noted', () => {
    const v = validateLook({
      title: 'Storm',
      summary: 'Calm, then a storm.',
      duration: '90',
      layers: [
        { title: 'Base', code: WHITE },
        {
          title: 'Storm', code: WHITE,
          clips: [{ start: 40, end: 90, fadeIn: 5, fadeOut: -2 }, { start: 30, end: 45 }, { start: 'x', end: 3 },
            clip(0, 10)],
        },
        { title: 'Odd', code: WHITE, clips: 'soon' },
      ],
    });
    assert.equal(v.duration, 90);
    assert.equal('clips' in v.layers[0], false);
    assert.deepEqual(v.layers[1].clips, [clip(0, 10), clip(30, 45)]);
    assert.equal('clips' in v.layers[2], false);
    assert.equal(v.dropped.length, 3);
    assert.ok(v.dropped.some((d) => /overlapping/.test(d)));
    // What the generator keeps, the API accepts unchanged.
    assert.deepEqual(validateLayers(v.layers).map((l) => l.clips), v.layers.map((l) => l.clips));
    assert.equal(validateLook({ title: 't', layers: [{ code: WHITE }], duration: 5000 }).duration, 600);
    assert.equal('duration' in validateLook({ title: 't', layers: [{ code: WHITE }] }), false);
  });
});

/** A stand-in render box: frames for the real LED map, all lit, as long as it is asked. */
function fakeBox(maxSeconds = 4) {
  return {
    asked: [],
    config: { seconds: maxSeconds },
    probe: async () => ({ ok: true }),
    async render({ seconds }) {
      this.asked.push(seconds);
      const frames = Math.round(Math.min(maxSeconds, seconds) * 40);
      const data = new Uint8Array(frames * 3).fill(100);
      const bytes = Buffer.from(writeFseq({ frames, data, ranges: [[0, 3]] }));
      return { bytes, boxStats: { untrusted: true, reported: {} } };
    },
  };
}

async function startApp(renderBox, name) {
  const generator = { enqueue() {}, async idle() {} };
  const dataDir = path.join(tmpRoot, name);
  const app = await createServer({ dataDir, publicDir: PUBLIC, generator, renderBox, log: quiet });
  const { port } = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const json = { 'content-type': 'application/json' };
  const account = JSON.stringify({ username: `${name}-owner`, password: 'correct horse' });
  const r = await fetch(`${base}/api/signup`, { method: 'POST', headers: json, body: account });
  const cookie = r.headers.getSetCookie()[0].split(';')[0];
  app.call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { cookie, ...json }, body: body && JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return app;
}

describe('the API: duration and bpm', () => {
  test('defaults, ranges, versions, and what drops a bake', async () => {
    const box = fakeBox();
    const app = await startApp(box, 'api');
    try {
      const plain = (await app.call('POST', '/api/looks', { title: 'Plain', layers: [{ code: WHITE }] })).json.look;
      assert.equal(plain.duration, 30, 'a look without one runs 30 s');
      assert.equal('bpm' in plain, false);

      const bads = [{ duration: 0.5 }, { duration: 601 }, { duration: '30' }, { duration: null }];
      bads.push({ bpm: 39 }, { bpm: 241 }, { bpm: '120' });
      for (const bad of bads) {
        const r = await app.call('POST', '/api/looks', { title: 'Bad', layers: [{ code: WHITE }], ...bad });
        assert.equal(r.status, 400, JSON.stringify(bad));
        assert.match(r.json.error, /duration must be|bpm must be/);
      }
      const clipped = { code: WHITE, clips: [{ start: 1, end: 2 }] };
      const timed = { title: 'Timed', layers: [clipped], duration: 12.5, bpm: 128 };
      const look = (await app.call('POST', '/api/looks', timed)).json.look;
      assert.equal(look.duration, 12.5);
      assert.equal(look.bpm, 128);
      assert.deepEqual(look.layers[0].clips, [{ start: 1, end: 2, fadeIn: 0, fadeOut: 0 }]);
      const crossing = [{ code: WHITE, clips: [{ start: 0, end: 2 }, { start: 1, end: 3 }] }];
      const overlap = await app.call('PUT', `/api/looks/${look.id}`, { layers: crossing });
      assert.equal(overlap.status, 400);
      assert.match(overlap.json.error, /Layer 1: clips overlap/);

      // A bake covers the duration (up to the box's limit).
      assert.equal((await app.call('POST', `/api/looks/${look.id}/bake`, {})).status, 202);
      await app.bakes.idle();
      let now = (await app.call('GET', `/api/looks/${look.id}`)).json.look;
      assert.deepEqual(box.asked, [4]);
      assert.equal(now.bake.seconds, 4);
      assert.equal(now.bake.ok, true);

      // bpm is only a grid: the bake stays. bpm: null clears it.
      now = (await app.call('PUT', `/api/looks/${look.id}?versions=1`, { bpm: 100 })).json.look;
      assert.equal(now.bpm, 100);
      assert.equal(now.bake.ok, true);
      assert.equal(now.versions.length, 0);
      now = (await app.call('PUT', `/api/looks/${look.id}`, { bpm: null })).json.look;
      assert.equal('bpm' in now, false);

      // The same duration changes nothing; a new one is a new version and drops the bake.
      now = (await app.call('PUT', `/api/looks/${look.id}?versions=1`, { duration: 12.5 })).json.look;
      assert.equal(now.versions.length, 0);
      assert.equal(now.bake.ok, true);
      now = (await app.call('PUT', `/api/looks/${look.id}?versions=1`, { duration: 3 })).json.look;
      assert.equal(now.duration, 3);
      assert.equal(now.versions.length, 1);
      assert.equal(now.versions[0].duration, 12.5);
      assert.equal('bake' in now, false);
      assert.equal((await app.call('PUT', `/api/looks/${look.id}`, { duration: 0 })).status, 400);

      // A shorter look bakes only its own length.
      await app.call('POST', `/api/looks/${look.id}/bake`, {});
      await app.bakes.idle();
      assert.deepEqual(box.asked, [4, 3]);
      assert.equal((await app.call('GET', `/api/looks/${look.id}`)).json.look.bake.analysis.frames, 120);
    } finally {
      await app.close();
    }
  });

  test('bakeSeconds: the duration, 30 by default, capped by the box', () => {
    assert.equal(bakeSeconds({}), 30);
    assert.equal(bakeSeconds({ duration: 200 }), 120);
    assert.equal(bakeSeconds({ duration: 200 }, 600), 200);
    assert.equal(bakeSeconds({ duration: 7.5 }, 4), 4);
  });
});

// The real render box (bubblewrap). Skips, saying why, where it cannot run.
const probe = await createRenderBox({ log: quiet }).probe();
const skip = !probe.ok && `render box unavailable here: ${probe.reason}`;
describe('baking a sequenced look in the render box', { skip }, () => {
  test('a 2-clip layer over a dim base: lit in its clips, dark between, for the look\'s duration', async () => {
    const box = createRenderBox({ seconds: 120, log: quiet });
    const layers = [
      { id: 'base', code: 'function pixel() { return [0, 0, 0.2]; }', groups: ['cathedral'] },
      { id: 'hits', code: RED, groups: ['cathedral'], clips: [clip(0.5, 1.5), clip(2.5, 3.5, 0.5)] },
    ];
    const { bytes, seconds } = await box.render({ layers, seconds: 4 });
    assert.equal(seconds, 4);
    const f = parseFseq(bytes);
    assert.equal(f.frameCount, 160);
    // The first LED's red and blue channels, frame by frame (sparse data starts at its address).
    const red = (n) => f.data[n * f.channelCount];
    const blue = (n) => f.data[n * f.channelCount + 2];
    for (let n = 0; n < 160; n++) assert.equal(blue(n), 51, `base on at frame ${n}`);
    for (const n of [0, 19, 60, 99, 140, 159]) assert.equal(red(n), 0, `dark at frame ${n}`);
    for (const n of [20, 40, 59, 120, 139]) assert.equal(red(n), 255, `lit at frame ${n}`);
    assert.equal(red(100), 0, 'fading in from 0');
    assert.equal(red(110), 128, 'half way through the fade');
  });
});
