// The Pi's rose expansion and power compressor against the lighting repo's Python: the golden frames everywhere, and
// compress-fseq.py itself where a lighting checkout is (LIGHTING_DIR, or lighting/ beside this repo).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, test } from 'vitest';

import { checkPixels, COG_POWER, expandRose, type PowerTable, powerLimiter } from '../src/power.ts';
import { GOLDEN, LIGHTING, pythonPower, sha } from '../tools/power-golden.ts';
import { CELL_CHANNELS, testFrames } from './frames.ts';

const table: PowerTable = JSON.parse(readFileSync(new URL('../data/power.json', import.meta.url), 'utf8'));
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const lighting = LIGHTING;
const noLighting = `no lighting checkout at ${lighting} (set LIGHTING_DIR): the golden frames stand in for it`;
const hasLighting = existsSync(path.join(lighting, 'pixel-map', 'compress-fseq.py'));

/** The test frames through expandRose and powerLimiter → each frame's hash, and the limiter's stats. */
function ours(o = COG_POWER) {
  const data = testFrames(), n = data.length / CELL_CHANNELS;
  const out = new Uint8Array(table.channels), limiter = powerLimiter(table, o), hashes = [];
  for (let f = 0; f < n; f++) {
    expandRose(table, data.subarray(f * CELL_CHANNELS, (f + 1) * CELL_CHANNELS), out);
    limiter.apply(out);
    hashes.push(sha(out));
  }
  return { hashes, stats: limiter.stats };
}

test('the engine starts only on a rig with the pixels lighting\'s pixel map has', () => {
  const rig = JSON.parse(readFileSync(new URL('../../public/data/rig.json', import.meta.url), 'utf8'));
  assert.equal(table.pixels, rig.count);
  checkPixels(rig, table);
  assert.throws(() => checkPixels({ ...rig, count: rig.count - 1 }, table), /has \d+ px .* stale map/);
  const short = { ...rig, pixels: { universe: rig.pixels.universe.slice(1) } };
  assert.throws(() => checkPixels(short, table), /listed\) but .* stale map/);
});

describe('the rose expanded', () => {
  test('each petal LED its cell\'s colour, passage LEDs dark, 8,097 lit, every rig channel as it was', () => {
    const cells = new Uint8Array(CELL_CHANNELS);
    for (let i = 0; i < 1020; i++) cells[i] = (i % 251) + 1;
    cells[20000] = 7;
    const out = new Uint8Array(table.channels).fill(9);
    out.fill(0, CELL_CHANNELS);
    expandRose(table, cells, out);
    assert.equal(out.length, 70401);
    assert.equal(out[20000], 7);
    let lit = 0;
    for (let i = CELL_CHANNELS; i < out.length; i += 3) if (out[i]) lit++;
    assert.equal(lit, 8097);
    const p = table.petals[2]!, [skip, cell] = p.segments[0]!;
    assert.deepEqual([...out.subarray(p.exp + skip * 3, p.exp + skip * 3 + 3)],
      [...cells.subarray(p.src + cell * 3, p.src + cell * 3 + 3)]);
  });
});

describe('the power compressor', () => {
  test('matches compress-fseq.py frame for frame (the golden frames)', () => {
    assert.deepEqual(golden.options, COG_POWER);
    const { hashes } = ours();
    assert.equal(hashes.length, golden.hashes.length);
    hashes.forEach((h, f) => assert.equal(h, golden.hashes[f], `frame ${f}`));
  });

  test('reports what compress-fseq.py reports', () => {
    const { stats } = ours(), pct = (s: string) => `${s}=${((1 - stats.minGain[s]!) * 100).toFixed(1).padStart(4)}%`;
    assert.equal(golden.summary[0].split(' (')[0], `frames touched: ${stats.compressedFrames}/${stats.frames}`);
    assert.equal(golden.summary[1], `per-set deepest cut:  ${[...table.sets].map(pct).join('   ')}`);
    assert.match(golden.summary[2], new RegExp(`^generator peak \\(design×cap\\): ${stats.genPeakW.toFixed(0)} W`));
    assert.ok(stats.compressedFrames > 0 && stats.genPeakW > COG_POWER.gen, 'the frames make both rules cut');
  });

  test('matches compress-fseq.py itself, at other settings too', ({ skip }) => {
    skip(!hasLighting, noLighting);
    for (const o of [COG_POWER, { cap: 1, headroom: 0.9, gen: 3000 }, { cap: 0.5, headroom: 1, gen: 9000 }]) {
      const py = pythonPower(lighting, testFrames(), o);
      assert.deepEqual(ours(o).hashes, py.hashes, JSON.stringify(o));
    }
    assert.deepEqual(pythonPower(lighting).hashes, golden.hashes, 'the golden frames are current');
  });

  test('power.json is the lighting repo\'s model as it is now', ({ skip }) => {
    skip(!hasLighting, noLighting);
    const tool = new URL('../tools/build_power.py', import.meta.url).pathname;
    assert.match(execFileSync('python3', ['-B', '-I', tool, lighting, '--check'], { encoding: 'utf8' }), /current/);
  });
});
