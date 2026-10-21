// What plays (shared/plays.ts): every PLAYS field round-trips through a save, the version it leaves, the bake's hash
// and the stage's copy, so a field added to PLAYS can never be dropped by one of them.
import assert from 'node:assert/strict';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { DEFAULT_DURATION } from '../public/js/pattern-core.ts';
import { canonical, PLAYS, type PlaysKey, playsChanged, playsOf } from '../shared/plays.ts';
import { layersHash, renderFields, renderKey } from '../src/bake.ts';
import { stageCopy } from '../src/live/routes.ts';
import { versionsWith } from '../src/look-versions.ts';
import type { StoredLook } from '../src/store.ts';
import { fx, layer, signup, startApp, useFixture } from './fixtures/server.js';

Object.assign(globalThis, { matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) });
const { saveBody } = await import('../public/js/ui/studio-store.ts');

useFixture();

// Code that reads the tempo, so bpm is in the bake's render fields.
const BEAT = 'function pixel(p, t, P, G) { return [G.bpm / 240, 0, 0]; }';
const base = { layers: [layer({ code: BEAT })], duration: 20, bpm: 120, globals: { speed: 0.5 },
  automation: { energy: [[0, 0.2], [10, 0.8]] } };
/** Each field's other value. */
const OTHER: { [K in PlaysKey]: unknown } = { layers: [layer({ code: BEAT, level: 0.4 })], duration: 25, bpm: 128,
  globals: { speed: 0.7 }, automation: { energy: [[0, 0.3]] } };
const stored = (l: object) => ({ id: 'x', owner: 'u', title: 'T', summary: '', updatedAt: 'then', ...l }) as StoredLook;

describe('PLAYS', () => {
  test('every field plays: a change shows in the version, the bake key and the stage copy', () => {
    assert.deepEqual([...PLAYS].sort(), Object.keys(OTHER).sort(), 'a new PLAYS field needs a value here');
    for (const k of PLAYS) {
      const a = stored(base), b = stored({ ...base, [k]: OTHER[k] });
      assert.ok(playsChanged(a, b), k);
      assert.deepEqual(playsOf(versionsWith(a).at(-1)!)[k], playsOf(a)[k], `${k} kept in a version`);
      assert.notEqual(renderKey(a, a.duration!), renderKey(b, b.duration!), `${k} in the bake key`);
      assert.deepEqual(playsOf(stageCopy(b, 'u'))[k], OTHER[k], `${k} on the stage`);
      const saved = (l: object) => canonical(playsOf(saveBody({ id: null, title: 'T', summary: '', shared: false,
        ideaId: null, ...l } as never))[k]);
      assert.notEqual(saved(base), saved({ ...base, [k]: OTHER[k] }), `${k} saved by the Studio`);
    }
    assert.equal(playsChanged(stored(base), stored(JSON.parse(JSON.stringify(base)))), false, 'a copy plays the same');
  });

  test('the render fields keep their key order, so every bake made so far keeps its hash', () => {
    assert.deepEqual(Object.keys(renderFields(base) as object), ['layers', 'globals', 'automation', 'bpm']);
    assert.equal(layersHash(renderFields({ layers: [], globals: { speed: 1 } })),
      layersHash({ layers: [], globals: { speed: 1 }, automation: null, bpm: null }));
  });

  test("a look without a duration plays the core's default", () => {
    assert.equal(playsOf({}).duration, DEFAULT_DURATION);
  });

  test('a version keeps bpm, null when the look had none', () => {
    assert.equal(versionsWith(stored({ layers: [] })).at(-1)!.bpm, null);
    assert.equal(versionsWith(stored(base)).at(-1)!.bpm, 120);
  });
});

describe('PLAYS through the API', () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  beforeAll(async () => { app = await startApp({ dataDir: path.join((fx as { tmp: string }).tmp, 'data-plays') }); });
  afterAll(async () => { await app.close(); });

  test('each field changed by a save is kept, as it was, in the version the save leaves', async () => {
    const alice = await signup(app, 'plays-alice');
    const { look } = (await alice.post('/api/looks', { title: 'Plays', ...base })).json;
    for (const k of PLAYS) {
      const was = (await alice.get(`/api/looks/${look.id}`)).json.look;
      const r = await alice.put(`/api/looks/${look.id}?versions=1`, { [k]: OTHER[k] });
      assert.equal(r.status, 200, r.text);
      assert.deepEqual(playsOf(r.json.look.versions.at(-1)), playsOf(was), k);
    }
    const n = (await alice.get(`/api/looks/${look.id}?versions=1`)).json.look.versions.length;
    await alice.put(`/api/looks/${look.id}`, { title: 'Words only' });
    assert.equal((await alice.get(`/api/looks/${look.id}?versions=1`)).json.look.versions.length, n);
  });
});
