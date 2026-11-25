// Custom code is off (SPEC-baking "Custom code") and the generators with it (SPEC-offline "No generators"): no
// setting, file or route turns either on; a look saves and bakes only library code, composites included. The
// generators' rounds see new code as an error. `generators` and `customCode` are createServer's test-only options.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { createServer } from '../src/app.ts';
import { createCodeGate } from '../src/custom-code.ts';
import { expand } from '../src/generate/expand.ts';
import { createQueue } from '../src/generate/index.ts';
import { libraryOnly } from '../src/generate/no-code.ts';
import { fx, layer, PIXEL, quiet, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const LIBRARY = `// Rising embers\n${PIXEL}\n`;   // the fixture library's embers.js
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
    app = await startApp({ dataDir, admins: 'Olive', generators: undefined, customCode: undefined,
      models: { env: { STUDIO_PROFILE: 'hosted', STUDIO_GENERATOR: 'test', ANTHROPIC_API_KEY: 'k' } } });
    admin = await signup(app, 'Olive');
    ann = await signup(app, 'ann');
    bob = await signup(app, 'bob');
  });
  afterAll(() => app?.close());

  test('no generators: their routes are not there, and /api/me has no access', async () => {
    assert.equal((await ann.get('/api/me')).json.access, undefined);
    for (const [method, url] of [['get', '/api/ideas'], ['post', '/api/ideas'], ['get', '/api/models'],
      ['get', '/api/admin/models'], ['get', '/api/admin/people']]) {
      assert.equal((await admin[method](url, method === 'post' ? { text: 'a glow' } : undefined)).status, 404, url);
    }
  });

  test('custom code is off whatever baking.json says, and no admin turns it on', async () => {
    assert.equal((await ann.get('/api/baking')).json.customCode, false);
    assert.equal((await ann.put('/api/admin/baking', { customCode: true })).status, 403);
    const r = await admin.put('/api/admin/baking', { customCode: true });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Custom code is off on every server/);
    assert.equal((await admin.put('/api/admin/baking', { mode: 'on', customCode: false })).json.customCode, false);
    assert.equal((await ann.get('/api/baking')).json.customCode, false);
  });

  test('custom code is refused (403, naming it); a library file exactly is not', async () => {
    let r = await ann.post('/api/looks', { title: 'New', layers: modules(NEW) });
    assert.equal(r.status, 403);
    assert.match(r.json.error, /unchanged library patterns.*Layer 1 \(Sea\)'s Mine is custom code/);
    r = await ann.post('/api/looks', { title: 'Old shape', layers: [layer()] });
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
    assert.match(r.json.error, /Layer 1 \(Sea\)'s Comp is custom code/);
  });
});

test('a generator\'s rounds: off, new code is an error the repair sees, and the turn says library only', async () => {
  const catalog = { modules: new Map(), presets: new Map(), text: '' };
  const answer = { title: 't', layers: [{ modules: [{ use: 'ext:glow' }] }, { code: NEW }],
    extensions: [{ name: 'glow', kind: 'source', summary: 's', why: 'w', code: NEW }] };
  assert.equal(expand(answer, catalog).errors.length, 0, 'anything goes while it is on');
  const off = createCodeGate({ on: () => false, patternsDir: path.join(fx.publicDir, 'patterns') });
  const ctx = { text: 'a red glow', user: { id: 'u' } };
  const held = await libraryOnly(ctx, catalog, off);
  assert.match(ctx.turn, /<idea>\na red glow\n<\/idea>[\s\S]*compose from the library alone/);
  const x = expand(answer, held);
  assert.deepEqual(x.errors.filter((e) => e.code === 'no_code').map((e) => e.path),
    ['extensions[0].code', 'layers[1].code']);
  assert.equal(x.look.layers.length, 0, 'nothing new is left in the look');
  assert.equal(await libraryOnly(ctx, catalog, createCodeGate({ on: () => true, patternsDir: '' })), catalog);
});

test('off, a generator\'s look with new code fails its idea, saying why; library code makes a look', async () => {
  const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
  const clouds = readFileSync(path.join(PUBLIC, 'patterns/clouds.js'), 'utf8');
  let code = NEW;
  const look = () => ({ title: 'Glow', summary: 's', layers: [{ title: 'Base', code }] });
  const adapters = { stub: { generate: async () => look() } };
  const box = { config: { seconds: 2 }, probe: async () => ({ ok: true }), render: assert.fail };
  const app = await createServer({ dataDir: path.join(fx.tmp, 'data-ideas'), publicDir: PUBLIC, renderBox: box,
    generators: true, generator: (deps) => createQueue({ ...deps, adapterName: 'stub', adapters }), log: quiet });
  try {
    const idea = () => app.store.ideas.create({ owner: 'u1', text: 'a glow', status: 'queued', generator: 'stub' });
    const bad = idea();
    app.queue.enqueue(bad);
    await app.queue.idle();
    assert.equal(app.store.ideas.get(bad.id).status, 'failed');
    assert.match(app.store.ideas.get(bad.id).error, /Layer 1 \(Base\) is custom code/);
    code = clouds;
    const good = idea();
    app.queue.enqueue(good);
    await app.queue.idle();
    assert.equal(app.store.ideas.get(good.id).status, 'ready');
  } finally {
    await app.close();
  }
});
