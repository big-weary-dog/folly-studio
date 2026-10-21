// The looks routes: create, read, edit with versions and review, share, delete, bake and frames.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { parseFseq } from '../src/frames.ts';
import { fakeBox, fx, layer, PIXEL, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();

describe('looks', () => {
  let app;
  let box;
  beforeAll(async () => {
    app = await startApp({ dataDir: path.join(fx.tmp, 'data-main'), curators: 'Carol, other',
      renderBox: (box = fakeBox()) });
  });
  afterAll(async () => {
    await app.close();
  });
  let alice;
  let bob;
  let carol;
  beforeAll(async () => {
    alice = await signup(app, 'look-alice');
    bob = await signup(app, 'look-bob');
    carol = await signup(app, 'carol');   // a curator
  });

  test('create validates and defaults', async () => {
    const r = await alice.post('/api/looks', { title: ' Coral reef ', layers: [{ code: PIXEL }] });
    assert.equal(r.status, 201);
    const look = r.json.look;
    assert.equal(look.title, 'Coral reef');
    assert.equal(look.summary, '');
    assert.equal(look.owner, alice.user.id);
    assert.equal(look.ownerName, 'look-alice');
    assert.equal(look.shared, false);
    assert.equal(look.reviewed, false);
    assert.equal('versions' in look, false);
    assert.deepEqual(look.layers, [{ id: 'l1', title: '', code: PIXEL, blend: 'add', level: 1,
      params: {} }], 'no groups: the rig\'s root');
    const tagged = await alice.post('/api/looks', { title: 'Portable', layers: [layer({ tags: ['rose', 'rose'] })] });
    assert.deepEqual(tagged.json.look.layers[0].tags, ['rose']);

    const bads = [
      { layers: [layer()] },
      { title: 'x', layers: 'nope' },
      { title: 'x', layers: Array.from({ length: 9 }, (_, i) => layer({ id: `l${i}` })) },
      { title: 'x', layers: [layer({ code: 42 })] },
      { title: 'x', layers: [layer({ code: `// ${'x'.repeat(20 * 1024)}` })] },
      { title: 'x', layers: [layer({ groups: 'cathedral' })] },
      { title: 'x', layers: [layer({ groups: [1] })] },
      { title: 'x', layers: [layer({ tags: ['Not a tag'] })] },
      { title: 'x', layers: [layer({ tags: 'rose' })] },
      { title: 'x', layers: [layer({ blend: 'screen' })] },
      { title: 'x', layers: [layer({ level: 1.5 })] },
      { title: 'x', layers: [layer({ level: -0.1 })] },
      { title: 'x', layers: [layer({ params: [] })] },
      { title: 'x', layers: [layer({ params: { a: { nested: true } } })] },
      { title: 'x', layers: [layer(), layer()] },
      { title: 'x', layers: [layer()], ideaId: 'not-mine' },
    ];
    for (const body of bads) {
      const res = await alice.post('/api/looks', body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 120));
      assert.ok(res.json.error);
    }
    const eight = Array.from({ length: 8 }, (_, i) => layer({ id: `l${i}`, blend: ['add', 'over', 'max',
      'multiply'][i % 4], level: i / 7 }));
    assert.equal((await alice.post('/api/looks', { title: 'Eight', layers: eight })).status, 201);
  });

  test('ideaId must be my idea', async () => {
    const idea = app.store.ideas.create({ owner: alice.user.id, text: 'linked idea', status: 'ready' });
    const ok = await alice.post('/api/looks', { title: 'From idea', layers: [layer()], ideaId: idea.id });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.look.ideaId, idea.id);
    assert.equal((await bob.post('/api/looks', { title: 'Stolen', layers: [layer()], ideaId: idea.id })).status, 400);
  });

  test('ownership, sharing, gallery', async () => {
    const a1 = (await alice.post('/api/looks', { title: 'First', layers: [layer()] })).json.look;
    const a2 = (await alice.post('/api/looks', { title: 'Second', layers: [layer()] })).json.look;

    // Private: invisible to others.
    assert.equal((await bob.get(`/api/looks/${a1.id}`)).status, 404);
    assert.equal((await bob.put(`/api/looks/${a1.id}`, { title: 'Mine now' })).status, 404);
    assert.equal((await bob.del(`/api/looks/${a1.id}`)).status, 404);
    assert.ok(!(await bob.get('/api/looks?scope=gallery')).json.looks.some((l) => l.id === a1.id));

    const mine = (await alice.get('/api/looks')).json.looks.map((l) => l.id);
    assert.ok(mine.includes(a1.id) && mine.includes(a2.id));
    assert.ok(!(await bob.get('/api/looks?scope=mine')).json.looks.some((l) => l.owner === alice.user.id));
    assert.equal((await alice.get('/api/looks?scope=everything')).status, 400);

    // Share a1 then a2: gallery is newest first.
    assert.equal((await alice.put(`/api/looks/${a1.id}`, { shared: true })).json.look.shared, true);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal((await alice.put(`/api/looks/${a2.id}`, { shared: true })).status, 200);
    const gallery = (await bob.get('/api/looks?scope=gallery')).json.looks;
    const ids = gallery.map((l) => l.id);
    assert.ok(ids.indexOf(a2.id) < ids.indexOf(a1.id) && ids.indexOf(a2.id) >= 0);
    assert.ok(gallery.every((l) => l.shared === true && !('versions' in l)));
    assert.equal(gallery.find((l) => l.id === a1.id).ownerName, 'look-alice');

    // Shared: visible, still not editable or deletable by others.
    assert.equal((await bob.get(`/api/looks/${a1.id}`)).json.look.title, 'First');
    assert.equal((await bob.put(`/api/looks/${a1.id}`, { title: 'Mine now' })).status, 404);
    assert.equal((await bob.del(`/api/looks/${a1.id}`)).status, 404);

    // Unshare: gone again.
    await alice.put(`/api/looks/${a1.id}`, { shared: false });
    assert.equal((await bob.get(`/api/looks/${a1.id}`)).status, 404);

    // Delete.
    const del = await alice.del(`/api/looks/${a2.id}`);
    assert.deepEqual(del.json, { ok: true });
    assert.equal((await alice.get(`/api/looks/${a2.id}`)).status, 404);
    assert.equal((await alice.del(`/api/looks/${a2.id}`)).status, 404);
  });

  test('PUT keeps up to 20 previous versions, shown only with ?versions=1', async () => {
    const look = (await alice.post('/api/looks', { title: 'Versioned', layers: [layer({ level: 0 })] })).json.look;
    const r1 = await alice.put(`/api/looks/${look.id}`, { layers: [layer({ level: 0.5 })] });
    assert.equal(r1.status, 200);
    assert.equal(r1.json.look.layers[0].level, 0.5);
    assert.equal('versions' in r1.json.look, false);

    const full = await alice.get(`/api/looks/${look.id}?versions=1`);
    assert.equal(full.json.look.versions.length, 1);
    assert.equal(full.json.look.versions[0].layers[0].level, 0);
    assert.equal('versions' in (await alice.get(`/api/looks/${look.id}`)).json.look, false);

    // Title-only and identical-layer saves add no version.
    await alice.put(`/api/looks/${look.id}`, { title: 'Renamed', layers: [layer({ level: 0.5 })] });
    assert.equal((await alice.get(`/api/looks/${look.id}?versions=1`)).json.look.versions.length, 1);

    for (let i = 1; i <= 25; i++) await alice.put(`/api/looks/${look.id}`, { layers: [layer({ level: i / 100 })] });
    const capped = (await alice.put(`/api/looks/${look.id}?versions=1`, { title: 'Done' })).json.look;
    assert.equal(capped.versions.length, 20);
    assert.equal(capped.versions.at(-1).layers[0].level, 0.24);
    assert.equal(capped.title, 'Done');

    // Others never see versions, even of a shared look.
    await alice.put(`/api/looks/${look.id}`, { shared: true });
    assert.equal('versions' in (await bob.get(`/api/looks/${look.id}?versions=1`)).json.look, false);

    // Invalid layers on PUT are rejected and nothing changes.
    assert.equal((await alice.put(`/api/looks/${look.id}`, { layers: [layer({ blend: 'nope' })] })).status, 400);
    assert.equal((await alice.get(`/api/looks/${look.id}`)).json.look.layers[0].level, 0.25);
  });

  test('reviewed is curator-only', async () => {
    const look = (await alice.post('/api/looks', { title: 'Review me', layers: [layer()], shared: true })).json.look;
    assert.equal(look.shared, true);

    assert.equal((await alice.put(`/api/looks/${look.id}`, { reviewed: true })).status, 403);
    assert.equal((await bob.put(`/api/looks/${look.id}`, { reviewed: true })).status, 404, 'not theirs');
    // Echoing the unchanged value is harmless.
    assert.equal((await alice.put(`/api/looks/${look.id}`, { title: 'Review me', reviewed: false })).status, 200);

    // Reviewing needs a passing render-box bake of the current code.
    const unbaked = await carol.put(`/api/looks/${look.id}`, { reviewed: true });
    assert.equal(unbaked.status, 409);
    assert.match(unbaked.json.error, /Bake this look/);
    assert.equal((await alice.post(`/api/looks/${look.id}/bake`)).status, 202);
    await app.bakes.idle();
    const ok = await carol.put(`/api/looks/${look.id}`, { reviewed: true });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.look.reviewed, true);
    assert.equal((await bob.get(`/api/looks/${look.id}`)).json.look.reviewed, true);
    // A curator may not edit someone else's content: to them it is not found.
    assert.equal((await carol.put(`/api/looks/${look.id}`, { title: 'Curated', reviewed: true })).status, 404);

    // New code from the owner clears the review, and the bake of the old code.
    const edited = await alice.put(`/api/looks/${look.id}`, { layers: [layer({ level: 0.3 })] });
    assert.equal(edited.json.look.reviewed, false);
    assert.equal(edited.json.look.bake, undefined);
    assert.equal((await carol.put(`/api/looks/${look.id}`, { reviewed: true })).status, 409);
    // So does a new tempo on a look that moves to the beat. The old tempo is kept in the version.
    const beat = 'function pixel(p, t, P, G) { return [G.bpm / 240, 0, 0]; }';
    await alice.put(`/api/looks/${look.id}`, { layers: [layer({ code: beat })] });
    assert.equal((await alice.post(`/api/looks/${look.id}/bake`)).status, 202);
    await app.bakes.idle();
    assert.equal((await carol.put(`/api/looks/${look.id}`, { reviewed: true })).status, 200);
    await alice.put(`/api/looks/${look.id}`, { bpm: 120 });
    const faster = await alice.put(`/api/looks/${look.id}?versions=1`, { bpm: 140 });
    assert.deepEqual([faster.json.look.reviewed, faster.json.look.bake, faster.json.look.versions.at(-1).bpm],
      [false, undefined, 120]);

    // A curator cannot review a private look of someone else.
    const priv = (await alice.post('/api/looks', { title: 'Private', layers: [layer()] })).json.look;
    assert.equal((await carol.put(`/api/looks/${priv.id}`, { reviewed: true })).status, 404);
    // But can review their own, once baked.
    const own = (await carol.post('/api/looks', { title: 'Carol own', layers: [layer()] })).json.look;
    assert.equal((await carol.post(`/api/looks/${own.id}/bake`)).status, 202);
    await app.bakes.idle();
    assert.equal((await carol.put(`/api/looks/${own.id}`, { reviewed: true })).json.look.reviewed, true);
  });

  test('bake: queued render, frames download, flicker blocks review', async () => {
    const strobe = (await alice.post('/api/looks', { title: 'Strobe!  "x"',
      layers: [layer({ code: `// STROBE\n${PIXEL}` })], shared: true })).json.look;
    // Code no other look has baked: the same render would take those frames instead of baking.
    const calm = (await alice.post('/api/looks', { title: 'Calm', layers: [layer({ code: `// calm\n${PIXEL}` })] }))
      .json.look;
    assert.equal((await alice.get(`/api/looks/${calm.id}/frames`)).status, 404, 'nothing baked yet');

    assert.equal((await bob.post(`/api/looks/${strobe.id}/bake`)).status, 404, 'not the owner, not a curator');
    assert.equal((await bob.post(`/api/looks/${calm.id}/bake`)).status, 404, 'private');
    await app.previews.idle(); // the shared look's gallery preview renders it too
    const before = box.renders;
    const queued = await alice.post(`/api/looks/${strobe.id}/bake`);
    assert.equal(queued.status, 202);
    assert.equal(queued.json.bake.source, 'render-box');
    assert.ok(['queued', 'running'].includes(queued.json.bake.status));
    assert.equal((await carol.post(`/api/looks/${calm.id}/bake`)).status, 404,
      'a curator bakes only what they can see');
    assert.equal((await alice.post(`/api/looks/${calm.id}/bake`)).status, 202);
    assert.ok(['queued', 'running'].includes((await alice.post(`/api/looks/${calm.id}/bake`)).json.bake.status),
      'asking again while queued is the same bake');
    await app.bakes.idle();
    assert.equal(box.renders, before + 2, 'the strobe once, the calm look once');

    const { bake } = (await alice.get(`/api/looks/${strobe.id}`)).json.look;
    assert.equal(bake.status, 'done');
    assert.equal(bake.ok, false);
    assert.equal(bake.analysis.flicker.ok, false);
    assert.equal(bake.analysis.flicker.maxHz, 10);
    assert.equal(bake.analysis.frames, 80);
    assert.equal(bake.boxStats.untrusted, true);
    assert.match(bake.reason, /flash/);
    const blocked = await carol.put(`/api/looks/${strobe.id}`, { reviewed: true });
    assert.equal(blocked.status, 409);
    assert.match(blocked.json.error, /flash/);

    // Frames: owner and (shared) others download them; the private look's only its owner.
    const res = await fetch(`${app.base}/api/looks/${strobe.id}/frames`, { headers: { cookie: bob.cookie } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/octet-stream');
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="Strobe-x.fseq"');
    const parsed = parseFseq(new Uint8Array(await res.arrayBuffer()));
    assert.equal(parsed.frameCount, 80);
    assert.deepEqual(parsed.ranges, [[0, 6]]);
    assert.equal((await alice.get(`/api/looks/${calm.id}/frames`)).status, 200);
    assert.equal((await bob.get(`/api/looks/${calm.id}/frames`)).status, 404);
    assert.equal((await fetch(`${app.base}/api/looks/${strobe.id}/frames`)).status, 401);

    // Editing the code drops the bake and its frames.
    assert.equal((await alice.get(`/api/looks/${calm.id}`)).json.look.bake.ok, true);
    await alice.put(`/api/looks/${calm.id}`, { layers: [layer({ level: 0.5 })] });
    assert.equal((await alice.get(`/api/looks/${calm.id}/frames`)).status, 404);
    // Deleting the look deletes its frames.
    const file = path.join(fx.tmp, 'data-main', 'frames', `${strobe.id}.fseq`);
    assert.ok((await readFile(file)).length > 0);
    assert.equal((await alice.del(`/api/looks/${strobe.id}`)).status, 200);
    await assert.rejects(readFile(file), /ENOENT/);
  });

  test('a curator approves a flashing bake only with a reason, which stays on the look', async () => {
    const look = (await alice.post('/api/looks', { title: 'Finale', shared: true,
      layers: [layer({ code: `// STROBE finale\n${PIXEL}` })] })).json.look;
    assert.equal((await alice.post(`/api/looks/${look.id}/bake`)).status, 202);
    await app.bakes.idle();
    const put = (who, body) => who.put(`/api/looks/${look.id}`, body);
    const plain = await put(carol, { reviewed: true });
    assert.equal(plain.status, 409);
    assert.match(plain.json.error, /needs a curator's reason/);
    assert.equal((await put(carol, { reviewed: true, flashOverride: ' ok ' })).status, 400, 'a real reason');
    assert.equal((await put(carol, { flashOverride: 'The finale, announced and fenced off.' })).status, 400,
      'only with reviewed: true');
    assert.equal((await put(bob, { reviewed: true, flashOverride: 'I like it a lot.' })).status, 404);

    const ok = await put(carol, { reviewed: true, flashOverride: ' The finale, announced and fenced off. ' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.look.reviewed, true);
    const { flashOverride } = (await bob.get(`/api/looks/${look.id}`)).json.look;
    assert.equal(flashOverride.reason, 'The finale, announced and fenced off.');
    assert.equal(flashOverride.by, 'carol');
    assert.ok(Date.parse(flashOverride.at) > 0);
    assert.equal(ok.json.look.bake.ok, false, 'the bake still says it flashes');

    assert.equal((await put(carol, { reviewed: false })).json.look.flashOverride, undefined);
    await put(carol, { reviewed: true, flashOverride: 'The finale, announced and fenced off.' });
    const edited = await put(alice, { layers: [layer({ level: 0.4 })] });
    assert.equal(edited.json.look.reviewed, false);
    assert.equal(edited.json.look.flashOverride, undefined, 'new code needs a fresh review');
    // A look without flashing is approved as before; a reason given anyway is not kept.
    const calm = (await alice.post('/api/looks', { title: 'Calm finale', shared: true,
      layers: [layer({ code: `// calm finale\n${PIXEL}` })] })).json.look;
    await alice.post(`/api/looks/${calm.id}/bake`);
    await app.bakes.idle();
    const calmOk = await carol.put(`/api/looks/${calm.id}`, { reviewed: true, flashOverride: 'Not needed here.' });
    assert.equal(calmOk.json.look.reviewed, true);
    assert.equal(calmOk.json.look.flashOverride, undefined);
  });

  test('a failed flicker check from any box blocks review', async () => {
    const look = (await alice.post('/api/looks', { title: 'Fleet strobe', layers: [layer()], shared: true })).json.look;
    app.store.looks.update(look.id, {
      bake: { source: 'fleet-box', status: 'done', ok: false, analysis: { flicker: { ok: false, maxHz: 8,
        flaggedSeconds: [2, 3], regions: ['cathedral'] } } },
    });
    const r = await carol.put(`/api/looks/${look.id}`, { reviewed: true });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /up to 8 flashes a second .* around 2 s, 3 s/);
    assert.equal((await alice.get(`/api/looks/${look.id}`)).json.look.reviewed, false);
  });
});

describe('without a render box', () => {
  test('baking refuses with the reason, and nothing is queued', async () => {
    const reason = 'The render box is not available: bubblewrap (bwrap) is not installed on this server.';
    const app = await startApp({ dataDir: path.join(fx.tmp, 'data-nobox'), renderBox: { probe: async () => ({ ok: false,
      reason }), render: assert.fail } });
    try {
      const alice = await signup(app, 'nobox');
      const look = (await alice.post('/api/looks', { title: 'x', layers: [layer()] })).json.look;
      const r = await alice.post(`/api/looks/${look.id}/bake`);
      assert.equal(r.status, 503);
      assert.equal(r.json.error, reason);
      assert.equal((await alice.get(`/api/looks/${look.id}`)).json.look.bake, undefined);
    } finally {
      await app.close();
    }
  });
});
