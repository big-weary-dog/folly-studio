// Standard modules (SPEC "Modules"): a module whose ref names a library module keeps the library's name, in the
// store's rule, over the API and from generators; a custom module (no ref) is its own to name.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { validateLook } from '../shared/schemas/generated.ts';
import { keepStandardTitles, standardTitle } from '../shared/standard-modules.ts';
import { fakeBox, fx, PIXEL, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const index = JSON.parse(readFileSync(new URL('../public/patterns/index.json', import.meta.url), 'utf8'));
const STREAKS = index.find((e) => e.name === 'streaks').title;
const LIB = [{ name: 'streaks', title: STREAKS }, { name: 'bare' }, { name: 'set', kind: 'preset', title: 'Set' }];
const layer = (mods) => ({ id: 'l1', title: 'L', groups: ['cathedral'], modules: mods });
const std = (title) => ({ id: 'a', kind: 'source', title, ref: 'streaks', code: PIXEL });
const own = (title) => ({ id: 'b', kind: 'source', title, code: PIXEL });

describe('the rule', () => {
  test('a ref the library has is standard, named as the library names it; else custom', () => {
    assert.equal(standardTitle({ ref: 'streaks' }, LIB), STREAKS);
    assert.equal(standardTitle({ ref: 'bare' }, LIB), 'bare');
    assert.equal(standardTitle({ ref: 'set' }, LIB), undefined);      // a preset is no module
    assert.equal(standardTitle({ ref: 'gone' }, LIB), undefined);
    assert.equal(standardTitle({}, LIB), undefined);
    const mods = [std('Renamed'), own('Mine')], out = keepStandardTitles(mods, LIB);
    assert.deepEqual(out.map((m) => m.title), [STREAKS, 'Mine']);
    assert.equal(out[1], mods[1]);
  });
  test('a generated module with a library ref takes the library name', () => {
    const look = validateLook({ title: 'T', layers: [{ title: 'L', modules: [std('Glints'), own('Crossing')] }] },
      { library: LIB });
    assert.deepEqual(look.layers[0].modules.map((m) => m.title), [STREAKS, 'Crossing']);
  });
});

describe('over the API', () => {
  let app, ana;
  beforeAll(async () => {
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-standard'), publicDir: PUBLIC, renderBox: fakeBox() });
    ana = await signup(app, 'standard-ana');
  });
  afterAll(() => app.close());

  test('a standard module renamed keeps its library name; a custom one takes the new name', async () => {
    const made = await ana.post('/api/looks', { title: 'S', chain: 2, layers: [layer([std('Glints'), own('One')])] });
    assert.equal(made.status, 201, made.text);
    assert.deepEqual(made.json.look.layers[0].modules.map((m) => m.title), [STREAKS, 'One']);
    const r = await ana.put(`/api/looks/${made.json.look.id}`,
      { chain: 2, layers: [layer([std('Again'), own('Crossing')])] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.look.layers[0].modules.map((m) => m.title), [STREAKS, 'Crossing']);
  });
});
