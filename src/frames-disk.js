// Baked frames within a disk budget (STUDIO_FRAMES_MAX_BYTES, default 2 GB). While <framesDir> holds more,
// the frames used least recently go: a bake's .fseq files with its wire folder (chunks and downloads). Never
// a reviewed look's, a fleet-box bake's (no box can make it again) or frames in use. An evicted bake keeps
// its record and is baked again when someone asks for its frames: bakes are deterministic.
// Last use: when this run saw it used, else the .fseq's mtime (touched on use, at most every 10 minutes).

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { framesPath } from './bake.js';
import { wireHash } from './frames-wire.js';

export const DEFAULT_FRAMES_MAX_BYTES = 2 * 1024 ** 3;
const TOUCH_MS = 10 * 60_000;
const MIN_GAP_MS = 5000; // between two looks at the whole folder
const shaOf = (look) => {
  const sha = look?.bake?.frames?.sha256;
  return typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha) ? sha : null;
};

async function folderBytes(dir) {
  const names = await fs.readdir(dir).catch(() => []);
  const stats = await Promise.all(names.map((n) => fs.stat(path.join(dir, n)).catch(() => null)));
  return stats.reduce((n, st) => n + (st?.isFile() ? st.size : 0), 0);
}

/** createFramesDisk({ framesDir, store, maxBytes, busy() → Set of sha256 in use, log }) → { touch, enforce, usage } */
export function createFramesDisk({ framesDir, store, maxBytes = DEFAULT_FRAMES_MAX_BYTES, busy = () => new Set(),
  log = console }) {
  const used = new Map(); // sha256 → when this run last saw it used
  let running = null, again = false, lastRun = 0, timer = null;

  /** Note that a look's frames were used (streamed, downloaded, baked). */
  function touch(look) {
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
    const groups = new Map();
    const inUse = busy();
    for (const look of store.looks.list((l) => shaOf(l))) {
      const sha = shaOf(look);
      const g = groups.get(sha) ?? { sha, looks: [], bytes: 0, lastUsed: used.get(sha) ?? 0, keep: inUse.has(sha) };
      g.looks.push(look.id);
      g.keep ||= look.reviewed === true || look.bake.source !== 'render-box';
      groups.set(sha, g);
    }
    const byLook = new Map([...groups.values()].flatMap((g) => g.looks.map((id) => [`${id}.fseq`, g])));
    const byFolder = new Map([...groups.values()].map((g) => [wireHash(g.sha), g]));
    const seen = new Set(); // inodes: looks with the same frames share one file
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
    if (running) {
      again = true;
      return running;
    }
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
        if (again) {
          again = false;
          enforce();
        }
      });
    return running;
  }

  return { touch, enforce, usage, evict, get maxBytes() { return maxBytes; } };
}
