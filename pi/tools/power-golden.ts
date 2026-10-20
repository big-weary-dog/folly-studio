// The power compressor's golden frames: pi/test/frames.ts through the lighting repo's own compress-fseq.py (read, never
// written: Python runs with -B), each output frame's sha256 into pi/test/power-golden.json, for test/pi-power.test.js
// where no lighting checkout is. node pi/tools/power-golden.ts [LIGHTING] (default ~/lighting).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFseq } from '../../public/js/fseq.ts';
import { COG_POWER } from '../src/power.ts';
import { CELL_CHANNELS, testFrames } from '../test/frames.ts';

export const GOLDEN = fileURLToPath(new URL('../test/power-golden.json', import.meta.url));
export const LIGHTING = path.join(homedir(), 'lighting');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 16);

/** compress-fseq.py on the test frames → { hashes (per frame), summary (its report's lines) }. */
export function pythonPower(lighting = LIGHTING, data = testFrames(), o = COG_POWER) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pi-power-'));
  try {
    const frames = data.length / CELL_CHANNELS;
    writeFileSync(path.join(dir, 'in.fseq'), writeFseq({ channelCount: CELL_CHANNELS, frames, data }));
    const out = execFileSync('python3', ['-B', '-I', path.join(lighting, 'pixel-map', 'compress-fseq.py'),
      path.join(dir, 'in.fseq'), path.join(dir, 'out.fseq'), '--cap', String(o.cap), '--headroom', String(o.headroom),
      '--gen', String(o.gen)], { encoding: 'utf8' });
    const f = readFileSync(path.join(dir, 'out.fseq'));
    const offset = f.readUInt16LE(4), channels = f.readUInt32LE(10);
    const hashes = [];
    for (let i = 0; i < frames; i++) hashes.push(sha(f.subarray(offset + i * channels, offset + (i + 1) * channels)));
    const summary = out.split('\n').map((l) => l.trim())
      .filter((l) => /frames touched|deepest cut|generator peak/.test(l));
    return { channels, hashes, summary };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export { sha };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const g = pythonPower(process.argv[2] || LIGHTING);
  writeFileSync(GOLDEN, JSON.stringify({ about: 'pi/tools/power-golden.ts: compress-fseq.py on pi/test/frames.ts',
    options: COG_POWER, ...g }, null, 1) + '\n');
  console.log(`wrote ${GOLDEN}: ${g.hashes.length} frames`, g.summary);
}
