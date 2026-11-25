// Library only (spec/frames "Library only"): no setting, file or route turns it off; a look saves only library
// modules, composites included.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { signup } from './fixtures/app.js';
import { EMBERS as LIBRARY, fx, startApp, useFixture } from './fixtures/server.js';

useFixture();
const NEW = 'function pixel(p) { return [1, 0, 0]; }';
/** A module naming `ref` (none when undefined). */
const mod = (ref, extra = {}) => ({ id: 'm1', kind: 'source', title: 'Mine', ...(ref ? { ref } : {}), params: {},
  ...extra });
const modules = (ref, extra) => [{ id: 'l1', title: 'Sea', modules: [mod(ref, extra)] }];
/** A composite, carrying `own` code when given, over a sub-layer naming `inner`. */
const comp = (inner, own) => [{ id: 'l1', title: 'Sea', modules: [{ id: 'k', kind: 'composite', title: 'Comp',
  ...(own ? { code: own } : {}), params: {}, layers: [{ id: 's1', title: 'Sub',
    modules: [mod(inner, { title: 'Inner' })] }] }] }];

describe('as the server runs (no test options; the data and environment asking for them)', () => {
  let app, admin, ann;
  beforeAll(async () => {
    const dataDir = path.join(fx.tmp, 'data-code');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(dataDir, 'baking.json'), JSON.stringify({ mode: 'on', customCode: true }));
    app = await startApp({ dataDir, admins: 'Olive' });
    [admin, ann] = [await signup(app, 'Olive'), await signup(app, 'ann')];
  });
  afterAll(() => app?.close());

  test('no AI: its routes are not there, and /api/me has no access', async () => {
    assert.equal((await ann.get('/api/me')).json.access, undefined);
    for (const [method, url] of [['get', '/api/ideas'], ['post', '/api/ideas'], ['get', '/api/models'],
      ['get', '/api/admin/models'], ['get', '/api/admin/people']]) {
      assert.equal((await admin[method](url, method === 'post' ? { text: 'a glow' } : undefined)).status, 404, url);
    }
  });

  test('baking.json\'s old customCode is ignored, and the bake setting has no such key', async () => {
    assert.equal('customCode' in (await ann.get('/api/baking')).json, false);
    assert.equal((await ann.put('/api/admin/baking', { mode: 'on' })).status, 403);
    assert.equal((await admin.put('/api/admin/baking', { mode: 'on', customCode: true })).status, 400);
    assert.equal((await admin.put('/api/admin/baking', { mode: 'throttled' })).json.mode, 'throttled');
  });

  test('a module plays its ref, whatever code it carries; one naming none is refused (400), and a ref the library '
    + 'lacks (403)', async () => {
    let r = await ann.post('/api/looks', { title: 'New', layers: modules(undefined, { code: NEW }) });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'Layer 1, module 1: ref must name a library entry.');
    r = await ann.post('/api/looks', { title: 'Old shape', layers: [{ id: 'l1', ref: 'embers', code: LIBRARY }] });
    assert.equal(r.status, 400, 'a layer of its own code, without modules');
    r = await ann.post('/api/looks', { title: 'Gone', layers: modules('gone') });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'Layer 1 (Sea)\'s Mine names gone, which the library does not have.');
    r = await ann.post('/api/looks', { title: 'Named', layers: modules('embers', { code: NEW }), shared: true });
    assert.equal(r.status, 201, 'naming a library module, it is that module');
    assert.equal(r.json.look.layers[0].modules[0].code, LIBRARY);
    const embers = r.json.look.id;
    r = await ann.post('/api/looks', { origin: embers, title: 'Embers', layers: modules('gone') });
    assert.equal(r.status, 403, 'an import overruling a look is checked as an edit is');
    const old = app.store.looks.create({ owner: ann.user.id, title: 'Old', layers: modules('gone'), versions: [] });
    assert.equal((await ann.put(`/api/looks/${old.id}`, { duration: 30 })).status, 403, 'no change');
    assert.equal((await ann.put(`/api/looks/${old.id}`, { layers: modules('embers') })).status, 200, 'but a repair');
  });

  test('a composite\'s sub-layers are checked as a layer\'s modules are; code on it is ignored', async () => {
    let r = await ann.post('/api/looks', { title: 'Grouped', layers: comp('embers') });
    assert.equal(r.status, 201, r.text);
    const grouped = r.json.look.id;
    r = await ann.post('/api/looks', { origin: grouped, title: 'Grouped', layers: comp('embers') });
    assert.ok([200, 201].includes(r.status), `an import: ${r.text}`);
    r = await ann.post('/api/looks', { title: 'Sneaky', layers: comp('gone') });
    assert.equal(r.status, 403);
    assert.match(r.json.error, /Layer 1 \(Sea\)'s Inner names gone/);
    r = await ann.put(`/api/looks/${grouped}`, { layers: comp('gone') });
    assert.equal(r.status, 403, 'an edit putting an unknown ref in a composite too');
    r = await ann.post('/api/looks', { title: 'Coded', layers: comp('embers', NEW) });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.look.layers[0].modules[0].code, undefined, 'its code is not kept');
  });
});
