// What the server keeps beside baked frames so they travel small (SPEC "Baked frames"), in
// <framesDir>/<hash>/ with <hash> = wireHash(look.bake.frames.sha256): <n>.br chunks and manifest.json
// (written last) after a bake; <n>.gz chunks and frames.<codec>.fseq downloads on first request. Looks
// with the same frames share a folder; prune() removes folders no bake names. The encoding runs in a
// low-priority worker thread, one job at a time (createFrameJobs, below), wire encodes in the lane bakes use.
// The folder stays under a disk cap (createFramesDisk, below); frames it evicted are baked again on demand.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import zlib from 'node:zlib';

import { createLane, framesBytesFor, framesPath } from './bake.ts';
import { WIRE_QUALITY, wireHash } from './frames-wire.ts';
import type { Jobs } from './frames-worker.ts';
import type { Codec } from './fseq-codec.ts';
import type { Logger } from './http.ts';
import type { Store, StoredLook } from './store.ts';

const HASH = /^[0-9a-f]{32}$/;
export const DEFAULT_FRAMES_MAX_BYTES = 2 * 1024 ** 3;
const TOUCH_MS = 10 * 60_000;
const MIN_GAP_MS = 5000; // between two looks at the whole folder
const MAX_FRAMES_BYTES = framesBytesFor(600); // the longest bake there can be
const unbrotli = promisify(zlib.brotliDecompress);
const exists = (file: string) => fs.stat(file).then((st) => st.isFile(), () => false);
const shaOf = (look: StoredLook | null | undefined) => {
  const sha = look?.bake?.frames?.sha256;
  return typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha) ? sha : null;
};

/** `lane` is shared with the bake queue; `rebake(look)` → true when it queued a bake for frames that are gone. */
export function createFramesCache({ framesDir, store, log = console, quality = WIRE_QUALITY, maxBytes,
  lane = createLane(), jobs = createFrameJobs({ log }), rebake = async () => false }: { framesDir: string,
  store: Pick<Store, 'looks'>, log?: Logger, quality?: number, maxBytes?: number,
  lane?: ReturnType<typeof createLane>, jobs?: ReturnType<typeof createFrameJobs>,
  rebake?: (look: StoredLook) => Promise<boolean> }) {
  quality = Math.min(11, Math.max(1, Math.round(Number(quality) || WIRE_QUALITY))); // brotli's 1..11
  type Job = { promise?: Promise<unknown>, sha: string | null, done?: number, chunks?: number };
  const encoding = new Map<string, Job>(); // hash → { promise, done, chunks, sha }: encodes queued or running
  const failed = new Set<string>();       // hashes whose frames could not be encoded (until a restart)
  const making = new Map<string, Job>();  // file → { promise, sha }: gzip chunks and .fseq downloads being made
  const dir = (hash: string) => path.join(framesDir, hash);
  const hashOf = (look: StoredLook | null | undefined) => (shaOf(look) ? wireHash(shaOf(look)!) : null);
  const busy = () => new Set([...encoding.values(), ...making.values()].map((j) => j.sha));
  const disk = createFramesDisk({ framesDir, store, maxBytes, busy, log });

  async function run(look: StoredLook, hash: string, job: Job) {
    if (await exists(path.join(dir(hash), 'manifest.json'))) return true;
    const file = framesPath(framesDir, look.id);
    if (!(await exists(file))) return false;
    const started = Date.now();
    const r = await jobs.run('wire', { file, sha256: job.sha!, dir: dir(hash), hash, quality,
      maxBytes: MAX_FRAMES_BYTES }, (p) => Object.assign(job, p));
    log.info?.(`[frames] look ${look.id}: ${r.frames} frames, ${r.bytes} bytes to stream `
      + `(${(r.bytes / r.raw * 100).toFixed(1)} %, brotli ${quality}), ${Date.now() - started} ms`);
    return true;
  }

  /** Queue a look's frames for encoding; resolves true once its chunks are stored. */
  function encode(lookOrId: string | StoredLook): Promise<boolean> {
    const look = typeof lookOrId === 'string' ? store.looks.get(lookOrId) : lookOrId;
    const hash = hashOf(look);
    if (!hash) return Promise.resolve(false);
    if (encoding.has(hash)) return encoding.get(hash)!.promise as Promise<boolean>;
    const job: Job = { done: 0, chunks: 0, sha: shaOf(look) };
    const promise = lane.run(() => run(look!, hash, job)).catch((err) => {
      log.error?.(`[frames] look ${look!.id}: could not encode its frames:`, err);
      return false;
    }).then((ok) => {
      encoding.delete(hash);
      if (!ok) failed.add(hash);
      return prune().then(() => disk.enforce()).then(() => ok);
    });
    job.promise = promise;
    encoding.set(hash, job);
    disk.touch(look!);
    return promise;
  }

  async function wire(look: StoredLook) {
    const hash = hashOf(look);
    if (!hash) return { state: 'none' };
    if (await exists(path.join(dir(hash), 'manifest.json'))) { disk.touch(look); return { state: 'ready', hash }; }
    if (failed.has(hash)) return { state: 'failed', hash };
    if (!encoding.has(hash)) {
      if (await exists(framesPath(framesDir, look.id))) encode(look); // an older bake, or a restart cut it short
      else if (await rebake(look)) return { state: 'pending', hash, done: 0, chunks: 0 }; // evicted
      else return { state: 'none' };
    }
    const job = encoding.get(hash);
    return { state: 'pending', hash, done: job?.done ?? 0, chunks: job?.chunks ?? 0 };
  }

  const read = (file: string) => fs.readFile(file).catch(() => null);

  /** `file`, made by make() (a worker job) unless it is there already; one at a time per file. */
  async function made(file: string, sha: string | null, make: () => Promise<unknown>) {
    if (await exists(file)) return file;
    if (!making.has(file)) {
      const promise = fs.mkdir(path.dirname(file), { recursive: true }).then(make).then(() => file);
      making.set(file, { sha, promise });
      promise.catch(() => {}).finally(() => {
        making.delete(file);
        disk.enforce();
      });
    }
    return making.get(file)!.promise as Promise<string>;
  }

  async function chunk(hash: string, n: number, enc: 'br' | 'gzip' | null) {
    if (!HASH.test(hash) || !Number.isInteger(n) || n < 0) return null;
    const br = path.join(dir(hash), `${n}.br`);
    if (enc === 'br') { const body = await read(br); return body && { body, encoding: 'br' }; }
    if (!(await exists(br))) return null;
    if (enc === 'gzip') {
      const manifest = await read(path.join(dir(hash), 'manifest.json'));
      if (!manifest) return null; // still being encoded
      const out = path.join(dir(hash), `${n}.gz`), { channels } = JSON.parse(manifest.toString());
      await made(out, null, () => jobs.run('gzip', { br, channels, out }));
      return { body: await fs.readFile(out), encoding: 'gzip' };
    }
    return { body: await unbrotli(await fs.readFile(br)), encoding: null };
  }

  /** A compressed download of the look's frames (made once), or null when they are gone (re-baked on demand). */
  async function fseq(look: StoredLook, codec: Codec) {
    const hash = hashOf(look);
    const file = framesPath(framesDir, look.id);
    if (!hash || !(await exists(file))) return null;
    disk.touch(look);
    const out = path.join(dir(hash), `frames.${codec}.fseq`), sha256 = shaOf(look)!;
    return made(out, sha256, () => jobs.run('fseq', { file, sha256, codec, out, maxBytes: MAX_FRAMES_BYTES }));
  }

  /** Remove hash folders that no look's bake names (and that nothing is encoding). */
  async function prune() {
    const live = new Set([...encoding.keys(), ...store.looks.list((l) => hashOf(l)).map(hashOf)]);
    const names = await fs.readdir(framesDir).catch(() => [] as string[]);
    const dead = names.filter((name) => HASH.test(name) && !live.has(name));
    await Promise.all(dead.map((name) => fs.rm(dir(name), { recursive: true, force: true }).catch(() => {})));
  }

  return {
    hashOf, wire, encode, chunk, fseq, prune, disk,
    touch: (look: StoredLook) => disk.touch(look),
    /** Frames that are gone (evicted) are baked again: true when that is under way. */
    restore: (look: StoredLook) => rebake(look),
    manifest: (hash: string) => (HASH.test(hash) ? read(path.join(dir(hash), 'manifest.json')) : Promise.resolve(null)),
    async idle() {
      while (encoding.size || making.size) {
        await Promise.all([...encoding.values(), ...making.values()].map((j) => j.promise)).catch(() => {});
      }
    },
    close: () => jobs.close(),
  };
}

// Baked frames within a disk budget (STUDIO_FRAMES_MAX_BYTES, default 2 GB). While <framesDir> holds more,
// the frames used least recently go: a bake's .fseq files with its wire folder (chunks and downloads). Never
// a reviewed look's, a fleet-box bake's (no box can make it again) or frames in use. An evicted bake keeps
// its record and is baked again when someone asks for its frames: bakes are deterministic.
// Last use: when this run saw it used, else the .fseq's mtime (touched on use, at most every 10 minutes).
async function folderBytes(dir: string) {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const stats = await Promise.all(names.map((n) => fs.stat(path.join(dir, n)).catch(() => null)));
  return stats.reduce((n, st) => n + (st?.isFile() ? st.size : 0), 0);
}

/** `busy()`: the sha256 of frames in use. */
export function createFramesDisk({ framesDir, store, maxBytes = DEFAULT_FRAMES_MAX_BYTES, busy = () => new Set(),
  log = console }: { framesDir: string, store: Pick<Store, 'looks'>, maxBytes?: number,
  busy?: () => Set<string | null>, log?: Logger }) {
  const used = new Map<string, number>(); // sha256 → when this run last saw it used
  let running: Promise<unknown> | null = null, again = false, lastRun = 0;
  let timer: NodeJS.Timeout | null = null;

  /** Note that a look's frames were used (streamed, downloaded, baked). */
  function touch(look: StoredLook) {
    const sha = shaOf(look);
    if (!sha) return;
    const now = Date.now(), last = used.get(sha) ?? 0;
    used.set(sha, now);
    if (now - last < TOUCH_MS) return;
    const when = new Date(now);
    fs.utimes(framesPath(framesDir, look.id), when, when).catch(() => {});
  }

  /** { total, groups: [{ sha, looks, bytes, lastUsed, keep }] }: what the folder holds, by bake. */
  async function usage() {
    type Group = { sha: string, looks: string[], bytes: number, lastUsed: number, keep: boolean };
    const groups = new Map<string, Group>();
    const inUse = busy();
    for (const look of store.looks.list((l) => shaOf(l))) {
      const sha = shaOf(look)!;
      const g = groups.get(sha) ?? { sha, looks: [], bytes: 0, lastUsed: used.get(sha) ?? 0, keep: inUse.has(sha) };
      g.looks.push(look.id);
      g.keep ||= look.reviewed === true || look.bake!.source !== 'render-box';
      groups.set(sha, g);
    }
    const byLook = new Map([...groups.values()].flatMap((g) => g.looks.map((id) => [`${id}.fseq`, g])));
    const byFolder = new Map([...groups.values()].map((g) => [wireHash(g.sha), g]));
    const seen = new Set<number>(); // inodes: looks with the same frames share one file
    let total = 0;
    for (const entry of await fs.readdir(framesDir, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(framesDir, entry.name);
      if (entry.isDirectory()) {
        const bytes = await folderBytes(file);
        total += bytes;
        const g = byFolder.get(entry.name);
        if (g) g.bytes += bytes;
        continue;
      }
      const st = await fs.stat(file).catch(() => null);
      if (!st?.isFile() || seen.has(st.ino)) continue;
      seen.add(st.ino);
      total += st.size;
      const g = byLook.get(entry.name);
      if (g) Object.assign(g, { bytes: g.bytes + st.size, lastUsed: Math.max(g.lastUsed, st.mtimeMs) });
    }
    return { total, groups: [...groups.values()] };
  }

  async function evict() {
    const { total, groups } = await usage();
    let left = total;
    if (left <= maxBytes) return;
    for (const g of groups.filter((x) => !x.keep && x.bytes > 0).sort((a, b) => a.lastUsed - b.lastUsed)) {
      if (left <= maxBytes) break;
      await Promise.all([...g.looks.map((id) => fs.rm(framesPath(framesDir, id), { force: true })),
        fs.rm(path.join(framesDir, wireHash(g.sha)), { recursive: true, force: true })]).catch(() => {});
      left -= g.bytes;
      used.delete(g.sha);
      log.info?.(`[frames] evicted ${(g.bytes / 1e6).toFixed(1)} MB (looks ${g.looks.join(', ')}) for the disk cap`);
    }
    if (left > maxBytes) {
      log.warn?.(`[frames] ${(left / 1e6).toFixed(0)} MB of frames that cannot be evicted (reviewed, fleet-box `
        + `or in use), over STUDIO_FRAMES_MAX_BYTES ${(maxBytes / 1e6).toFixed(0)} MB`);
    }
  }

  /** Evict down to the cap; calls close together share a pass, and passes are at least 5 s apart. */
  function enforce() {
    if (running) { again = true; return running; }
    const wait = lastRun + MIN_GAP_MS - Date.now();
    if (wait > 0) {
      timer ||= setTimeout(() => { timer = null; enforce(); }, wait);
      timer.unref?.();
      return Promise.resolve();
    }
    running = evict().catch((err) => log.warn?.(`[frames] the disk cap check failed: ${err.message}`))
      .finally(() => {
        running = null;
        lastRun = Date.now();
        if (again) { again = false; enforce(); }
      });
    return running;
  }

  return { touch, enforce, usage, evict, get maxBytes() { return maxBytes; } };
}

// The encoder: one worker thread at nice 10 (src/frames-worker.ts), started on demand and stopped when it has been
// idle a while, one job at a time.
export function createFrameJobs({ nice = 10, idleMs = 30_000, log = console }: { nice?: number, idleMs?: number,
  log?: Logger } = {}) {
  const lane = createLane();
  type Progress = (p: { done: number, chunks: number }) => void;
  type Waiting = { resolve(r: unknown): void, reject(e: Error): void, onProgress?: Progress };
  const waiting = new Map<number, Waiting>(); // job id → { resolve, reject, onProgress }
  let worker: Worker | null = null, seq = 0;
  let timer: NodeJS.Timeout | undefined;

  function start() {
    if (worker) return worker;
    const w = new Worker(new URL('./frames-worker.ts', import.meta.url), { workerData: { nice } });
    w.unref(); // never keeps the process alive
    const fail = (err: Error) => {
      if (worker === w) worker = null;
      for (const job of waiting.values()) job.reject(err);
      waiting.clear();
    };
    w.on('message', ({ id, progress, ok, result, error }) => {
      const job = waiting.get(id);
      if (!job) return;
      if (progress) return job.onProgress?.(progress);
      waiting.delete(id);
      if (ok) job.resolve(result);
      else job.reject(new Error(error));
    });
    w.on('error', (err) => {
      log.error?.('[frames] the encoder thread failed:', err);
      fail(err);
    });
    w.on('exit', (code) => fail(new Error(`the encoder thread stopped (exit ${code})`)));
    return (worker = w);
  }

  function stop() {
    clearTimeout(timer);
    const w = worker;
    worker = null;
    return w ? w.terminate().then(() => {}, () => {}) : Promise.resolve();
  }

  function run<K extends keyof Jobs>(kind: K, args: Parameters<Jobs[K]>[0], onProgress?: Progress) {
    clearTimeout(timer);
    return lane.run(() => new Promise<Awaited<ReturnType<Jobs[K]>>>((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve: resolve as Waiting['resolve'], reject, onProgress });
      start().postMessage({ id, kind, args });
    })).finally(() => {
      if (!lane.size) (timer = setTimeout(stop, idleMs)).unref();
    });
  }

  return { run, close: stop };
}
