// How the render box runs here (SPEC "Baked frames"): library only where bubblewrap is missing, and the admin's bake
// setting (on, throttled, off) in front of it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { createBakingStore, governBox, THROTTLE } from '../src/baking.ts';
import { customCode, libraryHashes } from '../src/box-library.ts';
import { BakeError } from '../src/box-output.ts';
import { parseFseq } from '../src/frames.ts';
import { createRenderBox } from '../src/render-box.ts';
import { fakeBox, fx, layer, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const PATTERNS = path.join(PUBLIC, 'patterns');
const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
const source = (name) => fs.readFileSync(path.join(PATTERNS, `${name}.js`), 'utf8');
const WASH = source('colour-wash'), BARS = source('bars');
const libLayer = (code, extra = {}) => ({ id: 'l1', title: 'Wash', code, params: {}, groups: [], blend: 'add',
  level: 1, ...extra });

describe('library only', () => {
  test('a look whose every layer and module is a library file, unchanged, passes; anything else names itself',
    async () => {
    const lib = await libraryHashes(PATTERNS);
    assert.ok(lib.size > 20);
    assert.equal(customCode([libLayer(WASH), { title: 'Chain', modules: [{ code: BARS }, { code: WASH }] }], lib), '');
    assert.equal(customCode([libLayer(WASH), libLayer(`${WASH} `, { title: 'Sea' })], lib),
      'This server bakes without bubblewrap, so only looks made of unchanged library patterns; Layer 2 (Sea) is '
      + 'custom code.');
    assert.match(customCode([{ title: 'Chain', modules: [{ code: BARS }, { title: 'Glow', code: 'x' }] }], lib),
      /Layer 1 \(Chain\)'s Glow is custom code\.$/);
    assert.match(customCode([{ title: '' }], lib), /Layer 1 is custom code/, 'no code at all is not library code');
    assert.equal((await libraryHashes(path.join(fx.tmp, 'none'))).size, 0, 'no library: nothing passes');
  });

  const prlimit = ['/usr/bin', '/bin'].some((d) => fs.existsSync(path.join(d, 'prlimit')));
  const built = fs.existsSync(path.join(PUBLIC, 'data/rig.json'));
  test('without bubblewrap, a library look bakes as its own process and custom code is refused', async ({ skip }) => {
    skip(!prlimit || !built, 'needs prlimit and a built rig.json');
    const box = createRenderBox({ bwrap: 'no-such-bwrap', seconds: 1, systemdRun: '', log: quiet });
    const p = await box.probe();
    assert.equal(p.ok, true);
    assert.match(p.libraryOnly, /^Bubblewrap \(bwrap\) is not installed, so this server bakes only looks made of /);
    assert.equal(await box.refuses([libLayer(WASH)]), '');
    assert.match(await box.refuses([libLayer('function pixel() { return [1, 1, 1]; }')]), /Layer 1 \(Wash\) is custom/);
    const r = await box.render({ layers: [libLayer(WASH, { groups: ['cathedral'] })] });
    assert.equal(r.seconds, 1);
    assert.equal(parseFseq(r.bytes, { maxBytes: 64 * 1024 ** 2, maxChannels: 1e6 }).frameCount, 40);
    await assert.rejects(box.render({ layers: [libLayer(`${WASH}\n// edited`)] }),
      (err) => err instanceof BakeError && err.status === 422 && /custom code/.test(err.reason));
  });

  test('bubblewrap stays the first choice where it runs', async ({ skip }) => {
    const box = createRenderBox({ log: quiet }), p = await box.probe();
    skip(!p.ok || !!p.libraryOnly, `bubblewrap unavailable here: ${p.reason || p.libraryOnly}`);
    assert.equal(p.libraryOnly, undefined);
    assert.equal(await box.refuses([libLayer('function pixel() { return [1, 1, 1]; }')]), '');
  });
});

describe('the bake setting', () => {
  test('stored in baking.json: missing or broken is on, a save is checked and read back', () => {
    const file = path.join(fx.tmp, 'setting', 'baking.json');
    const store = createBakingStore({ file, log: quiet });
    assert.equal(store.mode(), 'on');
    assert.match(store.save({ mode: 'slow' }).error, /on, throttled or off/);
    assert.deepEqual(store.save({ mode: 'off' }), { mode: 'off' });
    assert.equal(createBakingStore({ file, log: quiet }).mode(), 'off', 'from the file');
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
    assert.deepEqual(await gov.refusal([]), { status: 503, reason: 'An admin turned baking off.' });
    mode = 'on';
    box.refuses = async () => 'custom';
    assert.deepEqual(await gov.refusal([]), { status: 422, reason: 'custom' });
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
    assert.deepEqual((await member.get('/api/baking')).json, { mode: 'on', box: { ok: true, libraryOnly: false } });
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

  test('a library-only box refuses custom code at the request, and says so', async () => {
    box.probe = async () => ({ ok: true, libraryOnly: 'Bubblewrap (bwrap) is not installed, so …' });
    box.refuses = async () => 'This server bakes without bubblewrap, so only … Layer 1 (Sea) is custom code.';
    try {
      assert.equal((await member.get('/api/baking')).json.box.libraryOnly, true);
      // Not a render baked above, so no stored bake is taken.
      const look = (await member.post('/api/looks', { title: 'y', layers: [layer({ level: 0.5 })] })).json.look;
      const r = await member.post(`/api/looks/${look.id}/bake`);
      assert.equal(r.status, 422);
      assert.match(r.json.error, /Layer 1 \(Sea\) is custom code/);
    } finally {
      box.probe = async () => ({ ok: true });
      delete box.refuses;
    }
  });
});
