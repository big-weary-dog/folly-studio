// What one account's looks may hold and how fast it writes them (SPEC "HTTP API"): the store's sizes and version-free
// lists, the bytes an account's looks keep to, and the per-account write limit.
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { lookRoutes } from '../src/api-looks.ts';
import { createAuth } from '../src/auth.ts';
import { MAX_LOOK_BYTES_PER_USER, roomForLook, roomToGrow } from '../src/look-cap.ts';
import { createStore, type Store } from '../src/store.ts';
import { fx, layer, quiet, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const tmp = () => (fx as { tmp: string }).tmp;
const fail = (why: string) => new Error(why);

describe('the store', () => {
  let store: Store;
  beforeAll(async () => { store = await createStore(await mkdtemp(path.join(tmp(), 'sizes-')), { log: quiet }); });
  afterAll(() => store.close());

  test('counts, sizes and lists without what a listing omits; the file holds every document as it is', async () => {
    const a = store.looks.create({ owner: 'ann', title: 'A', versions: [{ n: 1, title: 'é' }] });
    store.looks.create({ owner: 'bo', title: 'B' });
    const one = Buffer.byteLength(JSON.stringify(a));
    assert.deepEqual([store.looks.count(), store.looks.count((l) => l.owner === 'ann')], [2, 1]);
    assert.equal(store.looks.bytes((l) => l.owner === 'ann'), one);
    const [listed] = store.looks.list((l) => l.owner === 'ann', ['versions']);
    assert.deepEqual([listed!.title, 'versions' in listed!, store.looks.get(a.id)!.versions!.length], ['A', false, 1]);
    store.looks.update(a.id, { title: 'A2', versions: undefined });
    assert.ok(store.looks.bytes((l) => l.owner === 'ann') < one);
    store.looks.remove(a.id);
    await store.flush();
    const file = JSON.parse(await readFile(path.join(store.dataDir, 'looks.json'), 'utf8'));
    assert.deepEqual(file, store.looks.list());
  });

  test('an account\'s looks keep to the bytes; a change that does not grow them always saves', () => {
    const big = 'x'.repeat(2 ** 20);
    for (let n = 0; n < 19; n++) store.looks.create({ owner: 'cy', title: `${n}`, summary: big });
    assert.doesNotThrow(() => roomForLook(store, 'cy', fail, { title: 'small' }));
    assert.throws(() => roomForLook(store, 'cy', fail, { summary: big }), /delete some first/);
    assert.doesNotThrow(() => roomForLook(store, 'dee', fail, { summary: big }), 'another account');
    const was = store.looks.list((l) => l.owner === 'cy')[0]!;
    assert.throws(() => roomToGrow(store, was, { summary: big + big }, fail), /20 MB/);
    assert.doesNotThrow(() => roomToGrow(store, was, { summary: 'short' }, fail));
    assert.ok(store.looks.bytes((l) => l.owner === 'cy') <= MAX_LOOK_BYTES_PER_USER);
  });

  test('a new look counts what the store adds to it, to the byte', () => {
    store.looks.create({ owner: 'eve', title: 'E' });
    const left = MAX_LOOK_BYTES_PER_USER - store.looks.bytes((l) => l.owner === 'eve');
    const base = Buffer.byteLength(JSON.stringify(store.looks.create({ owner: 'zed', title: 'Z', summary: '' })));
    const fits = { owner: 'eve', title: 'Z', summary: 'x'.repeat(left - base) };
    assert.doesNotThrow(() => roomForLook(store, 'eve', fail, fits));
    assert.throws(() => roomForLook(store, 'eve', fail, { ...fits, summary: `${fits.summary}x` }), /20 MB/);
  });

  test('naming a version keeps to the bytes: a longer name is refused, a shorter one saves', async () => {
    const auth = createAuth({ store });
    const { routes } = lookRoutes({ store, auth, bakes: {} as never, dropFrames: async () => {} });
    const user = store.users.create({ username: 'fay', passwordHash: '' });
    const look = store.looks.create({ owner: user.id, title: 'F', version: { n: 1, how: 'auto', name: 'Long name' } });
    const filler = store.looks.create({ owner: user.id, title: 'Full', summary: '' });
    const left = MAX_LOOK_BYTES_PER_USER - store.looks.bytes((l) => l.owner === user.id);
    store.looks.update(filler.id, { summary: 'x'.repeat(left - 10) });
    const name = (to: string | null) => routes['PUT /looks/:id/versions/:n']({ user,
      params: { id: look.id, n: '1' }, body: { name: to } } as never);
    await assert.rejects(name('A much, much longer name than the version had'), /delete some first/);
    assert.equal((await name('Short')).version.name, 'Short');
    assert.equal((await name(null)).version.name, undefined);
  });
});

describe('look writes', () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  beforeAll(async () => {
    app = await startApp({ dataDir: path.join(tmp(), 'data-limits'), rateLimit: { writeMax: 3 } });
  });
  afterAll(() => app.close());

  test('are limited per account: past the limit 429 with Retry-After; reads and other accounts go on', async () => {
    const ann = await signup(app, 'limit-ann'), bo = await signup(app, 'limit-bo');
    const made = await ann.post('/api/looks', { title: 'One', layers: [layer()] });
    assert.equal(made.status, 201);
    const id = made.json.look.id;
    assert.equal((await ann.put(`/api/looks/${id}`, { title: 'Two' })).status, 200);
    assert.equal((await ann.put(`/api/looks/${id}/versions/1`, { name: 'First' })).status, 200);
    const over = await ann.del(`/api/looks/${id}`);
    assert.deepEqual([over.status, over.json.error], [429, 'Too many saves for now. Try again in a minute.']);
    assert.ok(Number(over.headers.get('retry-after')) > 0);
    assert.equal((await ann.get(`/api/looks/${id}`)).status, 200);
    assert.equal((await ann.get('/api/looks?scope=mine')).json.looks.length, 1);
    assert.equal((await bo.post('/api/looks', { title: 'Mine', layers: [layer()] })).status, 201);
  });
});
