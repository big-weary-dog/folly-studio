// Library only (SPEC-baking "Library only"): no setting, file or route turns it off; a look saves only library
// modules, composites included.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { EMBERS as LIBRARY, fx, layer, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const NEW = 'function pixel(p) { return [1, 0, 0]; }';
const mod = (code, extra = {}) => ({ id: 'm1', kind: 'source', title: 'Mine', code, params: {}, ...extra });
const modules = (code, extra) => [{ id: 'l1', title: 'Sea', modules: [mod(code, extra)] }];
/** A composite carrying `own` code over a sub-layer of `inner`. */
const comp = (inner, own = '') => [{ id: 'l1', title: 'Sea', modules: [{ id: 'k', kind: 'composite', title: 'Comp',
  code: own, params: {}, layers: [{ id: 's1', title: 'Sub', modules: [mod(inner, { title: 'Inner' })] }] }] }];

describe('as the server runs (no test options; the data and environment asking for them)', () => {
  let app, admin, ann, bob;
  beforeAll(async () => {
    const dataDir = path.join(fx.tmp, 'data-code');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(path.join(dataDir, 'baking.json'), JSON.stringify({ mode: 'on', customCode: true }));
    app = await startApp({ dataDir, admins: 'Olive' });
    [admin, ann, bob] = [await signup(app, 'Olive'), await signup(app, 'ann'), await signup(app, 'bob')];
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

  test('custom code is refused (403, naming it); a library file exactly is not', async () => {
    let r = await ann.post('/api/looks', { title: 'New', layers: modules(NEW) });
    assert.equal(r.status, 403);
    assert.match(r.json.error, /unchanged library patterns.*Layer 1 \(Sea\)'s Mine is custom code/);
    r = await ann.post('/api/looks', { title: 'Old shape', layers: [layer({ code: NEW })] });
    assert.equal(r.status, 403, 'a layer\'s own code too');
    r = await ann.post('/api/looks', { title: 'Embers', layers: modules(LIBRARY, { ref: 'embers' }), shared: true });
    assert.equal(r.status, 201);
    const embers = r.json.look.id;
    r = await ann.put(`/api/looks/${embers}`, { layers: modules(`${LIBRARY} `) });
    assert.equal(r.status, 403, 'an edit of library code is custom');
    r = await ann.post('/api/looks', { origin: embers, title: 'Embers', layers: modules(NEW) });
    assert.equal(r.status, 403, 'an import overruling a look is checked as an edit is');
    r = await bob.post('/api/looks', { title: 'Copy', layers: modules(LIBRARY) });
    assert.equal(r.status, 201, 'a copy of library code');
    const old = app.store.looks.create({ owner: ann.user.id, title: 'Old', layers: modules(NEW), versions: [] });
    assert.equal((await ann.put(`/api/looks/${old.id}`, { duration: 30 })).status, 403, 'no change');
    assert.equal((await ann.put(`/api/looks/${old.id}`, { layers: modules(LIBRARY) })).status, 200, 'but a repair');
  });

  test('a composite has no code of its own: library sub-layers save; custom ones, or code on it, are refused',
    async () => {
    let r = await ann.post('/api/looks', { title: 'Grouped', layers: comp(LIBRARY) });
    assert.equal(r.status, 201, r.text);
    const grouped = r.json.look.id;
    r = await ann.post('/api/looks', { origin: grouped, title: 'Grouped', layers: comp(LIBRARY) });
    assert.ok([200, 201].includes(r.status), `an import: ${r.text}`);
    r = await ann.post('/api/looks', { title: 'Sneaky', layers: comp(NEW) });
    assert.equal(r.status, 403);
    assert.match(r.json.error, /Layer 1 \(Sea\)'s Inner is custom code/);
    r = await ann.put(`/api/looks/${grouped}`, { layers: comp(NEW) });
    assert.equal(r.status, 403, 'an edit putting custom code in a composite too');
    r = await ann.post('/api/looks', { title: 'Cloaked', layers: comp(NEW, LIBRARY) });
    assert.equal(r.status, 403, 'library code on the composite does not hide its sub-layers');
    r = await ann.post('/api/looks', { title: 'Coded', layers: comp(LIBRARY, LIBRARY) });
    assert.equal(r.status, 403, 'nor is code of its own allowed, library or not');
  });
});
