// A look's versions (SPEC-history "Versions"): numbered, listed newest first with the look as saved, one read with
// its content, the owner's alone; a restore names its version and keeps a review of the same content; a named one is
// kept, at most 50.
import assert from 'node:assert/strict';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { MAX_NAMED, nameFields } from '../src/look-versions.ts';
import type { StoredLook } from '../src/store.ts';
import { fakeBox, fx, layer, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();

describe('versions', () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  let alice: Awaited<ReturnType<typeof signup>>, bob: typeof alice, carol: typeof alice;
  beforeAll(async () => {
    app = await startApp({ dataDir: path.join((fx as { tmp: string }).tmp, 'data-versions'), curators: 'v-carol',
      renderBox: fakeBox() });
    [alice, bob, carol] = [await signup(app, 'v-alice'), await signup(app, 'v-bob'), await signup(app, 'v-carol')];
  });
  afterAll(async () => { await app.close(); });

  test('listed newest first, the look as saved on top; one read with its content', async () => {
    const palette = { low: ['#000000'], body: ['#ff0000'], accent: ['#00ff00'], high: ['#ffffff'] };
    const { look } = (await alice.post('/api/looks', { title: 'V', layers: [layer()], globals: { palette } })).json;
    assert.equal(look.version, 1);
    const put = await alice.put(`/api/looks/${look.id}`, { layers: [layer({ level: 0.5 }), layer({ id: 'l2' })] });
    assert.equal(put.json.look?.version, 2, put.text);
    assert.equal((await alice.put(`/api/looks/${look.id}`, { title: 'Words' })).json.look.version, 2);

    const { versions } = (await alice.get(`/api/looks/${look.id}/versions`)).json;
    assert.deepEqual(versions.map((v: { n: number }) => v.n), [2, 1]);
    assert.deepEqual([versions[0].current, versions[0].layerCount, versions[1].layerCount], [true, 2, 1]);
    assert.deepEqual(versions[1].palette, ['#000000', '#ff0000', '#00ff00', '#ffffff']);
    assert.equal(versions[1].how, 'auto');
    assert.ok(!('layers' in versions[1]), 'the list has no content');

    const one = (await alice.get(`/api/looks/${look.id}/versions/1`)).json.version;
    assert.deepEqual([one.n, one.layers.length, one.globals.palette.body], [1, 1, ['#ff0000']]);
    assert.equal((await alice.get(`/api/looks/${look.id}/versions/9`)).status, 404);
  });

  test("the owner's alone: others, curators too, get 404 even on a shared look", async () => {
    const { look } = (await alice.post('/api/looks', { title: 'Mine', layers: [layer()], shared: true })).json;
    for (const who of [bob, carol]) {
      assert.equal((await who.get(`/api/looks/${look.id}/versions`)).status, 404);
      assert.equal((await who.get(`/api/looks/${look.id}/versions/1`)).status, 404);
      assert.ok(!('version' in (await who.get(`/api/looks/${look.id}`)).json.look));
    }
  });

  test('a restore names its version, and keeps the review when it plays as the reviewed one', async () => {
    const { look } = (await alice.post('/api/looks', { title: 'R', layers: [layer()], shared: true })).json;
    assert.equal((await alice.post(`/api/looks/${look.id}/bake`)).status, 202);
    await app.bakes.idle();
    assert.equal((await carol.put(`/api/looks/${look.id}`, { reviewed: true })).status, 200);
    const edited = (await alice.put(`/api/looks/${look.id}`, { layers: [layer({ level: 0.3 })] })).json.look;
    assert.equal(edited.reviewed, false);
    assert.equal((await alice.put(`/api/looks/${look.id}`, { layers: [layer()], restoredFrom: 7 })).status, 400);

    const back = await alice.put(`/api/looks/${look.id}`, { layers: [layer()], restoredFrom: 1 });
    assert.equal(back.status, 200, back.text);
    const { reviewed, reviewedBy, version } = back.json.look;
    assert.deepEqual([reviewed, reviewedBy, version], [true, 'v-carol', 3]);
    const top = (await alice.get(`/api/looks/${look.id}/versions`)).json.versions[0];
    assert.deepEqual([top.how, top.from, top.reviewed], ['restore', 1, true]);

    // Other content is reviewed afresh, restore or not.
    const other = await alice.put(`/api/looks/${look.id}`, { layers: [layer({ level: 0.6 })], restoredFrom: 2 });
    assert.equal(other.json.look.reviewed, false);
  });

  test('the last 20 unnamed versions are kept, numbers never reused', async () => {
    const { look } = (await alice.post('/api/looks', { title: 'Many', layers: [layer({ level: 0 })] })).json;
    for (let i = 1; i <= 23; i++) await alice.put(`/api/looks/${look.id}`, { layers: [layer({ level: i / 100 })] });
    const { versions } = (await alice.get(`/api/looks/${look.id}/versions`)).json;
    assert.equal(versions.length, 21);
    assert.deepEqual([versions[0].n, versions.at(-1).n], [24, 4]);
  });

  test('a named version is kept past the 20, renamed or unnamed by its owner alone', async () => {
    const { look } = (await alice.post('/api/looks', { title: 'Named', layers: [layer({ level: 0 })], shared: true }))
      .json;
    const url = `/api/looks/${look.id}`;
    const saved = await alice.put(url, { layers: [layer({ level: 0.5 })], versionName: ' Before the drop ' });
    assert.equal(saved.status, 200, saved.text);
    let top = (await alice.get(`${url}/versions`)).json.versions[0];
    assert.deepEqual([top.n, top.name, top.current], [2, 'Before the drop', true]);
    assert.equal((await alice.put(url, { versionName: 'Words only' })).status, 200);   // no new version: names this one
    assert.equal((await alice.get(`${url}/versions`)).json.versions[0].name, 'Words only');

    const named = await alice.put(`${url}/versions/1`, { name: 'First' });
    assert.deepEqual([named.status, named.json.version?.name], [200, 'First'], named.text);
    for (let i = 1; i <= 22; i++) await alice.put(url, { layers: [layer({ level: i / 100 })] });
    let { versions } = (await alice.get(`${url}/versions`)).json;
    assert.deepEqual(versions.filter((v: { name?: string }) => v.name).map((v: { n: number }) => v.n), [2, 1]);
    assert.equal(versions.length, 23);

    assert.equal((await alice.put(`${url}/versions/1`, { name: null })).status, 200);
    await alice.put(url, { layers: [layer({ level: 0.9 })] });
    ({ versions } = (await alice.get(`${url}/versions`)).json);
    assert.ok(!versions.some((v: { n: number }) => v.n === 1), 'unnamed, it is pruned at the next save');
    assert.equal((await alice.put(`${url}/versions/99`, { name: 'x' })).status, 404);
    assert.equal((await alice.put(`${url}/versions/2`, { name: '' })).status, 400);
    assert.equal((await bob.put(`${url}/versions/2`, { name: 'Mine' })).status, 404);
    assert.equal((await bob.put(url, { versionName: 'Mine' })).status, 404);
    top = (await alice.get(`${url}/versions`)).json.versions.find((v: { n: number }) => v.n === 2);
    assert.equal(top.name, 'Words only');
  });

  test(`at most ${MAX_NAMED} named versions`, () => {
    const versions = Array.from({ length: MAX_NAMED + 1 },
      (_, i) => ({ n: i + 1, ...(i < MAX_NAMED ? { name: `v${i}` } : {}) }));
    const look = { id: 'k', versions, version: { n: MAX_NAMED + 2 } } as unknown as StoredLook;
    assert.throws(() => nameFields(look, MAX_NAMED + 1, 'one more'), /at most 50/);
    assert.throws(() => nameFields(look, MAX_NAMED + 2, 'one more'), /at most 50/);
    assert.ok(nameFields(look, 1, 'renamed').versions, 'renaming a named one is no new name');
  });
});
