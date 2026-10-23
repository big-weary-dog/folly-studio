// Trusted bake verification: fresh renders, reuse and restore share the same current checks.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, test, vi } from 'vitest';

import { ledRanges, writeFseq } from '../public/js/fseq.ts';
import { LIGHT } from '../public/js/pattern-core.ts';
import { createBakeQueue, layersHash, renderFields, renderKey, reviewBlocker } from '../src/bake.ts';
import { checkFrames, cleanBoxStats } from '../src/box-output.ts';
import { lineRig } from './fixtures/rigs.js';

const rig = lineRig(10), seconds = 3;
const flash = { check: true, perSecond: 3, delta: 0.5, area: 0.25 };
const look = (id = 'a') => ({ id, duration: seconds, layers: [{ code: 'steady' }] });
function bytes({ frames = 120, stepMs = 25, ranges = ledRanges(rig), strobe = false } = {}) {
  const cc = ranges.reduce((n, r) => n + r[1], 0), data = new Uint8Array(frames * cc);
  for (let f = 0; f < frames; f++) data.fill(strobe && Math.floor(f / 2) % 2 ? 26 : 179, f * cc, (f + 1) * cc);
  return writeFseq({ frames, stepMs, ranges, data, uniqueId: 0 });
}
const folders = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(folders.splice(0).map((p) => fs.rm(p, { recursive: true, force: true })));
});
async function fixture({ render = async () => ({ bytes: bytes() }), light = () => LIGHT } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-bake-'));
  folders.push(dir);
  const rigFile = path.join(dir, 'rig.json');
  await fs.writeFile(rigFile, JSON.stringify(rig));
  const records = new Map([['a', look()]]);
  const copy = (v) => v && structuredClone(v);
  const looks = {
    get: (id) => copy(records.get(id)),
    list: (fn) => [...records.values()].filter(fn).map(copy),
    update(id, patch) {
      if (!records.has(id)) return null;
      records.set(id, { ...records.get(id), ...copy(patch) });
      return looks.get(id);
    },
  };
  let renders = 0;
  const box = { config: { seconds: 10 }, probe: async () => ({ ok: true }),
    render: async (job) => { renders++; return render(job); } };
  const queue = createBakeQueue({ store: { looks }, box, framesDir: dir, rigFile, flash, loadLight: light,
    log: { info() {}, error() {} } });
  const bake = async () => { await queue.request('a'); await queue.idle(); return looks.get('a').bake; };
  return { dir, records, looks, queue, bake, renders: () => renders };
}

test('rebakes, adoption and restore analyse reused bytes with current light and flash settings (H1)', async () => {
  let gamma = 3;
  const f = await fixture({ render: async () => ({ bytes: bytes({ strobe: true }) }),
    light: () => ({ ...LIGHT, gamma }) });
  assert.equal((await f.bake()).ok, true);
  gamma = 1;
  f.records.set('b', look('b'));
  assert.equal((await f.queue.request('b')).ok, false, 'adoption refreshes the flash check');
  assert.equal((await f.bake()).ok, false, 'same-look cache refreshes the flash check');
  gamma = 3;
  await fs.rm(path.join(f.dir, 'a.fseq'));
  assert.equal(await f.queue.restore('a'), true);
  assert.equal(f.looks.get('a').bake.ok, true, 'restore from another look refreshes the flash check');
  flash.check = false;
  gamma = 1;
  try { assert.equal((await f.bake()).ok, true, 'changed flash settings apply to reused bytes'); }
  finally { flash.check = true; }
  assert.equal(f.renders(), 1);
});

test('an edit during frame storage cannot attach an obsolete record (H2)', async () => {
  const f = await fixture();
  const rename = fs.rename.bind(fs);
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    await rename(from, to);
    if (to === path.join(f.dir, 'a.fseq')) f.looks.update('a', { duration: 4 });
  });
  const b = await f.bake();
  assert.notEqual(b.status, 'done');
  assert.ok(reviewBlocker(f.looks.get('a')));
});

test('review requires the current baked length, including the configured cap (H2)', () => {
  const l = look();
  l.bake = { source: 'render-box', status: 'done', ok: true, layersHash: layersHash(renderFields(l)), seconds };
  assert.equal(reviewBlocker(l), '');
  assert.match(reviewBlocker({ ...l, duration: 4 }), /length/);
  assert.equal(reviewBlocker({ ...l, duration: 100 }, { seconds }), '');
});

test('tempo dependencies include nested composite modules and bracket reads (H3)', () => {
  for (const module of [
    { code: 'function pixel(p,t,P,G) { return G.bpm / 240; }' },
    { code: 'function pixel(p,t,P,G) { return G["bpm"] / 240; }' },
    { code: "function pixel(p,t,P,G) { return G /* tempo */ ['bpm'] / 240; }" },
    { code: "function pixel(p,t,P,G) { return G['bpm'] / 240; }" },
    { params: { speed: { mod: 'lfo', unit: 'beats' } } },
  ]) {
    for (const depth of [0, 1, 2]) {
      let modules = [module];
      for (let i = 0; i < depth; i++) modules = [{ kind: 'composite', layers: [{ modules }] }];
      const a = { layers: [{ modules }], bpm: 60 }, b = { ...a, bpm: 120 };
      assert.notEqual(layersHash(renderFields(a)), layersHash(renderFields(b)));
      assert.notEqual(renderKey(a, seconds), renderKey(b, seconds));
    }
  }
});

test('palette-only G code retains its existing hash and ignores tempo edits', () => {
  const code = 'function pixel(p,t,P,G) { return G.palette.body[0]; }';
  for (const layers of [[{ code }], [{ modules: [{ kind: 'composite', layers: [{ modules: [{ code }] }] }] }]]) {
    const a = { layers, bpm: 60 }, b = { ...a, bpm: 120 };
    assert.equal(renderFields(a), layers);
    assert.equal(layersHash(renderFields(a)), layersHash(layers));
    assert.equal(renderKey(a, seconds), renderKey(b, seconds));
  }
});

test('a box reporting layer errors cannot pass, even with ok:true or a flash override (M5)', async () => {
  const f = await fixture({ render: async () => ({ bytes: bytes({ strobe: true }),
    boxStats: cleanBoxStats({ ok: true, layers: [{ id: 'x', errorFrames: 120, firstError: 'broken' }] }) }) });
  const b = await f.bake();
  assert.equal(b.ok, false);
  assert.equal(b.status, 'failed');
  assert.match(reviewBlocker(f.looks.get('a'), { override: 'approved' }), /failed/);
  assert.equal(checkFrames(bytes(), { source: 'render-box', rig, seconds,
    boxStats: cleanBoxStats({ ok: false }) }).bake.ok, true, 'the box cannot decide the trusted result');
});

test('structurally valid frames must match requested count, step and all channels (M6)', () => {
  for (const shape of [{ frames: 1 }, { stepMs: 255 }, { ranges: [[0, 29]] }]) {
    const out = checkFrames(bytes(shape), { source: 'render-box', rig, seconds });
    assert.equal(out.bake.ok, false);
    assert.equal(out.bake.status, 'failed');
    assert.equal(out.frames, undefined);
  }
});
