// How the render box runs here (SPEC "Baked frames"): its own process under limits, what saves (library only), and
// the admin's bake setting (on, throttled, off) in front of it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { createBakingStore, governBox, THROTTLE } from '../src/baking.ts';
import { parseFseq } from '../src/frames.ts';
import { customCode, libraryHashes } from '../src/library-gate.ts';
import { createRenderBox } from '../src/render-box.ts';
import { signup } from './fixtures/app.js';
import { fakeBox } from './fixtures/box.js';
import { fx, layer, startApp, useFixture } from './fixtures/server.js';
import { quiet } from './fixtures/quiet.js';

useFixture();
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const PATTERNS = path.join(PUBLIC, 'patterns');
const source = (name) => fs.readFileSync(path.join(PATTERNS, `${name}.js`), 'utf8');
const WASH = source('colour-wash'), BARS = source('bars');
const comp = (layers) => ({ id: 'k', kind: 'composite', title: 'Comp', code: '', params: {}, layers });
const COMPOSED = { id: 'l2', title: 'Mix', groups: ['cathedral'], blend: 'add', level: 1, modules: [comp([
  { id: 's1', title: 'Wash', modules: [{ id: 'a', kind: 'source', title: 'Wash', code: WASH }] },
  { id: 's2', title: 'Bars', modules: [{ id: 'b', kind: 'source', title: 'Bars', code: BARS }] }])] };
const libLayer = (code, extra = {}) => ({ id: 'l1', title: 'Wash', code, params: {}, groups: [], blend: 'add',
  level: 1, ...extra });

describe('library only', () => {
  test('a look whose every layer and module is a library file, unchanged, passes; anything else names itself',
    async () => {
    const lib = await libraryHashes(PATTERNS);
    assert.ok(lib.size > 20);
    assert.equal(customCode([libLayer(WASH), { title: 'Chain', modules: [{ code: BARS }, { code: WASH }] }], lib), '');
    assert.equal(customCode([libLayer(WASH), libLayer(`${WASH} `, { title: 'Sea' })], lib),
      'Only looks made of unchanged library patterns save; Layer 2 (Sea) is custom code.');
    assert.match(customCode([{ title: 'Chain', modules: [{ code: BARS }, { title: 'Glow', code: 'x' }] }], lib),
      /Layer 1 \(Chain\)'s Glow is custom code\.$/);
    assert.match(customCode([{ title: '' }], lib), /Layer 1 is custom code/, 'no code at all is not library code');
    assert.equal(customCode([COMPOSED], lib), '', 'a composite has no code of its own; its sub-layers\' is library');
    const inner = { ...COMPOSED, modules: [comp([{ id: 's1', modules: [{ title: 'Glow', code: 'x' }] }])] };
    assert.match(customCode([inner], lib), /Layer 1 \(Mix\)'s Glow is custom code\.$/);
    assert.match(customCode([{ ...COMPOSED, modules: [{ ...comp([]), code: 'x' }] }], lib), /Layer 1 \(Mix\)'s Comp/,
      'a composite with code of its own is custom');
    assert.match(customCode([{ ...COMPOSED, modules: [{ ...COMPOSED.modules[0], code: WASH }] }], lib),
      /Layer 1 \(Mix\)'s Comp/, 'even library code on a composite, whose sub-layers would go unchecked');
    assert.equal((await libraryHashes(path.join(fx.tmp, 'none'))).size, 0, 'no library: nothing passes');
  });

  const prlimit = ['/usr/bin', '/bin'].some((d) => fs.existsSync(path.join(d, 'prlimit')));
  const built = fs.existsSync(path.join(PUBLIC, 'data/rig-folly.json'));
  test('a full 600 s look bakes; a shorter cap wins', async ({ skip }) => {
    skip(!prlimit, 'needs prlimit');
    // Length does not depend on the installation's pixel count: the real box and all 600 s, on a small rig.
    const rig = JSON.parse(fs.readFileSync(new URL('./fixtures/rigs/mini.json', import.meta.url), 'utf8'));
    rig.output.fps = 40; // FSEQ's integer millisecond step represents 25 ms frames exactly.
    const rigFile = path.join(fx.tmp, 'long-rig.json');
    fs.writeFileSync(rigFile, JSON.stringify(rig));
    const options = { rigFile, systemdRun: '', nice: 0, log: quiet };
    const box = createRenderBox({ seconds: 600, ...options });
    const job = { layers: [libLayer(WASH, { groups: ['all'],
      clips: [{ start: 590, end: 600 }] })], seconds: 600 };
    const r = await box.render(job);
    const parsed = parseFseq(r.bytes, { maxBytes: box.config.maxFramesBytes, maxChannels: 1e6 });
    assert.equal(parsed.frameCount, 600 * rig.output.fps);
    const capped = createRenderBox({ seconds: 1, ...options });
    assert.equal(parseFseq((await capped.render(job)).bytes).frameCount, rig.output.fps);
  }, 120_000);

  test('a library look bakes as its own process, the same bytes each time', async ({ skip }) => {
    skip(!prlimit || !built, 'needs prlimit and a built rig-folly.json');
    const box = createRenderBox({ seconds: 1, systemdRun: '', log: quiet });
    assert.deepEqual(await box.probe(), { ok: true });
    const r = await box.render({ layers: [libLayer(WASH, { groups: ['cathedral'] }), COMPOSED] });
    assert.equal(r.seconds, 1);
    assert.equal(parseFseq(r.bytes, { maxBytes: 64 * 1024 ** 2, maxChannels: 1e6 }).frameCount, 40);
    const again = await box.render({ layers: [libLayer(WASH, { groups: ['cathedral'] }), COMPOSED] });
    assert.deepEqual(again.bytes, r.bytes, 'identical rebakes have stable FSEQ identifiers (M17)');
  });
  test('without prlimit there is no box, and it says why', async () => {
    const p = await createRenderBox({ prlimit: 'no-such-prlimit', systemdRun: '', log: quiet }).probe();
    assert.equal(p.ok, false);
    assert.match(p.reason, /prlimit \(util-linux\) is not installed/);
  });
});

describe('the bake setting', () => {
  test('stored in baking.json: missing or broken is on, a save is checked and read back, other keys ignored',
    async () => {
    const file = path.join(fx.tmp, 'setting', 'baking.json');
    const store = createBakingStore({ file, log: quiet });
    assert.equal(store.mode(), 'on');
    assert.match((await store.save({ mode: 'slow' })).error, /on, throttled or off/);
    assert.match((await store.save({})).error, /must be \{ mode \}|on, throttled or off/);
    assert.ok((await store.save({ mode: 'on', customCode: true })).error, 'no other keys');
    assert.deepEqual(await store.save({ mode: 'off' }), { mode: 'off' });
    assert.equal(createBakingStore({ file, log: quiet }).mode(), 'off', 'from the file');
    fs.writeFileSync(file, JSON.stringify({ mode: 'throttled', customCode: true }));
    assert.deepEqual(createBakingStore({ file, log: quiet }).current(), { mode: 'throttled' }, 'an old file\'s keys');
    fs.writeFileSync(file, '{ not json');
    assert.equal(createBakingStore({ file, log: quiet }).mode(), 'on');
  });

  test('off refuses; throttled renders at nice 19, a cooldown after the last; on passes the job as it is',
    async () => {
    let mode = 'on', clock = 0;
    const jobs = [];
    const box = { probe: async () => ({ ok: true }), refuses: async () => '', render: async (job) => {
      jobs.push(job);
      return { bytes: new Uint8Array(0) };
    } };
    const gov = governBox(box, () => mode, { cooldownMs: 50, now: () => clock });
    await gov.render({ layers: [] });
    assert.deepEqual(jobs.at(-1), { layers: [] });
    mode = 'throttled';
    let ready = false;
    const waiting = gov.ready().then(() => { ready = true; });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ready, false, 'within the cooldown');
    clock = 50;
    await waiting;
    await gov.render({ layers: [] });
    assert.equal(jobs.at(-1).nice, THROTTLE.nice);
    mode = 'off';
    await assert.rejects(gov.render({ layers: [] }), (err) => err.status === 503 && /admin turned baking off/.test(
      err.reason));
    assert.deepEqual(await gov.refusal(), { status: 503, reason: 'An admin turned baking off.' });
    mode = 'on';
    assert.equal(await gov.refusal(), null);
    assert.equal(jobs.length, 2);
  });
});

describe('through the API', () => {
  let app, admin, member;
  const box = fakeBox();
  beforeAll(async () => {
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-baking'), admins: 'Olive', renderBox: box });
    admin = await signup(app, 'olive');
    member = await signup(app, 'morgan');
  });
  afterAll(() => app.close());

  test('everyone reads the setting; only admins change it, and it applies at once', async () => {
    assert.deepEqual((await member.get('/api/baking')).json, { mode: 'on', box: { ok: true } });
    assert.equal((await member.put('/api/admin/baking', { mode: 'off' })).status, 403);
    assert.equal((await admin.put('/api/admin/baking', { mode: 'sometimes' })).status, 400);
    assert.equal((await admin.put('/api/admin/baking', { mode: 'off' })).json.mode, 'off');
    const look = (await member.post('/api/looks', { title: 'x', layers: [layer()] })).json.look;
    const r = await member.post(`/api/looks/${look.id}/bake`);
    assert.equal(r.status, 503);
    assert.equal(r.json.error, 'An admin turned baking off.');
    assert.equal(box.renders, 0);
    assert.equal((await admin.put('/api/admin/baking', { mode: 'on' })).json.mode, 'on');
    assert.equal((await member.post(`/api/looks/${look.id}/bake`)).status, 202);
    await app.bakes.idle();
    assert.equal(box.renders, 1);
  });
});
