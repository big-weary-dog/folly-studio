// What the server keeps beside baked frames so they travel small (SPEC "Baked frames"), in
// <framesDir>/<hash>/ with <hash> = wireHash(look.bake.frames.sha256): <n>.br chunks and manifest.json
// (written last) after a bake; <n>.gz chunks and frames.<codec>.fseq downloads on first request. Looks
// with the same frames share a folder; prune() removes folders no bake names. One encode at a time.
//   wire(look) → { state: none | pending | failed | ready, hash?, done?, chunks? } (encodes when needed)
//   chunk(hash, n, br | gzip | null) → { body, encoding } | null;  fseq(look, codec) → path | null

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

import { framesBytesFor, framesPath, writeAtomic } from './bake.js';
import { parseFseq } from './frames.js';
import { CHUNK_FRAMES, encodeWire, gzipChunk, WIRE_QUALITY, wireHash } from './frames-wire.js';
import { compressFseq, inflateBlock } from './fseq-codec.js';

const HASH = /^[0-9a-f]{32}$/;
const MAX_FRAMES_BYTES = framesBytesFor(600); // the longest bake there can be
const unbrotli = promisify(zlib.brotliDecompress);
const exists = (file) => fs.stat(file).then((st) => st.isFile(), () => false);

export function createFramesCache({ framesDir, store, log = console, quality = WIRE_QUALITY }) {
  const jobs = new Map();   // hash → { promise, done, chunks }: encodes queued or running
  const failed = new Set(); // hashes whose frames could not be encoded (until a restart)
  const making = new Map(); // file → Promise: gzip chunks and .fseq downloads being made
  let queue = Promise.resolve();
  const dir = (hash) => path.join(framesDir, hash);
  function hashOf(look) {
    const sha = look?.bake?.frames?.sha256;
    return typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha) ? wireHash(sha) : null;
  }

  /** The look's stored frames, parsed, if they are still the bake's (same SHA-256). */
  async function readFrames(look) {
    const bytes = await fs.readFile(framesPath(framesDir, look.id)).catch(() => null);
    if (!bytes) return null;
    if (createHash('sha256').update(bytes).digest('hex') !== look.bake.frames.sha256) return null;
    return parseFseq(bytes, { maxBytes: MAX_FRAMES_BYTES, decompress: inflateBlock });
  }

  async function run(look, hash, job) {
    if (await exists(path.join(dir(hash), 'manifest.json'))) return true;
    const parsed = await readFrames(look);
    if (!parsed) return false;
    job.chunks = Math.ceil(parsed.frameCount / CHUNK_FRAMES);
    const started = Date.now();
    await fs.mkdir(dir(hash), { recursive: true });
    const manifest = await encodeWire(parsed, {
      hash, quality,
      onChunk: async (n, bytes) => {
        await writeAtomic(path.join(dir(hash), `${n}.br`), bytes);
        job.done = n + 1;
      },
    });
    await writeAtomic(path.join(dir(hash), 'manifest.json'), JSON.stringify(manifest));
    log.info?.(`[frames] look ${look.id}: ${parsed.frameCount} frames, ${manifest.bytes} bytes to stream `
      + `(${(manifest.bytes / parsed.data.length * 100).toFixed(1)} %), ${Date.now() - started} ms`);
    return true;
  }

  /** Queue a look's frames for encoding; resolves true once its chunks are stored. */
  function encode(lookOrId) {
    const look = typeof lookOrId === 'string' ? store.looks.get(lookOrId) : lookOrId;
    const hash = hashOf(look);
    if (!hash) return Promise.resolve(false);
    if (jobs.has(hash)) return jobs.get(hash).promise;
    const job = { done: 0, chunks: 0 };
    const p = queue.then(() => run(look, hash, job)).catch((err) => {
      log.error?.(`[frames] look ${look.id}: could not encode its frames:`, err);
      return false;
    });
    queue = p;
    job.promise = p.then((ok) => {
      jobs.delete(hash);
      if (!ok) failed.add(hash);
      return prune().then(() => ok);
    });
    jobs.set(hash, job);
    return job.promise;
  }

  async function wire(look) {
    const hash = hashOf(look);
    if (!hash) return { state: 'none' };
    if (await exists(path.join(dir(hash), 'manifest.json'))) return { state: 'ready', hash };
    if (failed.has(hash)) return { state: 'failed', hash };
    if (!jobs.has(hash)) {
      if (!(await exists(framesPath(framesDir, look.id)))) return { state: 'none' };
      encode(look); // an older bake, or one a restart cut short
    }
    const job = jobs.get(hash);
    return { state: 'pending', hash, done: job?.done ?? 0, chunks: job?.chunks ?? 0 };
  }

  const read = (file) => fs.readFile(file).catch(() => null);

  /** `file`, made by build() unless it is there already; one build at a time per file. */
  async function made(file, build) {
    if (await exists(file)) return file;
    if (!making.has(file)) {
      const p = (async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await writeAtomic(file, await build());
        return file;
      })();
      making.set(file, p);
      p.catch(() => {}).finally(() => making.delete(file));
    }
    return making.get(file);
  }

  async function chunk(hash, n, encoding) {
    if (!HASH.test(hash) || !Number.isInteger(n) || n < 0) return null;
    const br = path.join(dir(hash), `${n}.br`);
    if (encoding === 'br') {
      const body = await read(br);
      return body && { body, encoding: 'br' };
    }
    if (!(await exists(br))) return null;
    if (encoding === 'gzip') {
      const manifest = path.join(dir(hash), 'manifest.json');
      if (!(await exists(manifest))) return null; // still being encoded
      const gz = async () => gzipChunk(await fs.readFile(br),
        JSON.parse(await fs.readFile(manifest, 'utf8')).channels);
      const file = await made(path.join(dir(hash), `${n}.gz`), gz);
      return { body: await fs.readFile(file), encoding: 'gzip' };
    }
    return { body: await unbrotli(await fs.readFile(br)), encoding: null };
  }

  async function fseq(look, codec) {
    const hash = hashOf(look);
    if (!hash || !(await exists(framesPath(framesDir, look.id)))) return null;
    return made(path.join(dir(hash), `frames.${codec}.fseq`), async () => {
      const parsed = await readFrames(look);
      if (!parsed) throw new Error(`the frames of look ${look.id} changed`);
      return compressFseq(parsed, { codec });
    });
  }

  /** Remove hash folders that no look's bake names (and that nothing is encoding). */
  async function prune() {
    const live = new Set([...jobs.keys(), ...store.looks.list((l) => hashOf(l)).map(hashOf)]);
    const names = await fs.readdir(framesDir).catch(() => []);
    const dead = names.filter((name) => HASH.test(name) && !live.has(name));
    await Promise.all(dead.map((name) => fs.rm(dir(name), { recursive: true, force: true }).catch(() => {})));
  }

  return {
    hashOf, wire, encode, chunk, fseq, prune,
    manifest: (hash) => (HASH.test(hash) ? read(path.join(dir(hash), 'manifest.json')) : Promise.resolve(null)),
    async idle() {
      while (jobs.size || making.size) {
        await Promise.all([...[...jobs.values()].map((j) => j.promise), ...making.values()]).catch(() => {});
      }
    },
  };
}
