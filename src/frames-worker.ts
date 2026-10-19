// The CPU-heavy side of baked frames, in a worker thread that src/frames-cache.ts starts. It lowers its own
// priority (on Linux, nice is per thread) and compresses on its own thread, one job at a time, so the
// server's event loop and its thread pool stay free for requests. Jobs: wire (<dir>/<n>.br chunks, then
// manifest.json), gzip (the chunk for a client without br) and fseq (a compressed .fseq download).

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

import { writeAtomic } from './bake.ts';
import { parseFseq } from './frames.ts';
import { CHUNK_FRAMES, encodeWire, gzipChunk } from './frames-wire.ts';
import { type Codec, compressFseq, inflateBlock } from './fseq-codec.ts';

try {
  os.setPriority(Number(workerData?.nice) || 0);
} catch { /* not allowed here: normal priority */ }

/** A look's stored frames, parsed, if they are still the bake's (same SHA-256). */
async function readFrames(file: string, sha256: string, maxBytes: number) {
  const bytes = await fs.readFile(file);
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error(`${file} changed`);
  return parseFseq(bytes, { maxBytes, decompress: inflateBlock });
}

type Frames = { file: string, sha256: string, maxBytes: number };
const JOBS = {
  async wire({ file, sha256, dir, hash, quality, maxBytes }: Frames & { dir: string, hash: string, quality: number },
    progress: (p: { done: number, chunks: number }) => void) {
    const parsed = await readFrames(file, sha256, maxBytes);
    const chunks = Math.ceil(parsed.frameCount / CHUNK_FRAMES);
    progress({ done: 0, chunks });
    await fs.mkdir(dir, { recursive: true });
    const manifest = await encodeWire(parsed, { hash, quality, sync: true, onChunk: async (n, bytes) => {
      await writeAtomic(path.join(dir, `${n}.br`), bytes);
      progress({ done: n + 1, chunks });
    } });
    await writeAtomic(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    return { frames: parsed.frameCount, bytes: manifest.bytes, raw: parsed.data.length };
  },
  async gzip({ br, channels, out }: { br: string, channels: number, out: string }) {
    await writeAtomic(out, await gzipChunk(await fs.readFile(br), channels, { sync: true }));
  },
  async fseq({ file, sha256, codec, out, maxBytes }: Frames & { codec: Codec, out: string }) {
    await writeAtomic(out, await compressFseq(await readFrames(file, sha256, maxBytes), { codec, sync: true }));
  },
};

export type Jobs = typeof JOBS;
const port = parentPort!;
port.on('message', async ({ id, kind, args }: { id: number, kind: keyof Jobs, args: never }) => {
  try {
    const result = await JOBS[kind](args, (progress) => port.postMessage({ id, progress }));
    port.postMessage({ id, ok: true, result });
  } catch (err) {
    port.postMessage({ id, ok: false, error: String((err as Error)?.message || err) });
  }
});
