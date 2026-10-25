import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, test } from 'vitest';
import { ledRanges, writeFseq, writeFseqHeader } from '../public/js/fseq.ts';
import { bakeFile, bakeLoop } from '../render-box/renderer.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'bake-stream-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test('streaming a stateful bake produces exactly the buffered writer bytes and errors', () => {
  const frames = 81, ranges = [[3, 6], [500, 3]], uniqueId = 123n;
  const render = () => {
    const packed = new Uint8Array(9);
    return { packed, next(f) {
      packed.forEach((v, c) => { packed[c] = (v + c + f) % 256; });
      return f === 80 ? [{ id: 'layer', error: 'bad frame' }] : [];
    } };
  };
  const a = render(), b = render();
  const buffered = bakeLoop(frames, a.packed, a.next);
  const header = writeFseqHeader({ frames, ranges, uniqueId });
  const file = path.join(dir, 'stream.fseq');
  const streamed = bakeFile(file, header, frames, b.packed, b.next);
  assert.deepEqual(readFileSync(file), Buffer.from(writeFseq({ frames, ranges, uniqueId, data: buffered.data })));
  assert.deepEqual(streamed.layers, buffered.layers);
});

for (const name of ['rig', 'rig-folly']) {
  test(`a longest supported ${name} bake reads and loops within a fixed memory bound`, async () => {
    const rigFile = path.join(root, `public/data/${name}.json`);
    const rig = JSON.parse(readFileSync(rigFile, 'utf8'));
    const ranges = ledRanges(rig), frames = 600 * rig.output.fps;
    const header = writeFseqHeader({ frames, ranges, uniqueId: 1 });
    const file = path.join(dir, `${name}.fseq`);
    writeFileSync(file, header);
    truncateSync(file, header.length + frames * ranges.reduce((n, r) => n + r[1], 0));
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    // The bound measures live backing stores, not garbage awaiting V8's concurrent ArrayBuffer sweeper.
    const result = spawnSync(process.execPath, ['--expose-gc', '--no-concurrent-array-buffer-sweeping',
      'test/fixtures/baked-memory.mjs',
      rigFile, file, hash.digest('hex')], { cwd: root, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    const memory = JSON.parse(result.stdout);
    assert.equal(memory.duration, 600);
    assert.ok(memory.peakBufferBytes < 4 * 1024 ** 2, JSON.stringify(memory));
    assert.ok(memory.retainedBufferBytes < 1024 ** 2, JSON.stringify(memory));
    console.log(name, memory);
  }, 40_000);
}
