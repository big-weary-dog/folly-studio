// Plays baked frames while they download (SPEC "Baked frames"): the manifest, then chunk by chunk.
// Playback starts once the first is in, two more come ahead, a seek fetches the chunk it lands in.
// Chunks are immutable, so the HTTP cache keeps what this drops. Nothing is allocated per frame.

import { decodeChunk, parseManifest, readFrame } from './frames-wire.js';

const KEEP = 8;              // decoded chunks kept: about 9 MB of sparse frames
const RETRY_MS = 2000;       // a failed chunk is asked for again after this
const MAX_WAIT_MS = 10 * 60 * 1000;
const SLOW = new Set(['slow-2g', '2g', '3g']);

/** May baked frames start downloading without asking? Not on phones or slow or metered links. */
export function autoFetchAllowed(nav = globalThis.navigator) {
  const c = nav?.connection;
  if (c?.saveData === true || c?.type === 'cellular' || SLOW.has(c?.effectiveType)) return false;
  return !(nav?.userAgentData?.mobile ?? /Mobi/i.test(String(nav?.userAgent ?? '')));
}

async function failure(res) {
  let msg = `Could not load the baked frames (${res.status}).`;
  try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
  return Object.assign(new Error(msg), { status: res.status });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The bake's manifest. /frames/wire redirects to its immutable URL, or answers 202 while encoding. */
export async function fetchManifest(lookId, { fetch = globalThis.fetch, wait = sleep } = {}) {
  const url = `/api/looks/${encodeURIComponent(lookId)}/frames/wire`;
  for (let waited = 0; ;) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (res.status === 202) {
      const ms = Math.min(10, Math.max(1, Number(res.headers.get('retry-after')) || 2)) * 1000;
      if ((waited += ms) > MAX_WAIT_MS) {
        throw new Error('The baked frames are still being prepared. Try again soon.');
      }
      await wait(ms);
      continue;
    }
    if (!res.ok) throw await failure(res);
    return parseManifest(await res.json());
  }
}

/** Each LED's first channel within a frame of the file (−1 when the file does not hold it). */
function ledOffsets(cathedral, ranges) {
  const N = cathedral.count;
  const cpu = cathedral.channelsPerUniverse || 510;
  const { universe, channel } = cathedral.pixels;
  const starts = [], offsets = [], ends = [];
  let off = 0;
  for (const [start, count] of ranges) {
    starts.push(start); offsets.push(off); ends.push(start + count); off += count;
  }
  const lut = new Int32Array(N).fill(-1);
  for (let k = 0, r = 0; k < N; k++) {
    const a = (universe[k] - 1) * cpu + (channel[k] - 1);
    if (!(a >= starts[r] && a + 3 <= ends[r])) {          // pixels mostly run in range order
      r = 0;
      while (r < starts.length && !(a >= starts[r] && a + 3 <= ends[r])) r++;
      if (r === starts.length) { r = 0; continue; }
    }
    lut[k] = offsets[r] + (a - starts[r]);
  }
  return lut;
}

/**
 * openFrameStream(lookId, cathedral, { fetch?, onChunk?, manifest?, ahead? }) → once the first chunk is in,
 * { frameCount, fps, seconds, bytes, manifest, frameAt(i, rgb) }. frameAt fills rgb (count × 3) with frame i;
 * while its chunk is on the way it leaves rgb as it was, and onChunk(n) says when it arrives.
 */
export async function openFrameStream(lookId, cathedral, opts = {}) {
  const { fetch = globalThis.fetch, onChunk, ahead = 2 } = opts;
  const m = opts.manifest || await fetchManifest(lookId, { fetch });
  const base = `/api/looks/${encodeURIComponent(lookId)}/frames/${m.hash}/`;
  const lut = ledOffsets(cathedral, m.ranges);
  const N = cathedral.count;
  const frame = new Uint8Array(m.channels);
  const count = m.chunks.length;
  const cache = new Map();   // n → decoded chunk, least recently used first
  const loading = new Map(); // n → Promise<chunk>
  const failedAt = new Map();
  let waitingFor = -1, shown = -1;
  function load(n) {
    if (cache.has(n) || loading.has(n)) return loading.get(n);
    if (Date.now() - (failedAt.get(n) ?? -Infinity) < RETRY_MS) return undefined;
    const p = (async () => {
      const res = await fetch(base + n, { credentials: 'same-origin' });
      if (!res.ok) throw await failure(res);
      const chunk = decodeChunk(new Uint8Array(await res.arrayBuffer()), m, n);
      cache.set(n, chunk);
      while (cache.size > Math.max(KEEP, ahead + 1)) cache.delete(cache.keys().next().value);
      if (waitingFor === n) { waitingFor = -1; onChunk?.(n); }
      return chunk;
    })();
    loading.set(n, p);
    p.catch(() => failedAt.set(n, Date.now())).finally(() => loading.delete(n));
    return p;
  }
  /** Chunk n and the next ones (round to the start: playback loops), most recently wanted last. */
  function want(n) {
    for (let k = 0; k <= ahead && k < count; k++) {
      const c = (n + k) % count;
      const hit = cache.get(c);
      if (hit) { cache.delete(c); cache.set(c, hit); } else load(c);
    }
  }

  await load(0);
  want(0);
  const scale = 1 / 255;
  return {
    frameCount: m.frames, fps: m.fps, seconds: m.frames / m.fps, bytes: m.bytes, manifest: m,
    frameAt(i, rgb) {
      const f = Math.max(0, Math.min(m.frames - 1, i | 0));
      const n = Math.floor(f / m.chunkFrames);
      if (n !== shown) { shown = n; want(n); }
      const chunk = cache.get(n);
      if (!chunk) {                                       // on its way: keep the frame on show
        waitingFor = n;
        load(n);
        return rgb;
      }
      readFrame(chunk, f - n * m.chunkFrames, frame);
      for (let k = 0, o = 0; k < N; k++, o += 3) {
        const at = lut[k];
        if (at < 0) { rgb[o] = rgb[o + 1] = rgb[o + 2] = 0; continue; }
        rgb[o] = frame[at] * scale;
        rgb[o + 1] = frame[at + 1] * scale;
        rgb[o + 2] = frame[at + 2] * scale;
      }
      return rgb;
    },
  };
}
