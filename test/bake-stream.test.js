import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, test } from 'vitest';
import { writeFseq, writeFseqHeader } from '../core/fseq.ts';
import { bakeFile, bakeLoop } from '../render-box/renderer.ts';

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

