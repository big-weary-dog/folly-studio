// What the server keeps beside baked frames so they travel small (SPEC "Baked frames"), in
// <framesDir>/<hash>/ with <hash> = wireHash(look.bake.frames.sha256): <n>.br chunks and manifest.json
// (written last) after a bake; <n>.gz chunks and frames.<codec>.fseq downloads on first request. Looks
// with the same frames share a folder; prune() removes folders no bake names. The encoding runs in a
// low-priority worker thread, one job at a time (src/frames-jobs.js), wire encodes in the lane bakes use.
// The folder stays under a disk cap (src/frames-disk.js); frames it evicted are baked again on demand.
//   wire(look) → { state: none | pending | failed | ready, hash?, done?, chunks? } (encodes or re-bakes when needed)
//   chunk(hash, n, br | gzip | null) → { body, encoding } | null;  fseq(look, codec) → path | null

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

import { framesBytesFor, framesPath } from './bake.js';
import { createFramesDisk } from './frames-disk.js';
import { createFrameJobs, createLane } from './frames-jobs.js';
import { WIRE_QUALITY, wireHash } from './frames-wire.js';

const HASH = /^[0-9a-f]{32}$/;
const MAX_FRAMES_BYTES = framesBytesFor(600); // the longest bake there can be
const unbrotli = promisify(zlib.brotliDecompress);
const exists = (file) => fs.stat(file).then((st) => st.isFile(), () => false);

/**
 * createFramesCache({ framesDir, store, log, quality, maxBytes, lane, jobs, rebake }): `lane` is shared with
 * the bake queue; `rebake(look)` → true when it queued a bake for frames that are gone (bakes.restore).
 */
export function createFramesCache({ framesDir, store, log = console, quality = WIRE_QUALITY, maxBytes,
  lane = createLane(), jobs = createFrameJobs({ log }), rebake = async () => false }) {
  quality = Math.min(11, Math.max(1, Math.round(Number(quality) || WIRE_QUALITY))); // brotli's 1..11
  const encoding = new Map(); // hash → { promise, done, chunks, sha }: encodes queued or running
  const failed = new Set();   // hashes whose frames could not be encoded (until a restart)
  const making = new Map();   // file → { promise, sha }: gzip chunks and .fseq downloads being made
  const dir = (hash) => path.join(framesDir, hash);
  const shaOf = (look) => {
    const sha = look?.bake?.frames?.sha256;
    return typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha) ? sha : null;
  };
  const hashOf = (look) => (shaOf(look) ? wireHash(shaOf(look)) : null);
  const busy = () => new Set([...encoding.values(), ...making.values()].map((j) => j.sha));
  const disk = createFramesDisk({ framesDir, store, maxBytes, busy, log });

  async function run(look, hash, job) {
    if (await exists(path.join(dir(hash), 'manifest.json'))) return true;
    const file = framesPath(framesDir, look.id);
    if (!(await exists(file))) return false;
    const started = Date.now();
    const r = await jobs.run('wire', { file, sha256: job.sha, dir: dir(hash), hash, quality,
      maxBytes: MAX_FRAMES_BYTES }, (p) => Object.assign(job, p));
    log.info?.(`[frames] look ${look.id}: ${r.frames} frames, ${r.bytes} bytes to stream `
      + `(${(r.bytes / r.raw * 100).toFixed(1)} %, brotli ${quality}), ${Date.now() - started} ms`);
    return true;
  }

  /** Queue a look's frames for encoding; resolves true once its chunks are stored. */
  function encode(lookOrId) {
    const look = typeof lookOrId === 'string' ? store.looks.get(lookOrId) : lookOrId;
    const hash = hashOf(look);
    if (!hash) return Promise.resolve(false);
    if (encoding.has(hash)) return encoding.get(hash).promise;
    const job = { done: 0, chunks: 0, sha: shaOf(look) };
    job.promise = lane.run(() => run(look, hash, job)).catch((err) => {
      log.error?.(`[frames] look ${look.id}: could not encode its frames:`, err);
      return false;
    }).then((ok) => {
      encoding.delete(hash);
      if (!ok) failed.add(hash);
      return prune().then(() => disk.enforce()).then(() => ok);
    });
    encoding.set(hash, job);
    disk.touch(look);
    return job.promise;
  }

  async function wire(look) {
    const hash = hashOf(look);
    if (!hash) return { state: 'none' };
    if (await exists(path.join(dir(hash), 'manifest.json'))) {
      disk.touch(look);
      return { state: 'ready', hash };
    }
    if (failed.has(hash)) return { state: 'failed', hash };
    if (!encoding.has(hash)) {
      if (await exists(framesPath(framesDir, look.id))) encode(look); // an older bake, or a restart cut it short
      else if (await rebake(look)) return { state: 'pending', hash, done: 0, chunks: 0 }; // evicted
      else return { state: 'none' };
    }
    const job = encoding.get(hash);
    return { state: 'pending', hash, done: job?.done ?? 0, chunks: job?.chunks ?? 0 };
  }

  const read = (file) => fs.readFile(file).catch(() => null);

  /** `file`, made by the worker's `kind` job unless it is there already; one at a time per file. */
  async function made(file, sha, kind, args) {
    if (await exists(file)) return file;
    if (!making.has(file)) {
      const job = { sha };
      job.promise = (async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await jobs.run(kind, { ...args, out: file });
        return file;
      })();
      making.set(file, job);
      job.promise.catch(() => {}).finally(() => {
        making.delete(file);
        disk.enforce();
      });
    }
    return making.get(file).promise;
  }

  async function chunk(hash, n, enc) {
    if (!HASH.test(hash) || !Number.isInteger(n) || n < 0) return null;
    const br = path.join(dir(hash), `${n}.br`);
    if (enc === 'br') {
      const body = await read(br);
      return body && { body, encoding: 'br' };
    }
    if (!(await exists(br))) return null;
    if (enc === 'gzip') {
      const manifest = await read(path.join(dir(hash), 'manifest.json'));
      if (!manifest) return null; // still being encoded
      const file = await made(path.join(dir(hash), `${n}.gz`), null, 'gzip',
        { br, channels: JSON.parse(manifest).channels });
      return { body: await fs.readFile(file), encoding: 'gzip' };
    }
    return { body: await unbrotli(await fs.readFile(br)), encoding: null };
  }

  /** A compressed download of the look's frames (made once), or null when they are gone (re-baked on demand). */
  async function fseq(look, codec) {
    const hash = hashOf(look);
    const file = framesPath(framesDir, look.id);
    if (!hash || !(await exists(file))) return null;
    disk.touch(look);
    return made(path.join(dir(hash), `frames.${codec}.fseq`), shaOf(look), 'fseq',
      { file, sha256: shaOf(look), codec, maxBytes: MAX_FRAMES_BYTES });
  }

  /** Remove hash folders that no look's bake names (and that nothing is encoding). */
  async function prune() {
    const live = new Set([...encoding.keys(), ...store.looks.list((l) => hashOf(l)).map(hashOf)]);
    const names = await fs.readdir(framesDir).catch(() => []);
    const dead = names.filter((name) => HASH.test(name) && !live.has(name));
    await Promise.all(dead.map((name) => fs.rm(dir(name), { recursive: true, force: true }).catch(() => {})));
  }

  return {
    hashOf, wire, encode, chunk, fseq, prune, disk,
    touch: (look) => disk.touch(look),
    /** Frames that are gone (evicted) are baked again: true when that is under way. */
    restore: (look) => rebake(look),
    manifest: (hash) => (HASH.test(hash) ? read(path.join(dir(hash), 'manifest.json')) : Promise.resolve(null)),
    async idle() {
      while (encoding.size || making.size) {
        await Promise.all([...encoding.values(), ...making.values()].map((j) => j.promise)).catch(() => {});
      }
    },
    close: () => jobs.close(),
  };
}
