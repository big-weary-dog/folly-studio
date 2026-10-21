// Look files (SPEC-offline "Look files"): a look's file, several in one, and importing them back through the
// real POST /api/looks as the importer's own, unshared looks; a refused look or file is named, the rest go in.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, test, vi } from 'vitest';

import { createBody, fileText, fullLooks, importFiles, lookFile, looksIn, manyName } from
  '../public/js/ui/look-file.ts';
import { layer, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const file = (name, data) => ({ name, text: async () => (typeof data === 'string' ? data
  : fileText(data)) });

describe('look files', () => {
  let app, ada, sea;
  const realFetch = fetch;
  beforeAll(async () => {
    app = await startApp({ dataDir: mkdtempSync(path.join(tmpdir(), 'look-file-')) });
    ada = await signup(app, 'ada');
    sea = (await ada.post('/api/looks', { title: 'Sea', summary: 'Blue', chain: 2, layers: [layer()], bpm: 120 }))
      .json.look;
    // The app's client asks by path, as the page does; the fixture's own client asks by URL.
    vi.stubGlobal('fetch', (p, init) => (p.startsWith('/') ? realFetch(app.base + p,
      { ...init, headers: { ...init.headers, cookie: ada.cookie } }) : realFetch(p, init)));
  });
  afterAll(async () => { vi.unstubAllGlobals(); await app?.close(); });

  test('a look file holds the words, chain 2 and what plays, and nothing of the server’s', () => {
    const f = lookFile(sea);
    assert.deepEqual(Object.keys(f).slice(0, 3), ['title', 'summary', 'chain']);
    assert.equal(f.chain, 2);
    assert.equal(f.bpm, 120);
    for (const k of ['id', 'owner', 'shared', 'ideaId', 'createdAt']) assert.equal(k in f, false, k);
    assert.equal(manyName('mine', new Date('2026-10-20T12:00:00Z')), 'folly-looks-mine-2026-10-20.json');
  });

  test('a file holds one look or { looks }, else says why', () => {
    assert.equal(looksIn(fileText(lookFile(sea))).length, 1);
    assert.equal(looksIn(fileText({ looks: [lookFile(sea), lookFile(sea)] })).length, 2);
    assert.throws(() => looksIn('{'), /not JSON/);
    assert.throws(() => looksIn('{"title":"x"}'), /no looks/);
    assert.deepEqual(Object.keys(createBody({ ...lookFile(sea), id: 'x', shared: true, ideaId: 'i' })).sort(),
      ['bpm', 'chain', 'duration', 'layers', 'summary', 'title']);
  });

  test('export all fetches each look; import adds them as the importer’s, unshared, naming what failed', async () => {
    const many = await fullLooks([sea, { ...sea, id: 'gone' }]);
    assert.equal(many.length, 1);
    const bad = { ...lookFile(sea), title: 'Broken', layers: 'nope' };
    const r = await importFiles([file('many.json', { looks: [...many, bad] }), file('junk.json', 'oops')]);
    assert.equal(r.added, 1);
    assert.deepEqual(r.failed.map((f) => f.name), ['Broken', 'junk.json']);
    assert.match(r.failed[1].error, /not JSON/);
    const mine = (await ada.get('/api/looks?scope=mine')).json.looks;
    const copy = mine.find((l) => l.id !== sea.id);
    assert.equal(copy.title, 'Sea');
    assert.equal(copy.shared, false);
    const full = (await ada.get(`/api/looks/${copy.id}`)).json.look;
    assert.deepEqual(lookFile(full), lookFile(sea));
  });
});
