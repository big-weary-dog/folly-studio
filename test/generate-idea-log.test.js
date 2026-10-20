// The idea log (src/generate/idea-log.ts, SPEC-generators "The idea log"): what it writes and keeps, the queue
// writing one per idea, the admin routes that read it back; and what the critique is told (critique-prompt.ts) of
// params changed and of groups too dark or too harsh, and the catalogue's ranges.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, test } from 'vitest';

import { buildCatalog, describeParam } from '../src/generate/catalog.ts';
import { buildCritiqueMessage, groupWarnings } from '../src/generate/critique-prompt.ts';
import { createIdeaLogs, isStillName } from '../src/generate/idea-log.ts';
import { createQueue } from '../src/generate/index.ts';
import { GenerateError } from '../shared/schemas/generated.ts';
import { queueSetup, STUDIO, tmp } from './fixtures/generate/shared.js';
import { fx, signup, startApp, useFixture } from './fixtures/server.js';

useFixture();
const DIR = path.join(STUDIO, 'public/patterns');
const REAL = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')).map((p) => ({ ...p,
  code: p.kind === 'preset' ? '' : fs.readFileSync(path.join(DIR, `${p.name}.js`), 'utf8') }));
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const layer = (modules) => ({ title: 'L', groups: ['cathedral'], blend: 'add', level: 1, modules });
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

describe('the idea log', () => {
  test('on disk: the idea, a line per call, the system prompt once, the stills, the outcome', async () => {
    const dir = tmp('ideas-log'), logs = createIdeaLogs({ dir });
    const log = logs.open('i1', { request: 'a reef', level: 'explore', model: 'sol' });
    log.note({ effort: 'medium' });
    const r = log.begin('compose');
    r.call({ ms: 5, system: 'SYSTEM', turn: 'idea 1', reply: { title: 'T' }, usage: { input: 100, cached: 60,
      output: 10, reasoning: 4 }, docs: ['sources/bars'] });
    r.end({ outcome: '0 errors, 9 params changed', notes: ['a: held'] });
    const c = log.begin('critique');
    c.still(PNG, { view: 'front', at: 1.5 });
    c.still(PNG, { view: 'spires', at: 1.5 });
    c.call({ ms: 7, system: 'SYSTEM', turn: 'look', usage: { input: 50, output: 5 } });
    c.end({ outcome: 'revised', warnings: ['- spires: dark'] });
    assert.deepEqual(log.summary(), { tokens: { input: 150, cached: 60, output: 15 }, rounds: [
      { kind: 'compose', ms: log.summary().rounds[0].ms, outcome: '0 errors, 9 params changed' },
      { kind: 'critique', ms: log.summary().rounds[1].ms, outcome: 'revised' }] });
    await log.finish({ status: 'ready', lookId: 'L1' });

    const at = path.join(dir, 'i1'), idea = read(at, 'idea.json');
    assert.deepEqual([idea.id, idea.request, idea.level, idea.model, idea.effort, idea.outcome],
      ['i1', 'a reef', 'explore', 'sol', 'medium', { status: 'ready', lookId: 'L1' }]);
    assert.deepEqual(idea.rounds.map((x) => [x.n, x.kind, x.calls, x.tokens.input]), [[1, 'compose', 1, 100],
      [2, 'critique', 1, 50]]);
    assert.deepEqual(idea.rounds[0].docs, ['sources/bars']);
    assert.deepEqual(idea.rounds[1].stills, [{ file: '2-critique-1.png', view: 'front', at: 1.5 },
      { file: '2-critique-2.png', view: 'spires', at: 1.5 }]);
    assert.ok(idea.rounds.every((x) => x.start <= x.end));
    const systems = fs.readdirSync(at).filter((f) => f.startsWith('system-'));
    assert.equal(systems.length, 1, 'the system prompt kept once');
    const calls = fs.readFileSync(path.join(at, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(calls.map((x) => [x.round, x.kind, x.system]), [[1, 'compose', systems[0].slice(7, -4)],
      [2, 'critique', systems[0].slice(7, -4)]]);
    assert.ok(fs.readdirSync(path.join(at, 'stills')).every(isStillName));

    const back = await logs.read('i1');
    assert.deepEqual([back.calls.length, Object.values(back.system), back.stills],
      [2, ['SYSTEM'], ['2-critique-1.png', '2-critique-2.png']]);
    assert.deepEqual(await logs.still('i1', '2-critique-1.png'), Buffer.from(PNG));
    for (const bad of ['../idea.json', '2-critique-1.png/..', '..', 'idea.json', '2-critique-1.PNG']) {
      assert.equal(await logs.still('i1', bad), null, bad);
    }
    assert.equal(await logs.read('../i1'), null);
    assert.equal(await logs.read('nope'), null);
  });

  test('a second attempt keeps the first; only the newest `keep` stay; keep 0 counts in memory only', async () => {
    const dir = tmp('ideas-log'), logs = createIdeaLogs({ dir, keep: 2 });
    const first = logs.open('a', { request: 'x', attempt: 1 });
    first.begin('compose').end({ outcome: 'cut' });
    await first.finish({ status: 'interrupted' });
    const again = logs.open('a', { request: 'x', attempt: 2 });
    again.begin('compose').end();
    await again.finish({ status: 'ready' });
    const idea = read(path.join(dir, 'a'), 'idea.json');
    assert.deepEqual([idea.rounds[0].n, idea.earlier[0].outcome.status], [101, 'interrupted']);
    for (const [id, age] of [['b', 2], ['c', 1]]) {
      await logs.open(id, {}).finish({ status: 'ready' });
      const t = new Date(Date.now() - age * 60_000);
      for (const f of fs.readdirSync(path.join(dir, id))) fs.utimesSync(path.join(dir, id, f), t, t);
    }
    await logs.prune();
    assert.deepEqual(fs.readdirSync(dir).sort(), ['a', 'c'], 'the oldest went');

    const none = createIdeaLogs({ dir: path.join(tmp('ideas-log'), 'none'), keep: 0 }).open('z', {});
    none.begin('compose').call({ ms: 1, turn: 't', usage: { input: 3, output: 1 } });
    await none.finish({ status: 'ready' });
    assert.deepEqual(none.summary().tokens, { input: 3, cached: 0, output: 1 });
    assert.equal(fs.existsSync(path.join(dir, '..', 'none')), false);
  });

  test('the queue logs each idea: its rounds, the notes repair, tokens on the idea, and a failure', async () => {
    const dir = tmp('ideas-log'), ideaLogs = createIdeaLogs({ dir }), asks = [];
    const odd = Array.from({ length: 9 }, (_, i) => ({ name: `nope${i}`, value: 1 }));
    const claude = async (ctx) => {
      asks.push(ctx.repair?.message ?? null);
      ctx.round?.call({ ms: 1, turn: 'turn', usage: { input: 10, cached: 4, output: 2 } });
      if (/the moon/.test(ctx.text)) throw new GenerateError('The model failed; please try again.', 'boom');
      return { title: 'T', summary: 'S', layers: [layer([{ use: 'bars', params: ctx.repair ? [] : odd }])] };
    };
    const { store, idea, queue } = queueSetup(createQueue, { adapterName: 'claude', adapters: { claude },
      loadLibrary: () => REAL, ideaLogs });
    const i = idea('a chase'), j = idea('the moon');
    queue.enqueue(i);
    queue.enqueue(j);
    await queue.idle();
    assert.match(asks[1], /changed these params[^]*nope0: bars has no such param/);
    const done = store.ideas.get(i.id);
    assert.equal(done.status, 'ready', done.error);
    assert.deepEqual(done.timing.tokens, { input: 20, cached: 8, output: 4 });
    assert.deepEqual(done.rounds.map((r) => [r.kind, r.outcome]), [['compose', '0 errors, 9 params changed'],
      ['notes', 'for 9 params changed: 0 errors, 0 params changed, kept']]);
    const log = read(path.join(dir, i.id), 'idea.json');
    assert.deepEqual([log.request, log.outcome], ['a chase', { status: 'ready', lookId: done.lookId }]);
    assert.equal(log.rounds[1].reason.length, 9);
    const failed = read(path.join(dir, j.id), 'idea.json');
    assert.deepEqual([failed.outcome.status, failed.outcome.error], ['failed', 'The model failed; please try again.']);
    assert.match(failed.rounds[0].outcome, /^failed: The model failed/);
    assert.equal(store.ideas.get(j.id).rounds[0].kind, 'compose');
  });
});

describe('the log routes', () => {
  let app, admin, member;
  beforeAll(async () => {
    const dataDir = path.join(fx.tmp, 'data-idea-log');
    app = await startApp({ dataDir, admins: 'Olive' });
    admin = await signup(app, 'olive');
    member = await signup(app, 'mona');
    const log = createIdeaLogs({ dir: path.join(dataDir, 'ideas-log') }).open('i9', { request: 'stars' });
    log.begin('critique').still(PNG, { view: 'front', at: 1.5 });
    await log.finish({ status: 'ready' });
  });
  afterAll(() => app?.close());

  test('admins only, checked on the server; a still by a strict name', async () => {
    const got = await admin.get('/api/admin/ideas/i9/log');
    assert.equal(got.status, 200);
    assert.equal(got.json.idea.request, 'stars');
    assert.deepEqual(got.json.stills, ['1-critique-1.png']);
    assert.match(got.headers.get('cache-control'), /^private/);
    const png = await admin.get('/api/admin/ideas/i9/log/stills/1-critique-1.png');
    assert.deepEqual([png.status, png.headers.get('content-type')], [200, 'image/png']);
    assert.equal((await member.get('/api/admin/ideas/i9/log')).status, 403);
    assert.equal((await member.get('/api/admin/ideas/i9/log/stills/1-critique-1.png')).status, 403);
    assert.equal((await admin.get('/api/admin/ideas/nope/log')).status, 404);
    assert.equal((await admin.get('/api/admin/ideas/i9/log/stills/1-critique-9.png')).status, 404);
    for (const bad of ['..%2Fidea.json', 'idea.json', '..%5Cidea.json', '1-critique-1.png%00']) {
      assert.equal((await admin.get(`/api/admin/ideas/i9/log/stills/${bad}`)).status, 400, bad);
    }
  });
});

describe('what the critique is told', () => {
  test('a group too dark or too harsh, with what the aim says of it', () => {
    const groups = [{ id: 'spires', name: 'Spires', tags: ['spire'] }, { id: 'rose', name: 'Rose window' },
      { id: 'nave', name: 'Nave' }];
    const lines = groupWarnings([{ id: 'spires', mean: 0.05 }, { id: 'rose', mean: 0.9 }, { id: 'nave', mean: 0.5 }],
      groups, 'Lightning on the spires. A calm sea below');
    assert.deepEqual(lines, ['- spires: dark, 5% on average; the aim says of it: "Lightning on the spires"',
      '- rose: harsh, 90% on average; the aim does not name it']);
    const message = buildCritiqueMessage({ idea: 'x', timeline: '0s ...', stills: [1.5, 10.5], seconds: 30,
      warnings: lines, notes: ['layers[0].modules[0].params.speed: 9 held to -2..2'] });
    assert.match(message, /all 30 s of it[^]*1\. the front at 1\.5 s; 2\. the front at 10\.5 s/);
    assert.match(message, /- spires: dark/);
    assert.match(message, /Your params were changed[^]*speed: 9 held to -2\.\.2/);
    assert.match(buildCritiqueMessage({ idea: 'x', timeline: '', stills: [1.5], seconds: 30 }),
      /Every top-level group is between 20% and 80% on average\./);
  });

  test('the catalogue gives each param its range, choices or kind, and its default', () => {
    assert.equal(describeParam('speed', { type: 'number', min: -2, max: 2, value: 0.4 }), 'speed -2–2 (0.4)');
    assert.equal(describeParam('mirror', { type: 'toggle', value: false }), 'mirror on/off (off)');
    assert.equal(describeParam('dir', { type: 'choice', options: ['up', 'down'], value: 'up' }), 'dir up|down (up)');
    assert.equal(describeParam('tint', { type: 'color', value: '#ff0000' }), 'tint colour (#ff0000)');
    assert.match(buildCatalog(REAL).text, /\n- fire: [^\n]*\[[^\]]*; height 0\.2–1\.5 \(0\.45\);/);
  });
});
