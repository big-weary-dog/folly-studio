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
import { boxDefaults } from '../src/profile.ts';
import { loadBaked } from '../pi/src/baked.ts';
import { prepareScene } from '../public/js/pattern-core.ts';
import { fakeBox, fx, layer, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const PATTERNS = path.join(PUBLIC, 'patterns');
const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
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
      'This server bakes without bubblewrap, so only looks made of unchanged library patterns; Layer 2 (Sea) is '
      + 'custom code.');
    assert.match(customCode([{ title: 'Chain', modules: [{ code: BARS }, { title: 'Glow', code: 'x' }] }], lib),
      /Layer 1 \(Chain\)'s Glow is custom code\.$/);
    assert.match(customCode([{ title: '' }], lib), /Layer 1 is custom code/, 'no code at all is not library code');
    assert.equal(customCode([COMPOSED], lib), '', 'a composite has no code of its own; its sub-layers\' is library');
    const inner = { ...COMPOSED, modules: [comp([{ id: 's1', modules: [{ title: 'Glow', code: 'x' }] }])] };
    assert.match(customCode([inner], lib), /Layer 1 \(Mix\)'s Glow is custom code\.$/);
    assert.match(customCode([{ ...COMPOSED, modules: [{ ...comp([]), code: 'x' }] }], lib), /Layer 1 \(Mix\)'s Comp/,
      'a composite with code of its own is custom');
    assert.equal((await libraryHashes(path.join(fx.tmp, 'none'))).size, 0, 'no library: nothing passes');
  });

  const prlimit = ['/usr/bin', '/bin'].some((d) => fs.existsSync(path.join(d, 'prlimit')));
  const built = fs.existsSync(path.join(PUBLIC, 'data/rig.json'));
  test('Pi defaults bake and play a full 600 s look; explicit caps still win', async ({ skip }) => {
    skip(!prlimit, 'needs prlimit');
    // Length and late clips do not depend on the installation's pixel count. Keep the real box and all 600 s,
    // but avoid rendering and hashing hundreds of MB just to check its header and file-backed playback.
    const rig = JSON.parse(fs.readFileSync(new URL('./fixtures/rigs/mini.json', import.meta.url), 'utf8'));
    rig.output.fps = 40; // FSEQ's integer millisecond step represents the Pi's 25 ms frames exactly.
    const rigFile = path.join(fx.tmp, 'long-rig.json');
    fs.writeFileSync(rigFile, JSON.stringify(rig));
    const options = { rigFile, bwrap: 'no-such-bwrap', systemdRun: '', log: quiet };
    const box = createRenderBox({ ...boxDefaults('pi', {}), ...options });
    const job = { layers: [libLayer(WASH, { groups: ['all'],
      clips: [{ start: 590, end: 600 }] })], seconds: 600 };
    const r = await box.render(job);
    const parsed = parseFseq(r.bytes, { maxBytes: box.config.maxFramesBytes, maxChannels: 1e6 });
    assert.equal(parsed.frameCount, 600 * rig.output.fps);
    const file = path.join(fx.tmp, 'long.fseq');
    fs.writeFileSync(file, r.bytes);
    const { createHash } = await import('node:crypto');
    const b = await loadBaked(fx.tmp, 'long', createHash('sha256').update(r.bytes).digest('hex'), prepareScene(rig));
    const rgb = new Float32Array(rig.count * 3);
    b.fill(595 * rig.output.fps, rgb);
    assert.ok(rgb.some((v) => v > 0), 'the clip after 120 s reaches the lights');
    b.fill(600 * rig.output.fps, rgb);
    assert.ok(rgb.every((v) => v === 0));
    b.fill(1195 * rig.output.fps, rgb);
    assert.ok(rgb.some((v) => v > 0), 'playback loops to the late clip');
    b.close();
    fs.rmSync(file);
    const capped = createRenderBox({ ...boxDefaults('pi', { STUDIO_BAKE_SECONDS: 1 }),
      ...options });
    assert.equal(parseFseq((await capped.render(job)).bytes).frameCount, rig.output.fps);
  }, 120_000);

  test('without bubblewrap, a library look bakes as its own process and custom code is refused', async ({ skip }) => {
    skip(!prlimit || !built, 'needs prlimit and a built rig.json');
    const box = createRenderBox({ bwrap: 'no-such-bwrap', seconds: 1, systemdRun: '', log: quiet });
    const p = await box.probe();
    assert.equal(p.ok, true);
    assert.match(p.libraryOnly, /^Bubblewrap \(bwrap\) is not installed, so this server bakes only looks made of /);
    assert.equal(await box.refuses([libLayer(WASH)]), '');
    assert.match(await box.refuses([libLayer('function pixel() { return [1, 1, 1]; }')]), /Layer 1 \(Wash\) is custom/);
    const r = await box.render({ layers: [libLayer(WASH, { groups: ['cathedral'] }), COMPOSED] });
    assert.equal(r.seconds, 1);
    assert.equal(parseFseq(r.bytes, { maxBytes: 64 * 1024 ** 2, maxChannels: 1e6 }).frameCount, 40);
    const again = await box.render({ layers: [libLayer(WASH, { groups: ['cathedral'] }), COMPOSED] });
    assert.deepEqual(again.bytes, r.bytes, 'identical rebakes have stable FSEQ identifiers (M17)');
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
  test('stored in baking.json: missing or broken is on with custom code off, a save is checked and read back', () => {
    const file = path.join(fx.tmp, 'setting', 'baking.json');
    const store = createBakingStore({ file, log: quiet });
    assert.equal(store.mode(), 'on');
    assert.match(store.save({ mode: 'slow' }).error, /on, throttled or off/);
    assert.equal(store.customCode(), false);
    assert.match(store.save({}).error, /mode\?, customCode\?/);
    assert.match(store.save({ customCode: 'yes' }).error, /true or false/);
    assert.deepEqual(store.save({ mode: 'off' }), { mode: 'off', customCode: false });
    assert.deepEqual(store.save({ customCode: true }), { mode: 'off', customCode: true }, 'one changes, one is kept');
    assert.equal(createBakingStore({ file, log: quiet }).mode(), 'off', 'from the file');
    fs.writeFileSync(file, '{ not json');
    assert.equal(createBakingStore({ file, log: quiet }).mode(), 'on');
    assert.equal(createBakingStore({ file, log: quiet }).customCode(), false);
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
    assert.deepEqual((await member.get('/api/baking')).json, { mode: 'on', customCode: true,
      box: { ok: true, libraryOnly: false } });
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
