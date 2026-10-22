// The Custom code switch (SPEC-baking "Custom code"): off, a look takes only library code and code already in looks
// its owner can see; the generators' rounds see new code as an error; the switch is the admins'.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { createServer } from '../src/app.ts';
import { codesOf, createCodeGate } from '../src/custom-code.ts';
import { expand } from '../src/generate/expand.ts';
import { createQueue } from '../src/generate/index.ts';
import { libraryOnly } from '../src/generate/no-code.ts';
import { fx, layer, PIXEL, quiet, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const LIBRARY = `// Rising embers\n${PIXEL}\n`;   // the fixture library's embers.js
const NEW = 'function pixel(p) { return [1, 0, 0]; }';
const mod = (code, extra = {}) => ({ id: 'm1', kind: 'source', title: 'Mine', code, params: {}, ...extra });

test('codesOf finds every piece of code: a layer\'s own, its modules\', its composites\' sub-layers\'', () => {
  const layers = [{ title: 'Old', code: 'A' }, { modules: [mod('B'), { id: 'c', kind: 'composite', layers: [
    { modules: [mod('C', { title: 'Deep' })] }] }] }];
  assert.deepEqual([...codesOf(layers)], [{ code: 'A', where: 'Layer 1 (Old)' },
    { code: 'B', where: 'Layer 2\'s Mine' },
    { code: 'C', where: 'Layer 2\'s Deep' }]);
});

describe('the API, custom code off', () => {
  let app, admin, ann, bob;
  beforeAll(async () => {
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-code'), admins: 'Olive', customCode: false });
    admin = await signup(app, 'Olive');
    ann = await signup(app, 'ann');
    bob = await signup(app, 'bob');
  });
  afterAll(() => app?.close());
  const modules = (code, extra) => [{ id: 'l1', title: 'Sea', modules: [mod(code, extra)] }];

  test('only admins switch it, and everyone reads it', async () => {
    assert.equal((await ann.get('/api/baking')).json.customCode, false);
    assert.equal((await ann.put('/api/admin/baking', { customCode: true })).status, 403);
    assert.equal((await admin.put('/api/admin/baking', { customCode: true })).json.customCode, true);
    assert.equal((await ann.get('/api/baking')).json.customCode, true);
    assert.equal((await admin.put('/api/admin/baking', { customCode: false })).json.mode, 'on', 'the mode is kept');
  });

  test('new code is refused (403, naming it); a library file exactly is not', async () => {
    let r = await ann.post('/api/looks', { title: 'New', layers: modules(NEW) });
    assert.equal(r.status, 403);
    assert.match(r.json.error, /admin turned custom code off.*Layer 1 \(Sea\)'s Mine is new code/);
    r = await ann.post('/api/looks', { title: 'Old shape', layers: [layer()] });
    assert.equal(r.status, 403, 'a layer\'s own code too');
    r = await ann.post('/api/looks', { title: 'Embers', layers: modules(LIBRARY, { ref: 'embers' }) });
    assert.equal(r.status, 201);
    r = await ann.put(`/api/looks/${r.json.look.id}`, { layers: modules(`${LIBRARY} `) });
    assert.equal(r.status, 403, 'an edit of library code is new');
  });

  test('code already in a look its owner can see is kept: params, copies of shared looks; not others\' private ones',
    async () => {
    await admin.put('/api/admin/baking', { customCode: true });
    const mine = (await ann.post('/api/looks', { title: 'Mine', layers: modules(NEW) })).json.look;
    const shared = (await bob.post('/api/looks', { title: 'Shared', layers: modules(`${NEW}//b`), shared: true }))
      .json.look;
    const hidden = (await bob.post('/api/looks', { title: 'Hidden', layers: modules(`${NEW}//h`) })).json.look;
    await admin.put('/api/admin/baking', { customCode: false });
    let r = await ann.put(`/api/looks/${mine.id}`, { layers: modules(NEW, { params: { speed: 2 } }) });
    assert.equal(r.status, 200, r.text);
    r = await ann.post('/api/looks', { title: 'Copy', layers: modules(`${NEW}//b`) });
    assert.equal(r.status, 201, 'a shared look\'s code');
    r = await ann.post('/api/looks', { title: 'Peek', layers: modules(`${NEW}//h`) });
    assert.equal(r.status, 403, 'another\'s unshared look\'s code is new to ann');
    assert.equal((await bob.put(`/api/looks/${hidden.id}`, { title: 'Still mine' })).status, 200);
    assert.ok(shared.id);
  });
});

test('a generator\'s rounds: off, new code is an error the repair sees, and the turn says library only', async () => {
  const catalog = { modules: new Map(), presets: new Map(), text: '' };
  const answer = { title: 't', layers: [{ modules: [{ use: 'ext:glow' }] }, { code: NEW }],
    extensions: [{ name: 'glow', kind: 'source', summary: 's', why: 'w', code: NEW }] };
  assert.equal(expand(answer, catalog).errors.length, 0, 'anything goes while it is on');
  const looks = { list: () => [] };
  const off = createCodeGate({ on: () => false, looks, patternsDir: path.join(fx.publicDir, 'patterns') });
  const ctx = { text: 'a red glow', user: { id: 'u' } };
  const held = await libraryOnly(ctx, catalog, off);
  assert.match(ctx.turn, /<idea>\na red glow\n<\/idea>[\s\S]*compose from the library alone/);
  const x = expand(answer, held);
  assert.deepEqual(x.errors.filter((e) => e.code === 'no_code').map((e) => e.path),
    ['extensions[0].code', 'layers[1].code']);
  assert.equal(x.look.layers.length, 0, 'nothing new is left in the look');
  assert.equal(await libraryOnly(ctx, catalog, createCodeGate({ on: () => true, looks, patternsDir: '' })), catalog);
});

test('off, a generator\'s look with new code fails its idea, saying why; library code makes a look', async () => {
  const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
  const clouds = readFileSync(path.join(PUBLIC, 'patterns/clouds.js'), 'utf8');
  let code = NEW;
  const look = () => ({ title: 'Glow', summary: 's', layers: [{ title: 'Base', code }] });
  const adapters = { stub: { generate: async () => look() } };
  const box = { config: { seconds: 2 }, probe: async () => ({ ok: true }), render: assert.fail };
  const app = await createServer({ dataDir: path.join(fx.tmp, 'data-ideas'), publicDir: PUBLIC, renderBox: box,
    generator: (deps) => createQueue({ ...deps, adapterName: 'stub', adapters }), log: quiet });
  try {
    const idea = () => app.store.ideas.create({ owner: 'u1', text: 'a glow', status: 'queued', generator: 'stub' });
    const bad = idea();
    app.queue.enqueue(bad);
    await app.queue.idle();
    assert.equal(app.store.ideas.get(bad.id).status, 'failed');
    assert.match(app.store.ideas.get(bad.id).error, /custom code off.*Layer 1 \(Base\) is new code/);
    code = clouds;
    const good = idea();
    app.queue.enqueue(good);
    await app.queue.idle();
    assert.equal(app.store.ideas.get(good.id).status, 'ready');
  } finally {
    await app.close();
  }
});
