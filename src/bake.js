// Baked frames on the trusted side (SPEC "Baked frames"): their files (<STUDIO_DATA>/frames/<lookId>.fseq),
// the queue that runs the render box one look at a time (in the low-priority lane it shares with frame
// encoding), and what review needs. The fleet-box bake (the Fleet worker's, generate/fleet.js) is advisory;
// the render-box bake (src/render-box.js) is authoritative. Bakes are deterministic, so a look that renders
// what another already baked (the same renderKey) takes its frames instead of baking again.
//   look.bake = { source: 'fleet-box' | 'render-box', status: 'queued'|'running'|'done'|'failed', ok, reason?,
//     checkedAt, layersHash, renderKey?, seconds, analysis?, frames?: { bytes, sha256 }, boxStats?: { untrusted,
//     reported } }

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { DEFAULT_DURATION } from '../public/js/pattern-core.js';
import { BakeError, checkFrames, failedBake } from './box-output.js';
import { bundle } from './core-script.js';
import { DEFAULT_MAX_BYTES, flickerReason } from './frames.js';
import { renderFields } from './look-rules.js';

export const DEFAULT_BAKE_SECONDS = 120;
const LOOK_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Sparse frames hold the LED map's 14,610 channels: about 0.6 MB a second at 40 fps.
const BYTES_PER_SECOND = 40 * 15_000;

/** A queue that runs one task at a time, in order: run(fn) → fn()'s result; size: tasks queued or running. */
export function createLane() {
  let tail = Promise.resolve(), size = 0;
  const run = (fn) => {
    size++;
    const p = tail.then(fn).finally(() => { size--; });
    tail = p.catch(() => {});
    return p;
  };
  return { run, get size() { return size; } };
}

/** Room for `seconds` of sparse frames: 64 MB, or more for a long bake. */
export function framesBytesFor(seconds) {
  return Math.max(DEFAULT_MAX_BYTES, Math.ceil(seconds * BYTES_PER_SECOND) + 1024 * 1024);
}

/** The seconds a bake of `look` renders: its duration (default 30), at most `max`. */
export function bakeSeconds(look, max = DEFAULT_BAKE_SECONDS) {
  const d = Number(look?.duration);
  return Math.min(max, Number.isFinite(d) && d > 0 ? d : DEFAULT_DURATION);
}

/** Which version of a look's code a bake belongs to: layersHash(renderFields(look)). */
export function layersHash(fields) {
  return createHash('sha256').update(JSON.stringify(fields ?? [])).digest('hex');
}

/** What a bake's frames depend on: the look's render fields, the seconds baked and the box's own files. */
export function renderKey(look, seconds, boxDigest = '') {
  return createHash('sha256').update(JSON.stringify({ v: 1, fields: renderFields(look), seconds, boxDigest }))
    .digest('hex');
}

/** The box's inputs as one digest (its script, renderer, core, LED map, library and Node), re-read on change. */
function boxDigester(config) {
  let memo = { sig: null, digest: '', core: [] };
  const statSig = (f) => fs.stat(f).then((st) => `${st.size}:${st.mtimeMs}`, () => '-');
  const library = async () => (config.patternsDir ? (await fs.readdir(config.patternsDir).catch(() => []))
    .filter((n) => /\.(js|json)$/.test(n)).sort().map((n) => path.join(config.patternsDir, n)) : []);
  const signature = async (files) => (await Promise.all(files.map(async (f) => `${f}=${await statSig(f)}`)))
    .join('|');
  return async () => {
    if (!config?.script || !config.files || !config.coreFile) return '';
    const own = [config.script, ...Object.values(config.files), ...await library()];
    const sig = await signature([...own, config.coreFile, ...memo.core]);
    if (sig === memo.sig) return memo.digest;
    const h = createHash('sha256').update(`${process.version}\0`);
    for (const f of own) h.update(`${path.basename(f)}\0`).update(await fs.readFile(f)).update('\0');
    const core = bundle(config.coreFile);
    h.update(core.text);
    memo = { sig: null, digest: h.digest('hex'), core: core.files };
    memo.sig = await signature([...own, config.coreFile, ...memo.core]);
    return memo.digest;
  };
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
/** Make `file` atomically: write(tmp) makes a temporary file beside it, then a rename puts it in place. */
async function atomically(file, write) {
  const tmp = `${file}.${process.pid}.${(tmpSeq++).toString(36)}.tmp`;
  try {
    await write(tmp);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
export const writeAtomic = (file, bytes) => atomically(file, (tmp) => fs.writeFile(tmp, bytes, { mode: 0o600 }));

/** Store a look's frames (atomically). */
export async function saveFrames(dir, lookId, bytes) {
  await fs.mkdir(dir, { recursive: true });
  await writeAtomic(framesPath(dir, lookId), bytes);
}

export async function removeFrames(dir, lookId) {
  if (dir && LOOK_ID.test(String(lookId))) await fs.rm(framesPath(dir, lookId), { force: true }).catch(() => {});
}

/**
 * createBakeQueue({ store, box, framesDir, rigFile, maxQueue = 16, log, onFrames?, lane? })
 *   → { request(lookId) → bake record, restore(look) → boolean, idle(), stop(), size }. A bake renders the look's
 * render fields and duration as they are when it starts, and is kept only if they are unchanged when it ends;
 * onFrames(lookId) then hears of it. restore() bakes frames that were evicted again, keeping the record when
 * the bytes come out the same. request() throws BakeError with `status` 503 (no box) or 429 (full).
 */
export function createBakeQueue({ store, box, framesDir, rigFile, maxQueue = 16, log = console, onFrames,
  lane = createLane() }) {
  const source = 'render-box';
  const pending = [];
  const asking = new Set();    // ids between request() and the queue, so a double click is one bake
  const restoring = new Set(); // ids whose evicted frames are being baked again
  const digest = boxDigester(box.config);
  let running = null, waiters = [], rig = { sig: '', value: null };
  // Bakes cut short by a restart are marked failed, so nobody waits on them.
  const cut = (l) => l.bake?.source === source && ['queued', 'running'].includes(l.bake.status);
  for (const look of store.looks.list(cut)) {
    store.looks.update(look.id, { bake: failedBake(source, 'The bake was interrupted by a restart; bake again.') });
  }

  async function loadRig() {
    const st = await fs.stat(rigFile);
    const sig = `${st.mtimeMs}:${st.size}`;
    if (rig.sig !== sig) rig = { sig, value: JSON.parse(await fs.readFile(rigFile, 'utf8')) };
    return rig.value;
  }

  /** A done render-box bake with this renderKey (or these frames) whose file is still there: { look, file }. */
  async function stored({ key, sha }) {
    const match = (l) => l.bake?.source === source && l.bake.status === 'done' && l.bake.frames
      && (key ? l.bake.renderKey === key : l.bake.frames.sha256 === sha);
    for (const look of store.looks.list(match)) {
      const file = framesPath(framesDir, look.id);
      if (await fs.stat(file).then((st) => st.isFile(), () => false)) return { look, file };
    }
    return null;
  }

  /** Give look `id` the frames in `file`: a hard link (a copy where links fail), placed atomically. */
  async function adopt(id, file) {
    const to = framesPath(framesDir, id);
    if (file !== to) await atomically(to, (tmp) => fs.link(file, tmp).catch(() => fs.copyFile(file, tmp)));
  }

  async function bakeOne(id) {
    const look = await store.looks.get(id);
    if (!look) return;
    const restore = restoring.has(id) && look.bake?.frames ? look.bake : null;
    const hash = layersHash(renderFields(look));
    const seconds = bakeSeconds(look, box.config?.seconds);
    const key = renderKey(look, seconds, await digest());
    const startedAt = new Date().toISOString();
    if (!restore) {
      const bake = { source, status: 'running', ok: false, requestedAt: look.bake?.requestedAt, startedAt };
      await store.looks.update(id, { bake });
    }
    const extra = Object.fromEntries(['globals', 'automation', 'bpm'].filter((k) => look[k] != null)
      .map((k) => [k, look[k]]));
    let out;
    try {
      const { bytes, boxStats } = await lane.run(() => box.render({ layers: look.layers ?? [], seconds, ...extra }));
      out = checkFrames(bytes, { source, rig: await loadRig(), maxBytes: box.config?.maxFramesBytes, boxStats });
    } catch (err) {
      if (!(err instanceof BakeError)) log.error?.(`[bake] look ${id}:`, err);
      const reason = err instanceof BakeError ? err.reason : 'The render box failed.';
      out = { bake: failedBake(source, reason, err?.boxStats ? { boxStats: err.boxStats } : {}) };
    }
    Object.assign(out.bake, { layersHash: hash, renderKey: key, seconds });
    const now = await store.looks.get(id);
    if (!now || layersHash(renderFields(now)) !== hash || bakeSeconds(now, box.config?.seconds) !== seconds) {
      log.info?.(`[bake] look ${id} changed or went away while baking; result dropped`);
      return;
    }
    // The same bytes as the evicted frames, and nobody asked for a new bake meanwhile: put them back and
    // keep the record (and its review).
    const sha = restore?.frames.sha256;
    const same = sha && out.bake.frames?.sha256 === sha && now.bake?.status === 'done'
      && now.bake.frames?.sha256 === sha;
    if (out.frames) {
      try {
        await saveFrames(framesDir, id, out.frames);
      } catch (err) {
        log.error?.(`[bake] look ${id}: could not store frames:`, err);
        if (same) return;
        const reason = 'The baked frames could not be stored.';
        out.bake = { ...out.bake, ok: false, status: 'failed', frames: undefined, reason };
      }
    }
    if (same) {
      onFrames?.(id);
      return log.info?.(`[bake] look ${id}: evicted frames baked again`);
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
      .finally(() => { restoring.delete(running); running = null; pump(); });
  }

  const queued = (id) => running === id || pending.includes(id);
  const full = () => pending.length + asking.size >= maxQueue;

  return {
    async request(id) {
      const look = await store.looks.get(id);
      if (!look) throw Object.assign(new BakeError('Look not found.'), { status: 404 });
      if (asking.has(id)) return { source, status: 'queued', ok: false };
      if (queued(id) && !restoring.has(id)) return look.bake;
      if (full()) throw Object.assign(new BakeError('The render box is busy. Try again in a minute.'), { status: 429 });
      asking.add(id);
      try {
        // Frames this render already made, for this look or another, are taken as they are.
        const key = renderKey(look, bakeSeconds(look, box.config?.seconds), await digest());
        const hit = await stored({ key });
        if (hit?.look.id === id) return look.bake;
        if (hit) {
          await adopt(id, hit.file).then(async () => {
            const bake = { ...hit.look.bake, layersHash: layersHash(renderFields(look)), checkedAt: new Date()
              .toISOString() };
            if (await store.looks.update(id, { bake })) onFrames?.(id);
          }, (err) => log.warn?.(`[bake] look ${id}: could not reuse ${hit.look.id}'s frames: ${err.message}`));
          const now = store.looks.get(id);
          if (now?.bake?.renderKey === key && now.bake.status === 'done') return now.bake;
        }
        const p = await box.probe();
        if (!p.ok) throw Object.assign(new BakeError(p.reason), { status: 503 });
        await removeFrames(framesDir, id);
        const bake = { source, status: 'queued', ok: false, requestedAt: new Date().toISOString() };
        await store.looks.update(id, { bake });
        restoring.delete(id);
        if (!queued(id)) pending.push(id);
        pump();
        return bake;
      } finally {
        asking.delete(id);
      }
    },
    /** Bake a done render-box bake whose frames are gone (evicted) again; true when that is under way. */
    async restore(lookOrId) {
      const look = store.looks.get(typeof lookOrId === 'string' ? lookOrId : lookOrId?.id);
      const b = look?.bake;
      if (b?.source !== source || b.status !== 'done' || !b.frames?.sha256) return false;
      if (queued(look.id) || asking.has(look.id)) return true;
      const hit = await stored({ sha: b.frames.sha256 }); // another look may hold the same frames
      if (hit && await adopt(look.id, hit.file).then(() => true, () => false)) { onFrames?.(look.id); return true; }
      if (full() || !(await box.probe()).ok) return false;
      restoring.add(look.id);
      pending.push(look.id);
      pump();
      return true;
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
  if (b.layersHash !== layersHash(renderFields(look))) {
    return 'The code changed since the last bake. Bake it again first.';
  }
  if (!b.ok) return `The last bake failed: ${b.reason || 'no reason given'}`;
  return '';
}
