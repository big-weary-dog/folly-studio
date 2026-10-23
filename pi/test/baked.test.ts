// pi/src/baked.ts and the engine's baked items (SPEC-offline "Playing on the lights"): a bake read from Studio's
// frames folder, held to its SHA-256, fills each LED with its own colours; the queue plays it whole like any look,
// out through the same light, with no controls, and a viewer gets its title alone; one that cannot play is dropped.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, test } from 'vitest';

import { lightOf } from '../../public/js/core/light.ts';
import { ledChannels, prepareLight, prepareScene } from '../../public/js/pattern-core.ts';
import { ledRanges, writeFseq } from '../../public/js/fseq.ts';
import { loadBaked } from '../src/baked.ts';
import { FADE } from '../src/engine.ts';
import { engineOn, rig } from './fixture.ts';

const scene = prepareScene(rig), dir = mkdtempSync(path.join(tmpdir(), 'pi-baked-'));
const byte = (a: number, f: number) => (a * 7 + f * 13) % 256;   // channel a's value in frame f

/** A bake of `frames` frames as Studio stores one (sparse, the rig's ranges), written as <id>.fseq; → its SHA-256. */
function bake(id: string, frames: number, stepMs = 25) {
  const ranges = ledRanges(rig), cc = ranges.reduce((n, r) => n + r[1], 0), data = new Uint8Array(frames * cc);
  for (let f = 0; f < frames; f++) {
    let o = f * cc;
    for (const [start, count] of ranges) for (let i = 0; i < count; i++) data[o++] = byte(start + i, f);
  }
  const bytes = writeFseq({ frames, data, ranges, stepMs });
  writeFileSync(path.join(dir, `${id}.fseq`), bytes);
  return createHash('sha256').update(bytes).digest('hex');
}

describe('baked frames', () => {
  test('fill each LED with the colours its channels hold in that frame', async () => {
    const sha = bake('two', 2);
    const b = await loadBaked(dir, 'two', sha, scene);
    assert.deepEqual([b.frames, b.duration], [2, 2 / 40]);
    const rgb = new Float32Array(scene.count * 3);
    for (const f of [0, 1]) {
      b.fill(f, rgb);
      for (const k of [0, 1000, scene.count - 1]) {
        for (let c = 0; c < 3; c++) {
          assert.equal(rgb[3 * k + c], Math.fround(byte(scene.addr[k]! + scene.order[c]!, f) / 255));
        }
      }
    }
    b.close!();
  });

  test('refuse a bake that changed, is missing, is at another rate, or names no look', async () => {
    const sha = bake('one', 1);
    await assert.rejects(loadBaked(dir, 'one', '0'.repeat(64), scene), /changed since it was queued/);
    await assert.rejects(loadBaked(dir, 'none', sha, scene), /not there/);
    await assert.rejects(loadBaked(dir, '../one', sha, scene), /not a look id/);
    await assert.rejects(loadBaked('', 'one', sha, scene), /no frames folder/);
    const slow = bake('slow', 1, 50);
    await assert.rejects(loadBaked(dir, 'slow', slow, scene), /baked at 20 fps/);
  });

  test('a file cut short after validation fails the read and a closed reader cannot play', async () => {
    const sha = bake('cut', 2), b = await loadBaked(dir, 'cut', sha, scene);
    truncateSync(path.join(dir, 'cut.fseq'), 32);
    assert.throws(() => b.fill(1, new Float32Array(rig.count * 3)), /cut short/);
    b.close!();
    b.close!();
    assert.throws(() => b.fill(0, new Float32Array(rig.count * 3)), /closed/);
  });

  test('readers close on unqueue, a late load, pending replacement, playback replacement and shutdown', async () => {
    let resolve: (() => void) | undefined, delayed = false;
    const closed: string[] = [];
    const r = engineOn([], undefined, async (id) => {
      if (delayed) await new Promise<void>((done) => { resolve = done; });
      return { frames: 120, duration: 3, fill: (_, rgb) => rgb.fill(0), close: () => closed.push(id) };
    });
    r.engine.play('fire');
    r.run(1.1);
    const send = async (id: string, at: 'next' | 'now' = 'next') => {
      r.engine.sendBaked({ id, title: id, sha256: 'a'.repeat(64) }, at);
      r.run(0.1);
      await Promise.resolve();
      await Promise.resolve();
    };
    await send('removed');
    r.engine.unqueue(r.engine.state().queue[0].key);
    delayed = true;
    await send('late');
    r.engine.unqueue(r.engine.state().queue[0].key);
    resolve!();
    await Promise.resolve();
    await Promise.resolve();
    delayed = false;
    await send('pending');
    r.engine.next();
    r.engine.play('fire');
    r.run(1.1);
    await send('playing', 'now');
    r.run(1.1);
    r.engine.play('fire');
    r.run(1.1);
    await send('shutdown');
    r.engine.close();
    assert.deepEqual(closed, ['removed', 'late', 'pending', 'playing', 'shutdown']);
  });

  test('a queued bake plays whole, then the next; no controls; a viewer gets its title alone', async () => {
    const sha = bake('b1', 120);   // 3 s
    const r = engineOn([], undefined, (id, s) => loadBaked(dir, id, s, scene));
    r.engine.play('fire');
    r.run(FADE.queue + 0.1);
    assert.equal(r.engine.sendBaked({ id: 'b1', title: 'Baked one', sha256: sha }, 'now', 'ana'), true);
    r.run(0.5);
    assert.equal(r.engine.state().look?.id, 'fire');          // its frames are still being read: fire plays on
    await new Promise((res) => setTimeout(res, 50));
    r.engine.queue('beat-bars');
    r.run(2 * FADE.queue + 0.1);                               // fire fades out, the bake in
    let s = r.engine.state();
    assert.deepEqual([s.look?.id, s.look?.kind, s.look?.title, s.look?.controls], ['b1', 'baked', 'Baked one', []]);
    assert.deepEqual(r.engine.source(), { rev: r.engine.source()!.rev, id: 'b1', title: 'Baked one', duration: 3,
      globals: null, automation: null, layers: [], baked: true });
    assert.equal(r.engine.set('heat', 1), false);
    // At full output each frame goes out through the LEDs' light transform, as a rendered look's would.
    assert.equal(s.gain, 1);
    const rgb = new Float32Array(scene.count * 3);
    const check = await loadBaked(dir, 'b1', sha, scene);
    check.fill(Math.round(s.look!.t * 40) - 1, rgb);
    check.close!();
    assert.deepEqual(r.last(), ledChannels(scene, rgb, prepareLight(scene, lightOf())));
    r.run(3);
    s = r.engine.state();
    assert.equal(s.look?.id, 'beat-bars');
    r.engine.close();
  });

  test('a playback read failure closes the bake and falls back to safe', async () => {
    let closed = false;
    const r = engineOn([], undefined, async () => ({ frames: 120, duration: 3,
      fill() { throw new Error('disk read failed'); }, close() { closed = true; } }));
    r.engine.play('fire');
    r.run(1.1);
    r.engine.sendBaked({ id: 'disk', title: 'Disk', sha256: 'a'.repeat(64) }, 'now');
    await Promise.resolve();
    await Promise.resolve();
    r.run(1.2);
    assert.equal(r.engine.state().look?.id, 'safe');
    assert.ok(closed);
    assert.ok(r.log.some((line) => line.includes('cannot play baked: disk read failed')));
    r.engine.close();
  });

  test('a bake that cannot play leaves the queue, saying why, and what plays goes on', async () => {
    const r = engineOn([], undefined, (id, s) => loadBaked(dir, id, s, scene));
    r.engine.play('fire');
    r.run(FADE.queue + 0.1);
    r.engine.sendBaked({ id: 'gone', title: 'Gone', sha256: 'a'.repeat(64) }, 'next');
    r.engine.queue('beat-bars');
    r.run(0.1);
    await new Promise((res) => setTimeout(res, 50));
    assert.deepEqual(r.engine.state().queue.map((q) => q.id), ['beat-bars']);
    assert.ok(r.log.some((l) => /look gone cannot play baked: its bake is not there/.test(l)));
    assert.equal(r.engine.state().look?.id, 'fire');
    r.engine.sendBaked({ id: 'gone', title: 'Gone', sha256: 'a'.repeat(64) }, 'now');
    r.run(0.1);
    await new Promise((res) => setTimeout(res, 50));
    r.run(FADE.queue + 0.1);
    assert.equal(r.engine.state().look?.id, 'fire');       // not beat-bars, which no one asked to play now
    assert.deepEqual(r.engine.state().queue.map((q) => q.id), ['beat-bars']);
  });
});
