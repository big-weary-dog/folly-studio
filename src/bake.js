// Baked frames on the trusted side: read what a box hands back as untrusted bytes, check it with
// src/frames.js (data only), and keep the result on the look. Two boxes bake:
//   fleet-box   the Fleet worker's own bake, alongside its look.json (advisory: see generate/fleet.js)
//   render-box  render-box/render.mjs, run here under bubblewrap for any look (authoritative)
//
//   look.bake = { source: 'fleet-box' | 'render-box', status: 'queued'|'running'|'done'|'failed',
//                 ok, reason?, checkedAt, layersHash, analysis?, frames?: { bytes, sha256 },
//                 boxStats?: { untrusted: true, reported } }
//   frames file: <STUDIO_DATA>/frames/<lookId>.fseq
//
// Nothing here runs look code. Whatever a box says about itself (stats.json, result.json) is
// kept only as `boxStats`, labelled untrusted; `ok` and `analysis` come from our own checks.

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as FS, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeFrames, DEFAULT_MAX_BYTES, flickerReason, FseqError, parseFseq } from './frames.js';
import { inflateBlock } from './fseq-codec.js';

export { DEFAULT_MAX_BYTES } from './frames.js';

const LOOK_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** An error whose `reason` is safe to show to people. */
export class BakeError extends Error {
  constructor(reason, detail) {
    super(detail ? `${reason} (${detail})` : reason);
    this.name = 'BakeError';
    this.reason = reason;
  }
}

// How long a look runs when it does not say (SPEC.md "Timeline"), and what a bake covers of it.
export const DEFAULT_DURATION = 30;
export const DEFAULT_BAKE_SECONDS = 120;
const FPS = 40;
// Sparse frames hold the LED map's 14,610 channels: about 0.6 MB a second at 40 fps.
const BYTES_PER_SECOND = FPS * 15_000;

/** Room for `seconds` of sparse frames: 64 MB, or more for a long bake. */
export function framesBytesFor(seconds) {
  return Math.max(DEFAULT_MAX_BYTES, Math.ceil(seconds * BYTES_PER_SECOND) + 1024 * 1024);
}

/** The seconds a bake of `look` renders: its duration (default 30), at most `max`. */
export function bakeSeconds(look, max = DEFAULT_BAKE_SECONDS) {
  const d = Number(look?.duration);
  return Math.min(max, Number.isFinite(d) && d > 0 ? d : DEFAULT_DURATION);
}

/** Which version of a look's code a bake belongs to. */
export function layersHash(layers) {
  return createHash('sha256').update(JSON.stringify(layers ?? [])).digest('hex');
}

/** "64MB", "512k", "1048576" → bytes. */
export function parseBytes(v, fallback) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmg]?)i?b?\s*$/i.exec(String(v ?? ''));
  if (!m) return fallback;
  return Math.floor(Number(m[1]) * { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[m[2].toLowerCase()]);
}

export function framesPath(dir, lookId) {
  if (!LOOK_ID.test(String(lookId))) throw new Error(`bad look id ${String(lookId).slice(0, 80)}`);
  return path.join(dir, `${lookId}.fseq`);
}

/** Store a look's frames atomically (tmp file + rename). */
export async function saveFrames(dir, lookId, bytes) {
  const file = framesPath(dir, lookId);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    await fs.writeFile(tmp, bytes, { mode: 0o600 });
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return file;
}

export async function removeFrames(dir, lookId) {
  if (dir && LOOK_ID.test(String(lookId))) await fs.rm(framesPath(dir, lookId), { force: true }).catch(() => {});
}

/**
 * Read a file a box wrote, as untrusted bytes: a regular file directly inside `within` (when
 * given), not a symlink, not hard-linked elsewhere, at most maxBytes. Throws BakeError.
 */
export async function readUntrusted(file, { maxBytes, within } = {}) {
  const name = path.basename(file);
  if (within) {
    let dir;
    try {
      dir = await fs.realpath(path.dirname(file));
    } catch {
      throw new BakeError(`${name} is missing`);
    }
    if (dir !== path.resolve(within)) throw new BakeError(`${name} is not inside the box's folder`);
  }
  let fh;
  try {
    fh = await fs.open(file, FS.O_RDONLY | FS.O_NOFOLLOW | FS.O_NONBLOCK);
  } catch (err) {
    throw new BakeError(err.code === 'ENOENT' ? `${name} is missing` : err.code === 'ELOOP' ? `${name} is a symlink` : `${name} cannot be opened`, err.code);
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new BakeError(`${name} is not a regular file`);
    if (st.nlink !== 1) throw new BakeError(`${name} is hard-linked`);
    if (st.size > maxBytes) throw new BakeError(`${name} is ${st.size} bytes, over the ${maxBytes}-byte limit`);
    const buf = Buffer.alloc(st.size);
    let at = 0;
    while (at < st.size) {
      const { bytesRead } = await fh.read(buf, at, st.size - at, at);
      if (!bytesRead) break;
      at += bytesRead;
    }
    if (at !== st.size) throw new BakeError(`${name} changed while it was read`);
    return buf;
  } finally {
    await fh.close();
  }
}

const CONTROL = /[\u0000-\u001f\u007f]/g;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** A box's own report, cut down to small plain data (depth 4, 32 entries, 200-char strings, 4 kB). */
export function cleanBoxStats(value) {
  const clean = (v, depth) => {
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') return v.replace(CONTROL, ' ').slice(0, 200);
    if (depth >= 4 || typeof v !== 'object') return null;
    if (Array.isArray(v)) return v.slice(0, 32).map((x) => clean(x, depth + 1));
    const out = {};
    for (const k of Object.keys(v).slice(0, 32)) {
      if (k.length > 64 || BAD_KEYS.has(k)) continue;
      out[k.replace(CONTROL, ' ')] = clean(v[k], depth + 1);
    }
    return out;
  };
  const reported = clean(value, 0);
  return { untrusted: true, reported: JSON.stringify(reported).length <= 4096 ? reported : { truncated: true } };
}

/**
 * Check baked frames: parseFseq + analyzeFrames on the cathedral's LED map. Returns the bake
 * record, plus the bytes to store when they parsed. A failed flicker check is `ok: false`.
 */
export function checkFrames(bytes, { source, cathedral, maxBytes = DEFAULT_MAX_BYTES, boxStats } = {}) {
  const bake = { source, status: 'done', ok: false, checkedAt: new Date().toISOString() };
  if (boxStats) bake.boxStats = boxStats;
  let analysis;
  try {
    analysis = analyzeFrames(parseFseq(bytes, { maxBytes, decompress: inflateBlock }), cathedral);
  } catch (err) {
    bake.status = 'failed';
    bake.reason = err instanceof FseqError ? `The baked frames were rejected: ${err.message.replace(/^frames: /, '')}.` : 'The baked frames could not be checked.';
    return { bake };
  }
  bake.analysis = analysis;
  bake.frames = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  bake.ok = analysis.flicker.ok;
  if (!bake.ok) bake.reason = flickerReason(analysis);
  return { bake, frames: bytes };
}

/** A bake record for a box that left no usable frames. */
export function failedBake(source, reason, extra = {}) {
  return { source, status: 'failed', ok: false, checkedAt: new Date().toISOString(), reason, ...extra };
}

// ---------------------------------------------------------------------------------------------
// The render box: render-box/render.mjs inside bubblewrap

const STUDIO = fileURLToPath(new URL('../', import.meta.url));
const SECOND = 1000;

async function which(cmd, PATH) {
  if (cmd.includes('/')) return cmd;
  for (const dir of String(PATH || '/usr/bin:/bin').split(':')) {
    const p = path.join(dir || '.', cmd);
    try {
      await fs.access(p, FS.X_OK);
      return p;
    } catch {}
  }
  return null;
}

/**
 * The node binary and the shared libraries it loads (from ldd), as read-only binds at their own
 * paths, and LD_LIBRARY_PATH for them. A static node needs none; without ldd, the system lib dirs.
 */
async function runtimeBinds(node) {
  const real = await fs.realpath(node);
  const out = await new Promise((resolve) => execFile('ldd', [real], { timeout: 10 * SECOND }, (err, stdout) => resolve(err ? null : String(stdout))));
  if (out === null) {
    const dirs = ['/usr/lib', '/usr/lib64', '/lib', '/lib64'];
    const binds = [];
    for (const d of dirs) if (await fs.stat(d).catch(() => null)) binds.push(['--ro-bind', await fs.realpath(d), d]);
    return { node: real, binds: binds.flat(), libraryPath: dirs.join(':') };
  }
  const libs = [...new Set([...out.matchAll(/(\/[^\s()]+)\s+\(0x[0-9a-f]+\)/g)].map((m) => m[1]))];
  const binds = [];
  for (const lib of libs) binds.push('--ro-bind', await fs.realpath(lib), lib);
  return { node: real, binds, libraryPath: [...new Set(libs.map((l) => path.dirname(l)))].join(':') };
}

/**
 * createRenderBox(o) → { probe() → { ok, reason? }, stop(), config,
 *                         render({ layers, seconds? }) → { bytes, boxStats, ms, seconds } }
 *
 * Each render gets a fresh empty output dir and runs, under prlimit (CPU seconds, tasks, file
 * size, data segment) and a wall-clock kill:
 *   bwrap --unshare-all --die-with-parent --new-session --cap-drop ALL --clearenv
 *         read-only: node + its libraries, render.mjs, pattern-core.js, fseq.js, cathedral.json
 *         tmpfs /tmp (16 MB), the output dir writable at /out, everything else read-only
 *         node render.mjs --out /out < look.json
 * No address-space limit: V8 reserves large virtual ranges up front, and RLIMIT_AS crashes it
 * (Fleet learnt this). RLIMIT_DATA caps what it actually maps writable. The task limit is
 * RLIMIT_NPROC, which counts every process of the server's user, not just the box's. No
 * bubblewrap or no user namespaces → probe() says so and render() refuses. There is no unboxed
 * fallback.
 *
 * A render bakes `seconds` (the look's duration) but never more than the box's `seconds`.
 * Options (environment): seconds (STUDIO_BAKE_SECONDS, 120, at most 600), timeoutMs
 * (STUDIO_BAKE_TIMEOUT; default 30 s + 1.5 s per second baked, at least 90 s), cpuSeconds
 * (STUDIO_BAKE_CPU; default the same in CPU seconds, at least 120), tasks (STUDIO_BAKE_TASKS, 256),
 * memoryBytes (STUDIO_BAKE_MEMORY, 1 GB; 0 = none), maxFramesBytes (STUDIO_BAKE_MAX_FRAMES; 64 MB,
 * or more when `seconds` needs it), frameTimeoutMs (2 s), publicDir, script, node, bwrap, prlimit,
 * tmpRoot.
 */
export function createRenderBox(o = {}) {
  const env = o.env || process.env;
  const publicDir = path.resolve(o.publicDir || path.join(STUDIO, 'public'));
  const asked = o.seconds ?? (Number(env.STUDIO_BAKE_SECONDS) || DEFAULT_BAKE_SECONDS);
  const seconds = Math.min(600, Math.max(1, Math.round(asked)));
  const cfg = {
    seconds,
    timeoutMs: o.timeoutMs ?? parseDurationMs(env.STUDIO_BAKE_TIMEOUT, null), // null: scaled per bake
    cpuSeconds: o.cpuSeconds ?? (Number(env.STUDIO_BAKE_CPU) || null),
    tasks: o.tasks ?? (Number(env.STUDIO_BAKE_TASKS) || 256),
    memoryBytes: o.memoryBytes ?? parseBytes(env.STUDIO_BAKE_MEMORY, 1024 ** 3),
    maxFramesBytes: o.maxFramesBytes ?? parseBytes(env.STUDIO_BAKE_MAX_FRAMES, framesBytesFor(seconds)),
    frameTimeoutMs: o.frameTimeoutMs ?? 2 * SECOND,
    script: o.script || path.join(STUDIO, 'render-box/render.mjs'),
    packageJson: path.join(STUDIO, 'render-box/package.json'),
    coreFile: o.coreFile || path.join(publicDir, 'js/pattern-core.js'),
    fseqFile: o.fseqFile || path.join(publicDir, 'js/fseq.js'),
    cathedralFile: o.cathedralFile || path.join(publicDir, 'data/cathedral.json'),
    node: o.node || process.execPath,
    bwrap: o.bwrap || 'bwrap',
    prlimit: o.prlimit || 'prlimit',
    tmpRoot: o.tmpRoot || tmpdir(),
    log: o.log || console,
  };
  const children = new Set();
  let probed;
  let found;

  function tools() {
    found ||= findTools().catch((err) => {
      found = null;
      throw err;
    });
    return found;
  }

  async function findTools() {
    const bwrap = await which(cfg.bwrap, env.PATH);
    if (!bwrap) throw new BakeError('The render box is not available: bubblewrap (bwrap) is not installed on this server.');
    const prlimit = await which(cfg.prlimit, env.PATH);
    if (!prlimit) throw new BakeError('The render box is not available: prlimit (util-linux) is not installed on this server.');
    for (const f of [cfg.script, cfg.packageJson, cfg.coreFile, cfg.fseqFile, cfg.cathedralFile]) {
      if (!(await fs.stat(f).catch(() => null))?.isFile()) throw new BakeError('The render box is not set up on this server.', `missing ${f}`);
    }
    return { bwrap, prlimit, runtime: await runtimeBinds(cfg.node) };
  }

  // Time budgets grow with the bake: 30 s plus 1.5 s per second of frames (a 25 ms frame is real time).
  const budget = (secs) => ({
    timeoutMs: cfg.timeoutMs ?? Math.max(90, 30 + 1.5 * secs) * SECOND,
    cpuSeconds: cfg.cpuSeconds ?? Math.ceil(Math.max(120, 30 + 1.5 * secs)),
  });

  function boxArgs(t, outDir, command, cpuSeconds = budget(cfg.seconds).cpuSeconds) {
    const fsize = cfg.maxFramesBytes + 1024 * 1024;
    const limits = [`--cpu=${cpuSeconds}`, `--nproc=${cfg.tasks}`, `--fsize=${fsize}`, '--core=0'];
    if (cfg.memoryBytes > 0) limits.push(`--data=${cfg.memoryBytes}`);
    return [
      ...limits, '--', t.bwrap,
      '--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
      '--setenv', 'LD_LIBRARY_PATH', t.runtime.libraryPath, '--setenv', 'TMPDIR', '/tmp',
      '--proc', '/proc', '--dev', '/dev', '--size', String(16 * 1024 * 1024), '--tmpfs', '/tmp',
      ...t.runtime.binds,
      '--ro-bind', t.runtime.node, '/box/node',
      '--ro-bind', cfg.packageJson, '/box/package.json',
      '--ro-bind', cfg.script, '/box/render.mjs',
      '--ro-bind', cfg.coreFile, '/box/pattern-core.js',
      '--ro-bind', cfg.fseqFile, '/box/fseq.js',
      '--ro-bind', cfg.cathedralFile, '/box/cathedral.json',
      ...(outDir ? ['--bind', outDir, '/out'] : []),
      '--remount-ro', '/', '--chdir', '/box',
      '--', '/box/node', '--max-old-space-size=512', '--disallow-code-generation-from-strings', ...command,
    ];
  }

  function run(t, outDir, command, input, timeoutMs, cpuSeconds) {
    return new Promise((resolve) => {
      const args = boxArgs(t, outDir, command, cpuSeconds);
      const child = spawn(t.prlimit, args, { stdio: ['pipe', 'ignore', 'pipe'], env: {} });
      children.add(child);
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL'); // bwrap --die-with-parent takes the whole box down with it
      }, timeoutMs);
      child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4096)));
      child.stdin.on('error', () => {});
      child.stdin.end(input);
      const done = (code, signal, error) => {
        clearTimeout(timer);
        children.delete(child);
        resolve({ code, signal, timedOut, stderr: stderr.trim(), error });
      };
      child.on('error', (err) => done(null, null, err));
      child.on('close', (code, signal) => done(code, signal));
    });
  }

  /** Can this server run the box? Checked once (a few tens of ms), then remembered. */
  function probe() {
    probed ||= (async () => {
      let t;
      try {
        t = await tools();
      } catch (err) {
        return { ok: false, reason: err.reason || String(err.message) };
      }
      const r = await run(t, null, ['-e', '0'], '', 30 * SECOND);
      if (r.code === 0) return { ok: true };
      cfg.log.warn?.(`[bake] render box probe failed: ${r.error?.message || r.stderr || `exit ${r.code}`}`);
      return { ok: false, reason: 'The render box is not available: bubblewrap cannot create its namespaces on this server (user namespaces may be disabled).' };
    })();
    return probed;
  }

  /**
   * Bake layers (with their clips) to FSEQ bytes, `seconds` long (at most the box's).
   * Throws BakeError with a reason people can read.
   */
  async function render({ layers, seconds: want }) {
    const p = await probe();
    if (!p.ok) throw new BakeError(p.reason);
    const t = await tools();
    const secs = Math.round(Math.min(cfg.seconds, want > 0 ? want : cfg.seconds) * FPS) / FPS || 1 / FPS;
    const { timeoutMs, cpuSeconds } = budget(secs);
    const outDir = await fs.mkdtemp(path.join(cfg.tmpRoot, 'folly-bake-'));
    try {
      const command = ['/box/render.mjs', '--out', '/out', '--seconds', String(secs),
        '--frame-ms', String(cfg.frameTimeoutMs)];
      const started = Date.now();
      const r = await run(t, outDir, command, JSON.stringify({ layers }), timeoutMs, cpuSeconds);
      const took = Math.round(timeoutMs / SECOND);
      if (r.timedOut) throw new BakeError(`The bake took longer than ${took} s and was stopped.`);
      let result;
      try {
        result = JSON.parse((await readUntrusted(path.join(outDir, 'result.json'), { maxBytes: 64 * 1024, within: outDir })).toString('utf8'));
      } catch {
        result = null;
      }
      const boxStats = result && typeof result === 'object' ? cleanBoxStats(result) : undefined;
      if (r.code !== 0) {
        const said = typeof result?.error === 'string' ? result.error.replace(CONTROL, ' ').slice(0, 300) : '';
        const reason =
          r.code === 128 + 24 ? `The bake used more than ${cpuSeconds} CPU seconds and was stopped.`
          : r.code === 128 + 25 ? 'The bake wrote more than its file-size limit and was stopped.'
          : said ? `The look could not be baked: ${said}`
          : 'The render box stopped without baking the look.';
        if (!said) cfg.log.warn?.(`[bake] render box exit ${r.code}${r.signal ? ` (${r.signal})` : ''}: ${r.error?.message || r.stderr.split('\n').slice(-3).join(' | ')}`);
        throw Object.assign(new BakeError(reason), { boxStats });
      }
      let bytes;
      try {
        bytes = await readUntrusted(path.join(outDir, 'frames.fseq'), { maxBytes: cfg.maxFramesBytes, within: outDir });
      } catch (err) {
        throw Object.assign(new BakeError(`The render box left no usable frames: ${err.reason || 'unreadable'}.`), { boxStats });
      }
      return { bytes, boxStats, ms: Date.now() - started, seconds: secs };
    } finally {
      await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  function stop() {
    for (const c of children) c.kill('SIGKILL');
  }

  return { probe, render, stop, config: cfg };
}

function parseDurationMs(v, fallback) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m)?\s*$/.exec(String(v ?? ''));
  return m ? Number(m[1]) * { ms: 1, s: SECOND, m: 60 * SECOND }[m[2] || 's'] : fallback;
}

// ---------------------------------------------------------------------------------------------
// The bake queue: one render-box bake at a time

/**
 * createBakeQueue({ store, box, framesDir, cathedralFile, maxQueue = 16, log, onFrames? })
 *   → { request(lookId) → bake (queued/running record), idle(), stop(), size }
 * A bake renders the look's layers for its duration (bakeSeconds) as they are when it starts,
 * and is kept only if the layers and duration are still the same when it ends; onFrames(lookId)
 * then hears of its stored frames.
 * request() throws BakeError with `status`
 * 503 (no box) or 429 (queue full).
 */
export function createBakeQueue({ store, box, framesDir, cathedralFile, maxQueue = 16, log = console, onFrames }) {
  const source = 'render-box';
  const pending = [];
  const asking = new Set(); // ids between request() and the queue, so a double click is one bake
  let running = null;
  let waiters = [];
  let cathedral = { sig: '', value: null };

  // Bakes cut short by a restart are marked failed, so nobody waits on them.
  for (const look of store.looks.list((l) => l.bake?.source === source && ['queued', 'running'].includes(l.bake.status))) {
    store.looks.update(look.id, { bake: failedBake(source, 'The bake was interrupted by a restart; bake again.') });
  }

  async function loadCathedral() {
    const st = await fs.stat(cathedralFile);
    const sig = `${st.mtimeMs}:${st.size}`;
    if (cathedral.sig !== sig) cathedral = { sig, value: JSON.parse(await fs.readFile(cathedralFile, 'utf8')) };
    return cathedral.value;
  }

  async function bakeOne(id) {
    const look = await store.looks.get(id);
    if (!look) return;
    const layers = look.layers ?? [];
    const hash = layersHash(layers);
    const seconds = bakeSeconds(look, box.config?.seconds);
    await store.looks.update(id, { bake: { source, status: 'running', ok: false, requestedAt: look.bake?.requestedAt, startedAt: new Date().toISOString() } });
    let out;
    try {
      const { bytes, boxStats } = await box.render({ layers, seconds });
      out = checkFrames(bytes, { source, cathedral: await loadCathedral(), maxBytes: box.config?.maxFramesBytes, boxStats });
    } catch (err) {
      if (!(err instanceof BakeError)) log.error?.(`[bake] look ${id}:`, err);
      out = { bake: failedBake(source, err instanceof BakeError ? err.reason : 'The render box failed.', err?.boxStats ? { boxStats: err.boxStats } : {}) };
    }
    out.bake.layersHash = hash;
    out.bake.seconds = seconds;
    const now = await store.looks.get(id);
    if (!now || layersHash(now.layers ?? []) !== hash || bakeSeconds(now, box.config?.seconds) !== seconds) {
      log.info?.(`[bake] look ${id} changed or went away while baking; result dropped`);
      return;
    }
    if (out.frames) {
      try {
        await saveFrames(framesDir, id, out.frames);
      } catch (err) {
        log.error?.(`[bake] look ${id}: could not store frames:`, err);
        out.bake = { ...out.bake, ok: false, status: 'failed', frames: undefined, reason: 'The baked frames could not be stored.' };
      }
    }
    if (!(await store.looks.update(id, { bake: out.bake }))) await removeFrames(framesDir, id);
    else if (out.bake.frames) onFrames?.(id);
    log.info?.(`[bake] look ${id}: ${out.bake.ok ? 'ok' : out.bake.reason}`);
  }

  function pump() {
    if (running || !pending.length) {
      if (!running && !pending.length) {
        const w = waiters;
        waiters = [];
        w.forEach((r) => r());
      }
      return;
    }
    running = pending.shift();
    bakeOne(running)
      .catch((err) => log.error?.(`[bake] look ${running} crashed:`, err))
      .finally(() => {
        running = null;
        pump();
      });
  }

  return {
    async request(id) {
      const look = await store.looks.get(id);
      if (!look) throw Object.assign(new BakeError('Look not found.'), { status: 404 });
      if (asking.has(id)) return { source, status: 'queued', ok: false };
      if (running === id || pending.includes(id)) return look.bake;
      if (pending.length + asking.size >= maxQueue) throw Object.assign(new BakeError('The render box is busy. Try again in a minute.'), { status: 429 });
      asking.add(id);
      try {
        const p = await box.probe();
        if (!p.ok) throw Object.assign(new BakeError(p.reason), { status: 503 });
        await removeFrames(framesDir, id);
        const bake = { source, status: 'queued', ok: false, requestedAt: new Date().toISOString() };
        await store.looks.update(id, { bake });
        pending.push(id);
        pump();
        return bake;
      } finally {
        asking.delete(id);
      }
    },
    idle() {
      if (!running && !pending.length) return Promise.resolve();
      return new Promise((r) => waiters.push(r));
    },
    stop() {
      pending.length = 0;
      box.stop?.();
    },
    get size() {
      return pending.length + (running ? 1 : 0);
    },
  };
}

/** Why a look cannot be marked reviewed yet ('' when it can): it needs a passing render-box bake of its current code. */
export function reviewBlocker(look) {
  const b = look?.bake;
  if (b?.analysis?.flicker?.ok === false) return `${flickerReason(b.analysis)} A look that fails the flicker check cannot be marked reviewed.`;
  if (!b || b.source !== 'render-box' || !['done', 'failed'].includes(b.status)) return 'Bake this look in the render box first: only looks with a passing bake can be marked reviewed.';
  if (b.layersHash !== layersHash(look.layers ?? [])) return 'The code changed since the last bake. Bake it again first.';
  if (!b.ok) return `The last bake failed: ${b.reason || 'no reason given'}`;
  return '';
}
