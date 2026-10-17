// Baked frames on the trusted side (SPEC "Baked frames"): their files (<STUDIO_DATA>/frames/<lookId>.fseq),
// the queue that runs the render box one look at a time, and what review needs. The fleet-box bake (the
// Fleet worker's, generate/fleet.js) is advisory; the render-box bake (src/render-box.js) is authoritative.
//   look.bake = { source: 'fleet-box' | 'render-box', status: 'queued'|'running'|'done'|'failed', ok, reason?,
//     checkedAt, layersHash, seconds, analysis?, frames?: { bytes, sha256 }, boxStats?: { untrusted, reported } }

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { DEFAULT_DURATION } from '../public/js/pattern-core.js';
import { BakeError, checkFrames, failedBake } from './box-output.js';
import { DEFAULT_MAX_BYTES, flickerReason } from './frames.js';

export const DEFAULT_BAKE_SECONDS = 120;
const LOOK_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Sparse frames hold the LED map's 14,610 channels: about 0.6 MB a second at 40 fps.
const BYTES_PER_SECOND = 40 * 15_000;

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
  const unit = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
  return m ? Math.floor(Number(m[1]) * unit[m[2].toLowerCase()]) : fallback;
}

/** "1800", "1800s", "30m", "2h", "500ms" → milliseconds. Bare numbers are seconds. */
export function parseDuration(v, fallbackMs) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)?\s*$/.exec(String(v ?? ''));
  return m ? Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2] || 's'] : fallbackMs;
}

export function framesPath(dir, lookId) {
  if (!LOOK_ID.test(String(lookId))) throw new Error(`bad look id ${String(lookId).slice(0, 80)}`);
  return path.join(dir, `${lookId}.fseq`);
}

let tmpSeq = 0;
/** Write a file atomically: a temporary file beside it, then a rename. */
export async function writeAtomic(file, bytes) {
  const tmp = `${file}.${process.pid}.${(tmpSeq++).toString(36)}.tmp`;
  try {
    await fs.writeFile(tmp, bytes, { mode: 0o600 });
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Store a look's frames (atomically). */
export async function saveFrames(dir, lookId, bytes) {
  const file = framesPath(dir, lookId);
  await fs.mkdir(dir, { recursive: true });
  await writeAtomic(file, bytes);
  return file;
}

export async function removeFrames(dir, lookId) {
  if (dir && LOOK_ID.test(String(lookId))) await fs.rm(framesPath(dir, lookId), { force: true }).catch(() => {});
}

/**
 * createBakeQueue({ store, box, framesDir, cathedralFile, maxQueue = 16, log, onFrames? })
 *   → { request(lookId) → bake record, idle(), stop(), size }. A bake renders the layers and duration as they
 * are when it starts, and is kept only if they are unchanged when it ends; onFrames(lookId) then hears of it.
 * request() throws BakeError with `status` 503 (no box) or 429 (full).
 */
export function createBakeQueue({ store, box, framesDir, cathedralFile, maxQueue = 16, log = console, onFrames }) {
  const source = 'render-box';
  const pending = [];
  const asking = new Set(); // ids between request() and the queue, so a double click is one bake
  let running = null, waiters = [], cathedral = { sig: '', value: null };
  // Bakes cut short by a restart are marked failed, so nobody waits on them.
  const cut = (l) => l.bake?.source === source && ['queued', 'running'].includes(l.bake.status);
  for (const look of store.looks.list(cut)) {
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
    const startedAt = new Date().toISOString();
    const bake = { source, status: 'running', ok: false, requestedAt: look.bake?.requestedAt, startedAt };
    await store.looks.update(id, { bake });
    let out;
    try {
      const { bytes, boxStats } = await box.render({ layers, seconds });
      const cathedral = await loadCathedral();
      out = checkFrames(bytes, { source, cathedral, maxBytes: box.config?.maxFramesBytes, boxStats });
    } catch (err) {
      if (!(err instanceof BakeError)) log.error?.(`[bake] look ${id}:`, err);
      const reason = err instanceof BakeError ? err.reason : 'The render box failed.';
      out = { bake: failedBake(source, reason, err?.boxStats ? { boxStats: err.boxStats } : {}) };
    }
    Object.assign(out.bake, { layersHash: hash, seconds });
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
        const reason = 'The baked frames could not be stored.';
        out.bake = { ...out.bake, ok: false, status: 'failed', frames: undefined, reason };
      }
    }
    if (!(await store.looks.update(id, { bake: out.bake }))) await removeFrames(framesDir, id);
    else if (out.bake.frames) onFrames?.(id);
    log.info?.(`[bake] look ${id}: ${out.bake.ok ? 'ok' : out.bake.reason}`);
  }

  function pump() {
    if (running) return;
    if (!pending.length) {
      const w = waiters;
      waiters = [];
      return w.forEach((r) => r());
    }
    running = pending.shift();
    bakeOne(running)
      .catch((err) => log.error?.(`[bake] look ${running} crashed:`, err))
      .finally(() => { running = null; pump(); });
  }

  return {
    async request(id) {
      const look = await store.looks.get(id);
      if (!look) throw Object.assign(new BakeError('Look not found.'), { status: 404 });
      if (asking.has(id)) return { source, status: 'queued', ok: false };
      if (running === id || pending.includes(id)) return look.bake;
      if (pending.length + asking.size >= maxQueue) {
        throw Object.assign(new BakeError('The render box is busy. Try again in a minute.'), { status: 429 });
      }
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
    idle: () => (!running && !pending.length ? Promise.resolve() : new Promise((r) => waiters.push(r))),
    stop() { pending.length = 0; box.stop?.(); },
    get size() { return pending.length + (running ? 1 : 0); },
  };
}

/** Why a look cannot be marked reviewed yet ('' when it can): it needs a passing render-box bake of its code. */
export function reviewBlocker(look) {
  const b = look?.bake;
  if (b?.analysis?.flicker?.ok === false) {
    return `${flickerReason(b.analysis)} A look that fails the flicker check cannot be marked reviewed.`;
  }
  if (!b || b.source !== 'render-box' || !['done', 'failed'].includes(b.status)) {
    return 'Bake this look in the render box first: only looks with a passing bake can be marked reviewed.';
  }
  if (b.layersHash !== layersHash(look.layers ?? [])) {
    return 'The code changed since the last bake. Bake it again first.';
  }
  if (!b.ok) return `The last bake failed: ${b.reason || 'no reason given'}`;
  return '';
}
