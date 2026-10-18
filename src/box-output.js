// What a box hands back, as untrusted data (SPEC "Baked frames"): files read with care, its report cut to
// small plain data (kept only as `boxStats`, labelled untrusted), its frames checked by src/frames.js.
// `ok` and `analysis` come from our own checks. Nothing here runs look code.

import { createHash } from 'node:crypto';
import { constants as FS, promises as fs } from 'node:fs';
import path from 'node:path';

import { flashRegions, prepareScene } from '../public/js/pattern-core.js';
import { analyzeFrames, DEFAULT_MAX_BYTES, flickerReason, flickerWarning, FseqError, parseFseq } from './frames.js';
import { inflateBlock } from './fseq-codec.js';

export const CONTROL = /[\u0000-\u001f\u007f]/g;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** An error whose `reason` is safe to show to people. */
export class BakeError extends Error {
  constructor(reason, detail) {
    super(detail ? `${reason} (${detail})` : reason);
    this.name = 'BakeError';
    this.reason = reason;
  }
}

/** A file a box wrote, as untrusted bytes: a regular file directly in `within`, no symlink or hard link,
 * at most maxBytes. Throws BakeError. */
export async function readUntrusted(file, { maxBytes, within } = {}) {
  const name = path.basename(file);
  if (within) {
    const dir = await fs.realpath(path.dirname(file)).catch(() => null);
    if (!dir) throw new BakeError(`${name} is missing`);
    if (dir !== path.resolve(within)) throw new BakeError(`${name} is not inside the box's folder`);
  }
  let fh;
  try {
    fh = await fs.open(file, FS.O_RDONLY | FS.O_NOFOLLOW | FS.O_NONBLOCK);
  } catch (err) {
    const why = { ENOENT: 'is missing', ELOOP: 'is a symlink' }[err.code] || 'cannot be opened';
    throw new BakeError(`${name} ${why}`, err.code);
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
      if (k.length <= 64 && !BAD_KEYS.has(k)) out[k.replace(CONTROL, ' ')] = clean(v[k], depth + 1);
    }
    return out;
  };
  const reported = clean(value, 0);
  return { untrusted: true, reported: JSON.stringify(reported).length <= 4096 ? reported : { truncated: true } };
}

/**
 * Baked frames, parsed and analysed on the LED map → { bake, frames? (bytes to store) }. Large-area flashing
 * fails `ok`; flashing on small regions only sets `warning`.
 */
export function checkFrames(bytes, { source, rig, maxBytes = DEFAULT_MAX_BYTES, boxStats } = {}) {
  const bake = { source, status: 'done', ok: false, checkedAt: new Date().toISOString() };
  if (boxStats) bake.boxStats = boxStats;
  let analysis;
  try {
    const scene = prepareScene(rig);
    const parsed = parseFseq(bytes, { maxBytes, maxChannels: scene.frameChannels, decompress: inflateBlock });
    analysis = analyzeFrames(parsed, scene, flashRegions(scene));
  } catch (err) {
    bake.status = 'failed';
    bake.reason = err instanceof FseqError ? `The baked frames were rejected: ${err.message.replace(/^frames: /, '')}.`
      : 'The baked frames could not be checked.';
    return { bake };
  }
  bake.analysis = analysis;
  bake.frames = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  bake.ok = analysis.flicker.ok;
  if (!bake.ok) bake.reason = flickerReason(analysis);
  const warning = flickerWarning(analysis);
  if (warning) bake.warning = warning;
  return { bake, frames: bytes };
}

/** A bake record for a box that left no usable frames. */
export function failedBake(source, reason, extra = {}) {
  return { source, status: 'failed', ok: false, checkedAt: new Date().toISOString(), reason, ...extra };
}
