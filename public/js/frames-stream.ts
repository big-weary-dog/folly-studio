// Baked frames as the server streams them (SPEC "Baked frames"; src/frames-wire.js encodes), decoded and played
// while they download. A chunk is a layout byte (MODES), then its frames; each decodes alone. Playback starts with
// the first chunk, two come ahead, a seek fetches its own. Nothing is allocated per frame.
import type { Rig } from '../../shared/schemas/rig.ts';

export const MODES = Object.freeze(['frames', 'frames-delta', 'planar', 'planar-delta']);
const MAX_CHANNELS = 80 * 510;
const whole = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo
  && (v as number) <= hi;
/** A bake's frames on the wire (SPEC "Baked frames"). */
type Manifest = { version: 1; hash: string; frames: number; fps: number; channels: number;
  ranges: [number, number][]; chunkFrames: number; chunks: { bytes: number }[]; bytes: number };
type Chunk = ReturnType<typeof decodeChunk>;

/** A manifest from the server, checked, as a clean copy. */
export function parseManifest(m: Record<string, unknown> | null): Manifest {
  function bad(why: string): never { throw new Error(`The baked frames' manifest is malformed (${why}).`); }
  if (!m || typeof m !== 'object') bad('not an object');
  if (m.version !== 1) bad(`version ${m.version}`);
  if (typeof m.hash !== 'string' || !/^[0-9a-f]{32}$/.test(m.hash)) bad('hash');
  if (!whole(m.frames, 1, 1e7)) bad('frames');
  if (!(typeof m.fps === 'number' && m.fps > 0 && m.fps <= 1000)) bad('fps');
  if (!whole(m.channels, 1, MAX_CHANNELS)) bad('channels');
  if (!Array.isArray(m.ranges) || m.ranges.length > 255) bad('ranges');
  let end = 0, total = 0;
  for (const r of m.ranges) {
    if (!Array.isArray(r) || !whole(r[0], end, MAX_CHANNELS - 1) || !whole(r[1], 1, MAX_CHANNELS - r[0])) bad('ranges');
    end = r[0] + r[1];
    total += r[1];
  }
  if (m.ranges.length && total !== m.channels) bad('the ranges do not add up to the channels');
  if (!whole(m.chunkFrames, 1, 1e5)) bad('chunkFrames');
  if (!Array.isArray(m.chunks) || m.chunks.length !== Math.ceil(m.frames / m.chunkFrames)) bad('chunk count');
  let bytes = 0;
  for (const c of m.chunks) {
    if (!c || !whole(c.bytes, 1, 2 ** 31)) bad('chunk');
    bytes += c.bytes;
  }
  if (m.bytes !== bytes) bad('the chunk sizes do not add up');
  return {
    version: 1, hash: m.hash, frames: m.frames, fps: m.fps, channels: m.channels,
    ranges: m.ranges.length ? m.ranges.map(([s, c]): [number, number] => [s, c]) : [[0, m.channels]],
    chunkFrames: m.chunkFrames, chunks: m.chunks.map((c) => ({ bytes: c.bytes })), bytes,
  };
}

/** Chunk n → { data, frames, planar }, its deltas undone in place (a view). */
export function decodeChunk(bytes: Uint8Array, manifest: Manifest, n: number) {
  const frames = Math.min(manifest.chunkFrames, manifest.frames - n * manifest.chunkFrames);
  const C = manifest.channels;
  if (!(frames > 0) || n >= manifest.chunks.length) throw new Error(`There is no chunk ${n}.`);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 1 + frames * C) {
    throw new Error(`Chunk ${n} holds ${bytes?.length} bytes, not 1 + ${frames} frames × ${C} channels.`);
  }
  const mode = MODES[bytes[0]];
  if (!mode) throw new Error(`Chunk ${n} has an unknown layout (${bytes[0]}).`);
  const data = bytes.subarray(1);
  // A Uint8Array keeps sums mod 256: the encoder's mod-256 differences undone exactly.
  if (mode === 'frames-delta') for (let i = C; i < data.length; i++) data[i] += data[i - C];
  if (mode === 'planar-delta') {
    for (let o = 0; o < data.length; o += frames) for (let i = o + 1; i < o + frames; i++) data[i] += data[i - 1];
  }
  return { data, frames, planar: mode === 'planar' || mode === 'planar-delta' };
}

/** Frame j of a decoded chunk into out. */
export function readFrame(chunk: Chunk, j: number, out: Uint8Array) {
  const { data, frames, planar } = chunk;
  const C = out.length;
  if (planar) for (let c = 0, o = j; c < C; c++, o += frames) out[c] = data[o];
  else for (let c = 0, o = j * C; c < C; c++, o++) out[c] = data[o];
  return out;
}

const KEEP = 8;              // decoded chunks kept: about 9 MB of sparse frames
const RETRY_MS = 2000;       // a failed chunk is asked for again after this
const MAX_WAIT_MS = 10 * 60 * 1000;
const SLOW = new Set<string | undefined>(['slow-2g', '2g', '3g']);
type Nav = { connection?: { saveData?: boolean; type?: string; effectiveType?: string };
  userAgentData?: { mobile?: boolean }; userAgent?: string };

/** May baked frames download without asking? Not on phones, slow or metered links. */
export function autoFetchAllowed(nav: Nav | undefined = globalThis.navigator) {
  const c = nav?.connection;
  if (c?.saveData === true || c?.type === 'cellular' || SLOW.has(c?.effectiveType)) return false;
  return !(nav?.userAgentData?.mobile ?? /Mobi/i.test(String(nav?.userAgent ?? '')));
}

async function failure(res: Response) {
  let msg = `Could not load the baked frames (${res.status}).`;
  try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
  return Object.assign(new Error(msg), { status: res.status });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The bake's manifest: /frames/wire redirects to it, or answers 202 while encoding. */
export async function fetchManifest(lookId: string, { fetch = globalThis.fetch, wait = sleep } = {}) {
  const url = `/api/looks/${encodeURIComponent(lookId)}/frames/wire`;
  for (let waited = 0; ;) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (res.status === 202) {
      const ms = Math.min(10, Math.max(1, Number(res.headers.get('retry-after')) || 2)) * 1000;
      if ((waited += ms) > MAX_WAIT_MS) throw new Error('The baked frames are still being prepared. Try again soon.');
      await wait(ms);
      continue;
    }
    if (!res.ok) throw await failure(res);
    return parseManifest(await res.json());
  }
}

/** Each LED's first channel in a frame of the file (−1: not held). */
function ledOffsets(rig: Rig, ranges: [number, number][]) {
  const N = rig.count;
  const cpu = rig.output.channelsPerUniverse;
  const { universe, channel } = rig.pixels;
  const starts: number[] = [], offsets: number[] = [], ends: number[] = [];
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

/** A bake's frames to play: frameAt leaves rgb as it was while its chunk is on the way (onChunk(n) on arrival). */
export async function openFrameStream(lookId: string, rig: Rig, opts: { fetch?: typeof fetch;
  onChunk?: (n: number) => void; manifest?: Manifest; ahead?: number } = {}) {
  const { fetch = globalThis.fetch, onChunk, ahead = 2 } = opts;
  const m = opts.manifest || await fetchManifest(lookId, { fetch });
  const base = `/api/looks/${encodeURIComponent(lookId)}/frames/${m.hash}/`;
  const lut = ledOffsets(rig, m.ranges);
  const N = rig.count;
  const [oR, oG, oB] = [...'RGB'].map((c) => (rig.output.order || 'RGB').indexOf(c));
  const frame = new Uint8Array(m.channels);
  const count = m.chunks.length;
  const cache = new Map<number, Chunk>();          // least recently used first
  const loading = new Map<number, Promise<Chunk>>();
  const failedAt = new Map<number, number>();
  let waitingFor = -1, shown = -1;
  function load(n: number) {
    if (cache.has(n) || loading.has(n)) return loading.get(n);
    if (Date.now() - (failedAt.get(n) ?? -Infinity) < RETRY_MS) return undefined;
    const p = (async () => {
      const res = await fetch(base + n, { credentials: 'same-origin' });
      if (!res.ok) throw await failure(res);
      const chunk = decodeChunk(new Uint8Array(await res.arrayBuffer()), m, n);
      cache.set(n, chunk);
      while (cache.size > Math.max(KEEP, ahead + 1)) cache.delete(cache.keys().next().value!);
      if (waitingFor === n) { waitingFor = -1; onChunk?.(n); }
      return chunk;
    })();
    loading.set(n, p);
    p.catch(() => failedAt.set(n, Date.now())).finally(() => loading.delete(n));
    return p;
  }
  /** Chunk n and the next (looping), most recently wanted last. */
  function want(n: number) {
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
    frameAt(i: number, rgb: Float32Array) {
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
        rgb[o] = frame[at + oR] * scale;
        rgb[o + 1] = frame[at + oG] * scale;
        rgb[o + 2] = frame[at + oB] * scale;
      }
      return rgb;
    },
  };
}
