// Gallery previews (SPEC "Gallery previews"): each shared look's motion as a looping animated WebP and a still for
// reduced motion, in <STUDIO_DATA>/previews/<lookId>-<key>.webp and <lookId>-<key>-still.webp, <key> naming what
// it renders. Made off the request path, one look at a time, in the lane bakes use (so they take turns): its frames
// come from its bake when that is current (a look being baked waits for it), else from the render box; the camera
// (the Playa view, ./playa.ts) draws them; sharp (libvips) writes the WebP. A look keeps its last preview until a
// fresh one replaces it; backfill() drops the previews of looks no longer shared.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import type { Rig } from '../../shared/schemas/rig.ts';
import { bakeSeconds, createLane, framesPath, layersHash, renderFields, writeAtomic } from '../bake.ts';
import type { Logger } from '../http.ts';
import type { RenderBox } from '../render-box.ts';
import type { Store, StoredLook } from '../store.ts';
import { type Camera, frontView, type Loop, type Motion, previewFrames } from './motion.ts';

const VERSION = 2; // 2: the Playa view
const MAX_SECONDS = 60; // rendered when the look has no current bake
const QUALITIES = [50, 40, 30]; // the first whose loop fits MAX_BYTES, else the last
export const MAX_BYTES = 300 * 1024;
const FILE = /^([A-Za-z0-9_-]{1,64})-([0-9a-f]{16})(-still)?\.webp$/;

/** What a look's preview shows: changes with its render fields and duration. */
export const previewKey = (look: StoredLook) => createHash('sha256')
  .update(JSON.stringify({ v: VERSION, fields: layersHash(renderFields(look)), duration: look.duration ?? null }))
  .digest('hex').slice(0, 16);

/** Pictures → { webp: the loop, still }. */
export async function encodePreview(m: Motion) {
  const raw = { width: m.width, height: m.height, channels: 3 as const }, pages = Buffer.concat(m.frames);
  let webp = Buffer.alloc(0);
  for (const quality of QUALITIES) {
    webp = await sharp(pages, { raw: { ...raw, height: m.height * m.frames.length, pageHeight: m.height } })
      .webp({ quality, effort: 4, loop: 0, delay: m.delayMs }).toBuffer();
    if (webp.length <= MAX_BYTES) break;
  }
  const still = await sharp(m.still, { raw }).webp({ quality: 80 }).toBuffer();
  return { webp, still };
}

export function createPreviews({ dir, store, box, framesDir, loadRig, lane = createLane(), log = console,
  loop = 'crossfade', camera = frontView() }: { dir: string, store: Pick<Store, 'looks'>,
  box: Pick<RenderBox, 'render'> & { config?: Partial<RenderBox['config']>, ready?(): Promise<void> },
  framesDir: string,
  loadRig: () => Rig | null, lane?: ReturnType<typeof createLane>, log?: Logger, loop?: Loop, camera?: Camera }) {
  const have = new Map<string, string>(); // look id → the key of its preview on disk
  const failed = new Set<string>();       // id:key that could not be made (until a restart)
  const pending: string[] = [];
  let running: Promise<void> | null = null, stopped = false;
  const ready = fs.mkdir(dir, { recursive: true }).then(() => fs.readdir(dir)).then((names) => {
    for (const name of names) {
      const m = FILE.exec(name);
      if (m && !m[3]) have.set(m[1]!, m[2]!);
    }
  }).catch((err) => log.error?.('[previews] could not read their folder:', err));
  const files = (id: string, key: string) => [`${id}-${key}.webp`, `${id}-${key}-still.webp`]
    .map((n) => path.join(dir, n));

  const baked = ({ bake, ...look }: StoredLook) => bake?.status === 'done' && !!bake.frames
    && bake.layersHash === layersHash(renderFields(look));
  /** The look's current frames: its bake's when that renders what the look does now, else a fresh render. */
  async function framesOf(look: StoredLook) {
    if (baked(look)) {
      const bytes = await fs.readFile(framesPath(framesDir, look.id)).catch(() => null);
      if (bytes) return bytes;
    }
    const extra = Object.fromEntries((['globals', 'automation', 'bpm'] as const).filter((k) => look[k] != null)
      .map((k) => [k, look[k]]));
    const seconds = bakeSeconds(look, Math.min(MAX_SECONDS, box.config?.seconds ?? MAX_SECONDS));
    return (await box.render({ layers: look.layers ?? [], seconds, ...extra })).bytes;
  }

  async function make(id: string) {
    const look = store.looks.get(id);
    if (!look || look.shared !== true) return;
    const key = previewKey(look);
    if (have.get(id) === key || failed.has(`${id}:${key}`)) return;
    if (look.bake?.status === 'queued' || look.bake?.status === 'running') return; // its frames will do (onFrames)
    try {
      const rig = loadRig();
      if (!rig) throw new Error('no rig');
      let started = 0;
      if (!baked(look)) await box.ready?.(); // a throttled box's cooldown, outside the lane
      const motion = await lane.run(async () => {
        started = Date.now();
        return previewFrames(await framesOf(look), rig, { loop, camera });
      });
      const drawn = Date.now();
      const { webp, still } = await encodePreview(motion);
      const now = store.looks.get(id);
      if (!now || now.shared !== true || previewKey(now) !== key) return want(id); // it changed meanwhile
      const [w, s] = files(id, key);
      await writeAtomic(s!, still);
      await writeAtomic(w!, webp);
      const old = have.get(id);
      have.set(id, key);
      if (old) await Promise.all(files(id, old).map((f) => fs.rm(f, { force: true })));
      log.info?.(`[previews] look ${id}: ${motion.frames.length} frames from ${motion.start.toFixed(1)} s, `
        + `${Math.round(webp.length / 1024)} KB, ${drawn - started} ms to render and draw, `
        + `${Date.now() - drawn} ms to encode`);
    } catch (err) {
      if ((err as { status?: number }).status !== 503) failed.add(`${id}:${key}`); // 503: baking off, for now
      log.error?.(`[previews] look ${id}: no preview:`, (err as Error)?.message ?? err);
    }
  }

  function pump() {
    if (running || stopped || !pending.length) return;
    const id = pending.shift()!;
    running = ready.then(() => make(id)).finally(() => { running = null; pump(); });
  }

  /** Queue the look's preview when it is shared and has none of what it renders now. */
  function want(id: string) {
    const look = store.looks.get(id);
    if (stopped || !look || look.shared !== true || pending.includes(id)) return;
    const key = previewKey(look);
    if (have.get(id) === key || failed.has(`${id}:${key}`)) return;
    pending.push(id);
    pump();
  }

  return {
    want,
    /** The key of the look's preview on disk, if it has one. */
    keyOf: (id: string) => have.get(id),
    /** The file for a preview's name (<key>.webp or <key>-still.webp) when it is the look's, else null. */
    file(id: string, name: string) {
      const m = FILE.exec(`${id}-${name}`);
      return m && m[1] === id && have.get(id) === m[2] ? path.join(dir, `${id}-${name}`) : null;
    },
    /** Queue every shared look's missing preview, and drop the previews of looks no longer shared. */
    async backfill() {
      await ready;
      for (const id of have.keys()) {
        if (store.looks.get(id)?.shared === true) continue;
        await Promise.all(files(id, have.get(id)!).map((f) => fs.rm(f, { force: true })));
        have.delete(id);
      }
      // The gallery's top first.
      const shared = store.looks.list((l) => l.shared === true)
        .sort((a, b) => String(b.sharedAt ?? '').localeCompare(String(a.sharedAt ?? '')));
      for (const look of shared) want(look.id);
    },
    stop() { stopped = true; pending.length = 0; },
    /** Resolves once the queue is empty. */
    async idle() { for (let r = running; r; r = running) await r; },
  };
}
