// Baked frames on the trusted side (SPEC "Baked frames"): their files (<STUDIO_DATA>/frames/<lookId>.fseq),
// the queue that runs the render box one look at a time (in the low-priority lane it shares with frame
// encoding), and what review needs. The fleet-box bake (the Fleet worker's, generate/fleet.ts) is advisory;
// the render-box bake (src/render-box.ts) is authoritative. Bakes are deterministic, so a look that renders
// what another already baked (the same renderKey) takes its frames instead of baking again (look.bake: Bake).

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { DEFAULT_DURATION, type LayerInput } from '../public/js/pattern-core.ts';
import type { Bake, FlashSettings } from '../shared/schemas/api.ts';
import type { Rig } from '../shared/schemas/rig.ts';
import { BakeError, checkFrames, failedBake } from './box-output.ts';
import { bundle } from './core-script.ts';
import { DEFAULT_MAX_BYTES, flickerReason } from './frames.ts';
import type { Logger } from './http.ts';
import type { RenderBox } from './render-box.ts';
import type { Store, StoredLook } from './store.ts';

export const DEFAULT_BAKE_SECONDS = 120;
const LOOK_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Sparse frames hold the LED map's 14,610 channels: about 0.6 MB a second at 40 fps.
const BYTES_PER_SECOND = 40 * 15_000;

/** A queue that runs one task at a time, in order: run(fn) → fn()'s result; size: tasks queued or running. */
export function createLane() {
  let tail: Promise<unknown> = Promise.resolve(), size = 0;
  const run = <T>(fn: () => T | Promise<T>) => {
    size++;
    const p = tail.then(fn).finally(() => { size--; });
    tail = p.catch(() => {});
    return p;
  };
  return { run, get size() { return size; } };
}

/** Room for `seconds` of sparse frames: 64 MB, or more for a long bake. */
export function framesBytesFor(seconds: number) {
  return Math.max(DEFAULT_MAX_BYTES, Math.ceil(seconds * BYTES_PER_SECOND) + 1024 * 1024);
}

/** The seconds a bake of `look` renders: its duration (default 30), at most `max`. */
export function bakeSeconds(look: { duration?: unknown } | null | undefined, max = DEFAULT_BAKE_SECONDS) {
  const d = Number(look?.duration);
  return Math.min(max, Number.isFinite(d) && d > 0 ? d : DEFAULT_DURATION);
}

// A binding that counts beats (an LFO in beats, or the tempo): a number param's, a colour pick's rotate or a
// modulator's (a macro's mod).
const beatsLfo = (params: object | undefined | null): boolean => Object.values(params || {})
  .some((v) => v && typeof v === 'object' && (v.mod === 'lfo' ? v.unit === 'beats' : v.mod === 'beats'
    || beatsLfo({ r: v.rotate })));
/** What a bake renders of a look. */
type Renders = { layers?: readonly LayerInput[], globals?: unknown, automation?: unknown, bpm?: unknown };

/** Code that reads the look's tempo (G.bpm). */
const readsBpm = (code: unknown) => typeof code === 'string' && /\bG\s*\.\s*bpm\b/.test(code);

/**
 * What a bake renders besides the duration: the plain `layers` when the look has no globals, no automation, no LFO
 * in beats and no code that reads G.bpm (so older looks keep their hash), else { layers, globals, automation, bpm }.
 */
export function renderFields(look: Renders | null | undefined) {
  const layers = look?.layers ?? [];
  const macros = (look?.globals as { macros?: Record<string, { mod?: unknown }> } | null)?.macros;
  const beats = layers.some((l) => beatsLfo(l?.params) || readsBpm(l?.code) || (Array.isArray(l?.modules)
    && l.modules.some((m) => beatsLfo(m?.params) || readsBpm(m?.code))))
    || beatsLfo(Object.fromEntries(Object.entries(macros ?? {}).map(([k, m]) => [k, m?.mod])));
  if (!look?.globals && !look?.automation && !beats) return layers;
  return { layers, globals: look!.globals ?? null, automation: look!.automation ?? null,
    bpm: beats ? look!.bpm ?? null : null };
}

/** Which version of a look's code a bake belongs to: layersHash(renderFields(look)). */
export function layersHash(fields: unknown) {
  return createHash('sha256').update(JSON.stringify(fields ?? [])).digest('hex');
}

/** What a bake's frames depend on: the look's render fields, the seconds baked and the box's own files. */
export function renderKey(look: Renders, seconds: number, boxDigest = '') {
  return createHash('sha256').update(JSON.stringify({ v: 1, fields: renderFields(look), seconds, boxDigest }))
    .digest('hex');
}

/** The box's inputs as one digest (its script, renderer, core, LED map, library and Node), re-read on change. */
function boxDigester(config: Partial<RenderBox['config']> | undefined) {
  let memo: { sig: string | null, digest: string, core: string[] } = { sig: null, digest: '', core: [] };
  const statSig = (f: string) => fs.stat(f).then((st) => `${st.size}:${st.mtimeMs}`, () => '-');
  const library = async (dir = config?.patternsDir) => (dir ? (await fs.readdir(dir).catch(() => []))
    .filter((n) => /\.(js|json)$/.test(n)).sort().map((n) => path.join(dir, n)) : []);
  const signature = async (files: string[]) => (await Promise.all(files.map(async (f) => `${f}=${await statSig(f)}`)))
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
export function parseBytes<T>(v: unknown, fallback: T) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmg]?)i?b?\s*$/i.exec(String(v ?? ''));
  const unit: Record<string, number> = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
  return m ? Math.floor(Number(m[1]) * unit[m[2]!.toLowerCase()]!) : fallback;
}

/** "1800", "1800s", "30m", "2h", "500ms" → milliseconds. Bare numbers are seconds. */
export function parseDuration<T>(v: unknown, fallbackMs: T) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)?\s*$/.exec(String(v ?? ''));
  const unit: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  return m ? Number(m[1]) * unit[m[2] || 's']! : fallbackMs;
}

export function framesPath(dir: string, lookId: string) {
  if (!LOOK_ID.test(String(lookId))) throw new Error(`bad look id ${String(lookId).slice(0, 80)}`);
  return path.join(dir, `${lookId}.fseq`);
}

let tmpSeq = 0;
/** Make `file` atomically: write(tmp) makes a temporary file beside it, then a rename puts it in place. */
async function atomically(file: string, write: (tmp: string) => Promise<unknown>) {
  const tmp = `${file}.${process.pid}.${(tmpSeq++).toString(36)}.tmp`;
  try {
    await write(tmp);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
export const writeAtomic = (file: string, bytes: string | Uint8Array) =>
  atomically(file, (tmp) => fs.writeFile(tmp, bytes, { mode: 0o600 }));

/** Store a look's frames (atomically). */
export async function saveFrames(dir: string, lookId: string, bytes: Uint8Array) {
  await fs.mkdir(dir, { recursive: true });
  await writeAtomic(framesPath(dir, lookId), bytes);
}

export async function removeFrames(dir: string | undefined, lookId: string) {
  if (dir && LOOK_ID.test(String(lookId))) await fs.rm(framesPath(dir, lookId), { force: true }).catch(() => {});
}

/**
 * The bake queue: request(lookId) → its bake record, restore(look), idle(), stop(), size. A bake renders the look's
 * render fields and duration as they are when it starts, and is kept only if they are unchanged when it ends;
 * onFrames(lookId) then hears of it. restore() bakes frames that were evicted again, keeping the record when
 * the bytes come out the same. request() throws BakeError with `status` 503 (no box) or 429 (full).
 */
export function createBakeQueue({ store, box, framesDir, rigFile, maxQueue = 16, log = console, onFrames,
  lane = createLane(), flash }: { store: Pick<Store, 'looks'>, box: Pick<RenderBox, 'probe' | 'render'> & {
  stop?(): void, config?: Partial<RenderBox['config']> }, framesDir: string, rigFile: string, maxQueue?: number,
  log?: Logger, onFrames?: (id: string) => unknown, lane?: ReturnType<typeof createLane>, flash?: FlashSettings }) {
  const source = 'render-box';
  const pending: string[] = [];
  const asking = new Set<string>();    // ids between request() and the queue, so a double click is one bake
  const restoring = new Set<string>(); // ids whose evicted frames are being baked again
  const digest = boxDigester(box.config);
  let running: string | null = null, waiters: (() => void)[] = [], rig: { sig: string, value?: Rig } = { sig: '' };
  // Bakes cut short by a restart are marked failed, so nobody waits on them.
  const cut = (l: StoredLook) => l.bake?.source === source && ['queued', 'running'].includes(l.bake.status);
  for (const look of store.looks.list(cut)) {
    store.looks.update(look.id, { bake: failedBake(source, 'The bake was interrupted by a restart; bake again.') });
  }

  async function loadRig(): Promise<Rig> {
    const st = await fs.stat(rigFile);
    const sig = `${st.mtimeMs}:${st.size}`;
    if (rig.sig !== sig) rig = { sig, value: JSON.parse(await fs.readFile(rigFile, 'utf8')) };
    return rig.value!;
  }

  /** A done render-box bake with this renderKey (or these frames) whose file is still there: { look, file }. */
  async function stored({ key, sha }: { key?: string, sha?: string }) {
    const match = (l: StoredLook) => l.bake?.source === source && l.bake.status === 'done' && l.bake.frames
      && (key ? l.bake.renderKey === key : l.bake.frames.sha256 === sha);
    for (const look of store.looks.list(match)) {
      const file = framesPath(framesDir, look.id);
      if (await fs.stat(file).then((st) => st.isFile(), () => false)) return { look, file };
    }
    return null;
  }

  /** Give look `id` the frames in `file`: a hard link (a copy where links fail), placed atomically. */
  async function adopt(id: string, file: string) {
    const to = framesPath(framesDir, id);
    if (file !== to) await atomically(to, (tmp) => fs.link(file, tmp).catch(() => fs.copyFile(file, tmp)));
  }

  async function bakeOne(id: string) {
    const look = await store.looks.get(id);
    if (!look) return;
    const restore = restoring.has(id) && look.bake?.frames ? look.bake : null;
    const hash = layersHash(renderFields(look));
    const seconds = bakeSeconds(look, box.config?.seconds);
    const key = renderKey(look, seconds, await digest());
    const startedAt = new Date().toISOString();
    if (!restore) {
      const bake: Bake = { source, status: 'running', ok: false, requestedAt: look.bake?.requestedAt, startedAt };
      await store.looks.update(id, { bake });
    }
    const extra = Object.fromEntries((['globals', 'automation', 'bpm'] as const).filter((k) => look[k] != null)
      .map((k) => [k, look[k]]));
    let out: { bake: Bake, frames?: Uint8Array };
    try {
      const { bytes, boxStats } = await lane.run(() => box.render({ layers: look.layers ?? [], seconds, ...extra }));
      out = checkFrames(bytes, { source, rig: await loadRig(), maxBytes: box.config?.maxFramesBytes, boxStats,
        flash });
    } catch (err) {
      if (!(err instanceof BakeError)) log.error?.(`[bake] look ${id}:`, err);
      const reason = err instanceof BakeError ? err.reason : 'The render box failed.';
      const { boxStats } = err as BakeError;
      out = { bake: failedBake(source, reason, boxStats ? { boxStats } : {}) };
    }
    Object.assign(out.bake, { layersHash: hash, renderKey: key, seconds });
    const now = await store.looks.get(id);
    if (!now || layersHash(renderFields(now)) !== hash || bakeSeconds(now, box.config?.seconds) !== seconds) {
      log.info?.(`[bake] look ${id} changed or went away while baking; result dropped`);
      return;
    }
    // The same bytes as the evicted frames, and nobody asked for a new bake meanwhile: put them back and
    // keep the record (and its review).
    const sha = restore?.frames!.sha256;
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
    running = pending.shift()!;
    bakeOne(running)
      .catch((err) => log.error?.(`[bake] look ${running} crashed:`, err))
      .finally(() => { restoring.delete(running!); running = null; pump(); });
  }

  const queued = (id: string) => running === id || pending.includes(id);
  const full = () => pending.length + asking.size >= maxQueue;

  return {
    async request(id: string) {
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
            const bake = { ...hit.look.bake!, layersHash: layersHash(renderFields(look)), checkedAt: new Date()
              .toISOString() };
            if (await store.looks.update(id, { bake })) onFrames?.(id);
          }, (err) => log.warn?.(`[bake] look ${id}: could not reuse ${hit.look.id}'s frames: ${err.message}`));
          const now = store.looks.get(id);
          if (now?.bake?.renderKey === key && now.bake.status === 'done') return now.bake;
        }
        const p = await box.probe();
        if (!p.ok) throw Object.assign(new BakeError(p.reason), { status: 503 });
        await removeFrames(framesDir, id);
        const bake: Bake = { source, status: 'queued', ok: false, requestedAt: new Date().toISOString() };
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
    async restore(lookOrId: string | StoredLook) {
      const look = store.looks.get(typeof lookOrId === 'string' ? lookOrId : lookOrId?.id);
      const b = look?.bake;
      if (!look || b?.source !== source || b.status !== 'done' || !b.frames?.sha256) return false;
      if (queued(look.id) || asking.has(look.id)) return true;
      const hit = await stored({ sha: b.frames.sha256 }); // another look may hold the same frames
      if (hit && await adopt(look.id, hit.file).then(() => true, () => false)) { onFrames?.(look.id); return true; }
      if (full() || !(await box.probe()).ok) return false;
      restoring.add(look.id);
      pending.push(look.id);
      pump();
      return true;
    },
    idle: () => (!running && !pending.length ? Promise.resolve() : new Promise<void>((r) => waiters.push(r))),
    stop() { pending.length = 0; box.stop?.(); },
    get size() { return pending.length + (running ? 1 : 0); },
  };
}

/**
 * Why a look cannot be marked reviewed yet ('' when it can): it needs a passing render-box bake of its code. Failing
 * only the flash check, it passes when a curator gives a reason (`override`).
 */
export function reviewBlocker(look: StoredLook, { override = '' } = {}) {
  const b = look?.bake;
  const flashing = b?.ok === false && b.analysis?.flicker?.ok === false;
  if (flashing && !override) {
    return `${flickerReason(b.analysis)} A look that fails the flash check needs a curator's reason to be marked `
      + 'reviewed.';
  }
  if (!b || b.source !== 'render-box' || !['done', 'failed'].includes(b.status)) {
    return 'Bake this look in the render box first: only looks with a passing bake can be marked reviewed.';
  }
  if (b.layersHash !== layersHash(renderFields(look))) {
    return 'The code changed since the last bake. Bake it again first.';
  }
  if (!b.ok && !flashing) return `The last bake failed: ${b.reason || 'no reason given'}`;
  return '';
}
