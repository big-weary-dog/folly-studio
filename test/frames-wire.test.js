// The streaming wire format: src/frames-wire.js encodes, public/js/frames-stream.js decodes and plays chunks
// as they arrive. Round trips must be exact.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

import { compilePattern, prepareLayer, prepareScene, renderFrame, toChannels } from '../public/js/pattern-core.js';
import {
  autoFetchAllowed, decodeChunk, fetchManifest, MODES, openFrameStream, parseManifest, readFrame,
} from '../public/js/frames-stream.js';
import {
  CHUNK_FRAMES, encodeWire, gzipChunk, layoutChunk, MODES as SERVER_MODES, wireHash,
} from '../src/frames-wire.js';

/** A small deterministic random source (tests stay reproducible). */
function random(seed = 1) {
  let x = seed >>> 0;
  return () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) >>> 24;
}

/** Frames whose channels mix noise, slow ramps and runs: every layout gets something to do. */
function frames(count, channels, seed) {
  const rnd = random(seed);
  const data = new Uint8Array(count * channels);
  for (let f = 0; f < count; f++) {
    for (let c = 0; c < channels; c++) {
      data[f * channels + c] = c % 3 === 0 ? rnd() : c % 3 === 1 ? (f * 3 + c) & 255 : 0;
    }
  }
  return data;
}

const parsedOf = (data, channels, ranges = [[0, channels]]) =>
  ({ data, channelCount: channels, frameCount: data.length / channels, stepMs: 25, ranges });

async function encode(parsed, quality = 4) {
  const chunks = [];
  const modes = [];
  const onChunk = (n, bytes, mode) => {
    chunks[n] = bytes;
    modes[n] = mode;
  };
  const manifest = await encodeWire(parsed, { hash: 'ab'.repeat(16), quality, onChunk });
  return { manifest, chunks, modes };
}

/** Every frame decoded from the wire equals the original, byte for byte. */
function assertExact(manifest, chunks, data) {
  const m = parseManifest(JSON.parse(JSON.stringify(manifest)));
  const out = new Uint8Array(m.channels);
  let checked = 0;
  for (let n = 0; n < chunks.length; n++) {
    const chunk = decodeChunk(new Uint8Array(zlib.brotliDecompressSync(chunks[n])), m, n);
    for (let j = 0; j < chunk.frames; j++, checked++) {
      readFrame(chunk, j, out);
      const f = n * m.chunkFrames + j;
      assert.deepEqual(out, data.subarray(f * m.channels, (f + 1) * m.channels), `frame ${f}`);
    }
  }
  assert.equal(checked, m.frames);
}

describe('wire format', () => {
  test('each layout round-trips exactly, across chunk boundaries and a short last chunk', () => {
    assert.deepEqual([...MODES], [...SERVER_MODES], 'encoder and decoder agree on the layouts');
    const C = 37;
    const data = frames(2 * CHUNK_FRAMES + 43, C, 7);
    const m = { channels: C, frames: data.length / C, chunkFrames: CHUNK_FRAMES };
    const out = new Uint8Array(C);
    for (const mode of MODES) {
      for (let n = 0; n < 3; n++) {
        const count = Math.min(CHUNK_FRAMES, m.frames - n * CHUNK_FRAMES);
        const bytes = new Uint8Array(1 + count * C);
        bytes[0] = MODES.indexOf(mode);
        layoutChunk(data, C, n * CHUNK_FRAMES, count, mode, bytes.subarray(1));
        const chunk = decodeChunk(bytes, { ...m, chunks: [{}, {}, {}] }, n);
        assert.equal(chunk.frames, count);
        for (const j of [0, 1, count - 1]) {
          const f = n * CHUNK_FRAMES + j;
          assert.deepEqual(readFrame(chunk, j, out), data.subarray(f * C, f * C + C), `${mode} frame ${f}`);
        }
      }
    }
  });

  test('random frames: the encoder picks a layout per chunk and the whole round-trips', async () => {
    const data = frames(3 * CHUNK_FRAMES + 1, 61, 3);
    const { manifest, chunks } = await encode(parsedOf(data, 61));
    assert.equal(manifest.chunks.length, 4);
    assert.equal(manifest.bytes, chunks.reduce((n, c) => n + c.length, 0));
    assert.deepEqual(manifest.chunks.map((c) => c.bytes), chunks.map((c) => c.length));
    assertExact(manifest, chunks, data);
  });

  test('real frames from the library round-trip, smooth looks as planar deltas', async () => {
    const cathedral = JSON.parse(readFileSync(new URL('../public/data/cathedral.json', import.meta.url), 'utf8'));
    const scene = prepareScene(cathedral);
    const C = scene.frameChannels;
    for (const name of ['palette-drift', 'meteors']) {
      const code = readFileSync(new URL(`../public/patterns/${name}.js`, import.meta.url), 'utf8');
      const layer = prepareLayer(scene, { id: name, groups: ['cathedral'] }, compilePattern(code));
      const F = CHUNK_FRAMES + 20;
      const data = new Uint8Array(F * C);
      const rgb = new Float32Array(scene.count * 3);
      for (let f = 0; f < F; f++) {
        toChannels(scene, renderFrame(scene, [layer], f / 40, rgb).rgb, data.subarray(f * C, (f + 1) * C));
      }
      const { manifest, chunks, modes } = await encode(parsedOf(data, C));
      assertExact(manifest, chunks, data);
      assert.ok(manifest.bytes < data.length / 8, `${name}: ${manifest.bytes} bytes`);
      if (name === 'palette-drift') assert.equal(modes[0], 'planar-delta');
      if (name === 'meteors') assert.equal(modes[0], 'frames', 'sharp motion: no deltas');
    }
  });

  test('wireHash names the frames and the format, nothing else', () => {
    const sha = 'f'.repeat(64);
    assert.match(wireHash(sha), /^[0-9a-f]{32}$/);
    assert.equal(wireHash(sha), wireHash(sha));
    assert.notEqual(wireHash(sha), wireHash('e'.repeat(64)));
    assert.throws(() => wireHash('../x'), TypeError);
  });

  test('decodeChunk refuses a chunk of the wrong size or layout', () => {
    const m = { channels: 4, frames: 10, chunkFrames: 8, chunks: [{}, {}] };
    assert.equal(decodeChunk(new Uint8Array(9), m, 1).frames, 2);
    assert.throws(() => decodeChunk(new Uint8Array(10), m, 1), /holds 10 bytes, not 1 \+ 2 frames × 4 channels/);
    assert.throws(() => decodeChunk(new Uint8Array(9), m, 2), /no chunk 2/);
    assert.throws(() => decodeChunk(new Uint8Array(9).fill(4, 0, 1), m, 1), /unknown layout \(4\)/);
  });

  test('the gzip fallback picks its own layout and holds the same frames', async () => {
    const C = 61;
    const data = frames(CHUNK_FRAMES + 20, C, 5);
    const { manifest, chunks } = await encode(parsedOf(data, C));
    assert.equal(chunks.length, 2);
    const m = parseManifest(manifest);
    const out = new Uint8Array(C);
    for (let n = 0; n < chunks.length; n++) {
      const chunk = decodeChunk(new Uint8Array(zlib.gunzipSync(await gzipChunk(chunks[n], C))), m, n);
      for (let j = 0; j < chunk.frames; j++) {
        const f = n * CHUNK_FRAMES + j;
        assert.deepEqual(readFrame(chunk, j, out), data.subarray(f * C, (f + 1) * C), `frame ${f}`);
      }
    }
  });
});

describe('manifest', () => {
  const good = () => ({
    version: 1, hash: 'ab'.repeat(16), frames: 170, fps: 40, channels: 9, ranges: [[0, 6], [510, 3]],
    chunkFrames: 80,
    chunks: [{ bytes: 10 }, { bytes: 20 }, { bytes: 5 }],
    bytes: 35,
  });

  test('a good manifest comes back as a clean copy', () => {
    const m = parseManifest({ ...good(), extra: 'ignored' });
    assert.deepEqual(m, good());
    assert.deepEqual(parseManifest({ ...good(), ranges: [] }).ranges, [[0, 9]], 'no ranges: every channel');
  });

  test('anything malformed is refused', () => {
    const bad = (patch, why) => assert.throws(() => parseManifest({ ...good(), ...patch }), why);
    assert.throws(() => parseManifest(null), /not an object/);
    bad({ version: 2 }, /version 2/);
    bad({ hash: '../../etc' }, /hash/);
    bad({ frames: 0 }, /frames/);
    bad({ frames: 1.5 }, /frames/);
    bad({ fps: 0 }, /fps/);
    bad({ channels: 40801 }, /channels/);
    bad({ ranges: [[0, 6], [3, 3]] }, /ranges/);
    bad({ ranges: [[0, 6], [510, 4]] }, /add up to the channels/);
    bad({ ranges: [[40799, 9]] }, /ranges/);
    bad({ chunkFrames: 0 }, /chunkFrames/);
    bad({ frames: 250 }, /chunk count/);
    bad({ chunks: [...good().chunks.slice(0, 2), { bytes: 5.5 }] }, /chunk/);
    bad({ chunks: [{ bytes: 0 }, ...good().chunks.slice(1)], bytes: 25 }, /chunk/);
    bad({ bytes: 36 }, /sizes do not add up/);
  });
});

/** A small LED map: 30 LEDs on universe 1 and 4 on universe 3, sparse ranges as the render box writes them. */
function smallMap() {
  const universe = [], channel = [];
  for (let k = 0; k < 30; k++) { universe.push(1); channel.push(k * 3 + 1); }
  for (let k = 0; k < 4; k++) { universe.push(3); channel.push(k * 3 + 1); }
  const cathedral = { count: 34, channelsPerUniverse: 510, pixels: { universe, channel } };
  return { cathedral, ranges: [[0, 90], [1020, 12]] };
}

/** A fetch that serves one encoded bake; chunk responses can be held back with hold(n). */
function fakeServer(manifest, chunks, { pending = 0 } = {}) {
  const calls = [];
  const held = new Map();
  const reply = (status, body, headers = {}) => ({
    status, ok: status >= 200 && status < 300, headers: new Headers(headers),
    json: async () => body, arrayBuffer: async () => body,
  });
  async function fetch(url) {
    calls.push(url);
    if (url.endsWith('/frames/wire')) {
      return pending-- > 0 ? reply(202, { pending: true }, { 'retry-after': '1' }) : reply(200, manifest);
    }
    const n = Number(url.split('/').pop());
    if (!url.includes(`/frames/${manifest.hash}/`) || !chunks[n]) return reply(404, { error: 'No such chunk.' });
    if (held.has(n)) await held.get(n).promise;
    const raw = zlib.brotliDecompressSync(chunks[n]); // the browser undoes Content-Encoding: br
    return reply(200, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
  }
  function hold(n) {
    let release;
    held.set(n, { promise: new Promise((r) => (release = r)) });
    return () => { held.delete(n); release(); };
  }
  const chunkCalls = () => calls.filter((u) => !u.endsWith('/wire')).map((u) => Number(u.split('/').pop()));
  return { fetch, calls, hold, chunkCalls };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('streaming playback', () => {
  const { cathedral, ranges } = smallMap();
  const C = 102;
  const data = frames(5 * CHUNK_FRAMES + 7, C, 11);
  const expect = (f) => {
    const rgb = new Float32Array(34 * 3);
    for (let k = 0; k < 34; k++) {
      const at = k < 30 ? k * 3 : 90 + (k - 30) * 3;
      for (let i = 0; i < 3; i++) rgb[k * 3 + i] = data[f * C + at + i] / 255;
    }
    return rgb;
  };

  test('starts after the first chunk, reads exact frames, prefetches and seeks chunk by chunk', async () => {
    const { manifest, chunks } = await encode(parsedOf(data, C, ranges));
    const srv = fakeServer(manifest, chunks);
    const late = srv.hold(4);
    const arrived = [];
    const stream = await openFrameStream('look1', cathedral, { fetch: srv.fetch, onChunk: (n) => arrived.push(n) });
    assert.equal(srv.calls[0], '/api/looks/look1/frames/wire');
    assert.equal(srv.calls[1], `/api/looks/look1/frames/${manifest.hash}/0`);
    assert.equal(stream.frameCount, data.length / C);
    assert.equal(stream.fps, 40);
    assert.equal(stream.bytes, manifest.bytes);
    const rgb = new Float32Array(34 * 3);
    for (const f of [0, 1, 79]) assert.deepEqual(stream.frameAt(f, rgb), expect(f), `frame ${f}`);
    await tick();
    assert.deepEqual(srv.chunkCalls().sort(), [0, 1, 2], 'two chunks ahead');
    assert.deepEqual(stream.frameAt(80, rgb), expect(80), 'across the boundary');
    assert.deepEqual(stream.frameAt(CHUNK_FRAMES * 2 - 1, rgb), expect(CHUNK_FRAMES * 2 - 1));

    // A seek into a chunk that is not here yet keeps the frame on show, then says when it lands.
    const last = stream.frameCount - 1;
    const shown = Float32Array.from(stream.frameAt(10, rgb));
    assert.deepEqual(stream.frameAt(5 * CHUNK_FRAMES + 3, rgb), shown, 'chunk 5 is on its way');
    await tick();
    assert.ok(srv.chunkCalls().includes(5));
    assert.deepEqual(arrived, [5]);
    assert.deepEqual(stream.frameAt(last, rgb), expect(last), 'the short last chunk');
    assert.deepEqual(stream.frameAt(5 * CHUNK_FRAMES + 3, rgb), expect(5 * CHUNK_FRAMES + 3));
    assert.deepEqual(stream.frameAt(last + 50, rgb), expect(last), 'past the end: the last frame');

    assert.deepEqual(stream.frameAt(4 * CHUNK_FRAMES, rgb), expect(last), 'chunk 4 is held back');
    late();
    await tick();
    await tick();
    assert.deepEqual(arrived, [5, 4]);
    assert.deepEqual(stream.frameAt(4 * CHUNK_FRAMES, rgb), expect(4 * CHUNK_FRAMES));
    assert.deepEqual(stream.frameAt(3, rgb), expect(3), 'and back to the start');
    assert.equal(new Set(srv.chunkCalls()).size, srv.chunkCalls().length, 'no chunk fetched twice');
  });

  test('waits while the server is still encoding, then plays', async () => {
    const { manifest, chunks } = await encode(parsedOf(data, C, ranges));
    const srv = fakeServer(manifest, chunks, { pending: 2 });
    const waits = [];
    const wait = async (ms) => waits.push(ms);
    assert.equal((await fetchManifest('x', { fetch: srv.fetch, wait })).hash, manifest.hash);
    assert.deepEqual(waits, [1000, 1000]);
    const error = { error: 'This look has no baked frames.' };
    const gone = async () => ({ status: 404, ok: false, headers: new Headers(), json: async () => error });
    await assert.rejects(openFrameStream('x', cathedral, { fetch: gone }), { status: 404, message: /no baked frames/ });
  });
});

describe('save-data', () => {
  test('frames download on their own only on a fast, unmetered, non-phone link', () => {
    const nav = (connection, extra = {}) => ({ connection, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', ...extra });
    assert.equal(autoFetchAllowed(nav(undefined)), true, 'no Network Information API: a desktop');
    assert.equal(autoFetchAllowed(nav({ effectiveType: '4g', saveData: false })), true);
    assert.equal(autoFetchAllowed(nav({ effectiveType: '4g', saveData: true })), false, 'Save-Data');
    for (const t of ['slow-2g', '2g', '3g']) assert.equal(autoFetchAllowed(nav({ effectiveType: t })), false, t);
    assert.equal(autoFetchAllowed(nav({ type: 'cellular', effectiveType: '4g' })), false, 'cellular');
    assert.equal(autoFetchAllowed(nav({ type: 'wifi' }, { userAgentData: { mobile: true } })), false, 'a phone');
    assert.equal(autoFetchAllowed(nav({}, { userAgentData: { mobile: false } })), true);
    assert.equal(autoFetchAllowed({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148' }), false);
    assert.equal(autoFetchAllowed(undefined), true);
  });
});
