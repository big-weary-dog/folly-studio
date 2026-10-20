// Refining a look and the rounds after a generation (SPEC-generators "Refine", "The render check", "Critique"): a
// look decomposed to its composition and the diff of two, sketch's word edits, what a model is shown of its frames,
// the render check on a stand-in box, and the queue's runtime repair, critique and refinement rounds.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { describe, test } from 'vitest';

import { groupsByTag, pixelsForGroups, prepareScene } from '../public/js/pattern-core.ts';
import { writeFseq } from '../public/js/fseq.ts';
import { BakeError } from '../src/box-output.ts';
import { buildCatalog } from '../src/generate/catalog.ts';
import { renderCheck } from '../src/generate/check.ts';
import { createClaudeAdapter } from '../src/generate/claude.ts';
import { expand } from '../src/generate/expand.ts';
import { cellsOf, closeUpGroups, drawCloseUp } from '../src/generate/frames-closeup.ts';
import { viewFrames } from '../src/generate/frames-view.ts';
import { createQueue } from '../src/generate/index.ts';
import { buildCritiqueMessage } from '../src/generate/prompt.ts';
import { decompose, diffCompositions } from '../src/generate/refine.ts';
import { sketchRefine } from '../src/generate/sketch-refine.ts';
import { PACE } from '../src/generate/sketch.ts';
import { validateLook } from '../shared/schemas/generated.ts';
import { GROUPS, queueSetup, RIG, STUDIO } from './fixtures/generate/shared.js';

const DIR = path.join(STUDIO, 'public/patterns');
const REAL = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')).map((p) => ({ ...p,
  code: p.kind === 'preset' ? '' : fs.readFileSync(path.join(DIR, `${p.name}.js`), 'utf8') }));
const CATALOG = buildCatalog(REAL);
const SCENE = prepareScene(RIG);
/** A library source with a pace param (speed, rate…), and that param. */
const [PACED, PACE_PARAM] = [...CATALOG.modules].flatMap(([name, m]) => (m.kind === 'source' ? Object.entries(m.params)
  .filter(([p, d]) => d.type === 'number' && PACE.test(p)).map(([p]) => [name, p]) : []))[0];
const answer = (extra = {}) => ({ title: 'Tide', summary: 'A slow swell', layers: [{ title: 'Swell',
  groups: ['cathedral'], blend: 'add', level: 0.8, modules: [{ use: PACED, params: [] }] }], ...extra });
const lookOf = (raw) => validateLook(expand(raw, CATALOG).look, { groups: GROUPS, library: REAL });

/** `seconds` of frames on the rig, every LED `rgb` (NaN-free; the stand-in box's). */
function frames(seconds, rgb = [200, 0, 0]) {
  const cc = SCENE.frameChannels, n = Math.round(seconds * 40), data = new Uint8Array(cc * n);
  for (let f = 0; f < n; f++) {
    for (let k = 0; k < SCENE.count; k++) {
      for (let c = 0; c < 3; c++) if (SCENE.addr[k] >= 0) data[f * cc + SCENE.addr[k] + SCENE.order[c]] = rgb[c];
    }
  }
  return Buffer.from(writeFseq({ channelCount: cc, frames: n, data }));
}
/** A stand-in render box: each render's job kept; `reports(job, n)` → what the box says of the nth. */
function stubBox(reports = () => ({ ok: true })) {
  const jobs = [];
  return { jobs, probe: async () => ({ ok: true }), async render(job) {
    jobs.push(job);
    return { bytes: frames(job.seconds), boxStats: { untrusted: true, reported: reports(job, jobs.length) },
      ms: 1, seconds: job.seconds };
  } };
}

describe('decompose and diff', () => {
  test('a module still its ref\'s is the ref again, with the params the catalogue declares; edited code an extension',
    () => {
      const look = lookOf(answer());
      look.layers[0].modules[0].params = { [PACE_PARAM]: 0.3, stray: 1 };
      const comp = decompose(look, CATALOG);
      assert.deepEqual(comp.layers[0].modules.map((m) => [m.use, m.params]), [[PACED, [{ name: PACE_PARAM,
        value: 0.3 }]]]);
      assert.equal(comp.layers[0].level, 0.8);
      assert.equal(lookOf(comp).layers[0].modules[0].ref, PACED,
        'it expands back to the same module');
      look.layers[0].modules[0].code += '\n// mine';
      const edited = decompose(look, CATALOG);
      assert.match(edited.layers[0].modules[0].use, /^ext:/);
      assert.equal(edited.extensions[0].code, look.layers[0].modules[0].code);
    });

  test('what changed, in words: a param, a level, a layer added, the palette', () => {
    const a = decompose(lookOf(answer()), CATALOG), b = structuredClone(a);
    b.layers[0].modules[0].params.push({ name: PACE_PARAM, value: 0.1 });
    b.layers[0].level = 0.5;
    b.layers.push({ ...structuredClone(a.layers[0]), title: 'Glow' });
    b.globals = { palette: 'ember' };
    const lines = diffCompositions(a, b).join('\n');
    assert.match(lines, new RegExp(`${PACE_PARAM} default → 0\\.1`));
    assert.match(lines, /level/);
    assert.match(lines, /\+ .*Glow/);
    assert.match(lines, /palette/);
    assert.deepEqual(diffCompositions(a, structuredClone(a)), []);
    const picked = { ...a, globals: { palette: { colors: ['#ff0000'] } } };
    assert.deepEqual(diffCompositions(picked, structuredClone(picked)), [], 'an equal palette object is no change');
  });
});

describe('sketch refines', () => {
  const opts = { library: REAL, groups: GROUPS, catalog: CATALOG };
  const comp = () => decompose(lookOf(answer()), CATALOG);
  const param = (c) => c.layers[0].modules[0].params.find((p) => p.name === PACE_PARAM)?.value;
  test('slower and faster scale each pace param; brighter and dimmer each layer\'s level', () => {
    const d = CATALOG.modules.get(PACED).params[PACE_PARAM].value;
    assert.ok(param(sketchRefine(comp(), 'make it slower', opts)) < d);
    assert.ok(param(sketchRefine(comp(), 'a bit faster please', opts)) > d);
    assert.ok(sketchRefine(comp(), 'brighter', opts).layers[0].level > 0.8);
    assert.ok(sketchRefine(comp(), 'dimmer', opts).layers[0].level < 0.8);
  });
  test('a colour word sets the palette; anything else it says it cannot do', () => {
    assert.ok(sketchRefine(comp(), 'more blue', opts).globals?.palette);
    assert.throws(() => sketchRefine(comp(), 'tell a story about whales', opts), /Sketch can't make that change/);
  });
});

describe('what the model sees of its frames', () => {
  test('front-view PNGs at the times asked for, and a line a second per top group', () => {
    const { stills, timeline } = viewFrames(frames(3), RIG, { at: [1, 2] });
    assert.deepEqual(stills.map((s) => s.at), [1, 2]);
    assert.deepEqual([...stills[0].png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const lines = timeline.split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^0s \S+ #c80000 \d+%/);
    assert.deepEqual(viewFrames(frames(1), RIG, { stills: false }).stills, []);
  });
  test('a look on the rose also gets the rose up close, each LED its pane, and the critique says so', () => {
    const scene = prepareScene(RIG), rose = groupsByTag(scene, 'rose').map((g) => g.id);
    assert.ok(rose.length);
    const all = GROUPS.map((g) => g.id);
    const layer = (over) => ({ layers: [{ id: 'a', groups: [], modules: [{ params: {} }], ...over }] });
    assert.deepEqual(closeUpGroups(layer({ tags: ['rose'] }), scene), rose);
    assert.deepEqual(closeUpGroups(layer({ groups: all }), scene), []);
    assert.deepEqual(closeUpGroups(layer({ groups: all, modules: [{ params: { centre: 'rose' } }] }), scene), rose);
    const { stills, closeUps } = viewFrames(frames(3), RIG, { at: [1, 2], closeUps: rose });
    assert.deepEqual(closeUps.map((c) => [c.at, c.group]), [[1, rose[0]], [2, rose[0]]]);
    assert.deepEqual([...closeUps[0].png.subarray(0, 8)], [...stills[0].png.subarray(0, 8)]);
    assert.equal(closeUps[0].png.readUInt32BE(16), 240);
    assert.deepEqual(viewFrames(frames(1), RIG, { stills: false, closeUps: rose }).closeUps, []);
    const cells = cellsOf(RIG, scene, rose[0]);
    assert.equal(cells.length, pixelsForGroups(scene, rose[0]).length);
    const { rgb } = drawCloseUp(cells, () => [255, 0, 0]);
    assert.ok(rgb.some((v, i) => i % 3 === 0 && v === 255) && rgb.some((v, i) => i % 3 === 0 && v === 0));
    assert.match(buildCritiqueMessage({ idea: 'an eye', timeline: '', stills: [1], closeUps: rose }),
      new RegExp(`Then ${rose[0]} up close at the same times, each LED drawn as its glass pane`));
    assert.doesNotMatch(buildCritiqueMessage({ idea: 'an eye', timeline: '', stills: [], closeUps: rose }), /up close/);
  });
});

describe('the render check', () => {
  const look = { layers: [{ id: 'a', title: 'Swell' }, { id: 'b', title: 'Spark' }] };
  test('a layer that throws, a slow look and a box that fails, in the box\'s words, bounded', async () => {
    const box = stubBox(() => ({ layers: [{ id: 'b', errorFrames: 12, firstError: `boom\u0007${'x'.repeat(500)}` }],
      msPerFrame: { average: 31 } }));
    const seen = await renderCheck(box, look, { seconds: 2, rig: RIG });
    assert.equal(box.jobs[0].seconds, 2);
    assert.deepEqual(seen.errors.map((e) => [e.path, e.code]), [['layer 2 "Spark"', 'runtime'], ['look', 'slow']]);
    assert.ok(!seen.errors[0].message.includes('\u0007') && seen.errors[0].message.length < 260);
    assert.equal(typeof seen.analysis.meanBrightness, 'number');
    const failing = { probe: async () => ({ ok: true }), render: async () => { throw new BakeError('it hung'); } };
    assert.deepEqual((await renderCheck(failing, look, { seconds: 2, rig: RIG })).errors,
      [{ path: 'look', code: 'runtime', message: 'it hung' }]);
    assert.equal(await renderCheck(undefined, look, { seconds: 2, rig: RIG }), null);
    assert.equal(await renderCheck({ probe: async () => ({ ok: false }) }, look, { seconds: 2, rig: RIG }), null);
  });
});

describe('claude is shown its frames', () => {
  test('a critique turn: the stills as image blocks before its text; a refinement\'s own first turn', () => {
    const a = createClaudeAdapter({ apiKey: 'k', fallbacks: false });
    const png = new Uint8Array([1, 2, 3]);
    const { body } = a.buildRequest({ text: 'x', library: [], groups: [], turn: '<request>slower</request>',
      repair: { answer: { title: 'T' }, errors: [], message: 'Look at these', images: [png] } });
    assert.equal(body.messages[0].content, '<request>slower</request>');
    assert.equal(body.messages[1].role, 'assistant');
    const [image, text] = body.messages[2].content;
    assert.deepEqual(image, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } });
    assert.deepEqual(text, { type: 'text', text: 'Look at these' });
  });
});

/** A queue on claude's lane with `claude` as its adapter, over the real library and a stand-in box. */
const onClaude = (claude, box, opts = {}) => queueSetup(createQueue, { adapterName: 'claude', adapters: { claude },
  loadLibrary: () => REAL, box, ...opts });

describe('the rounds in the queue', () => {
  test('a layer that throws in the box goes back once, and the fix is kept; no box, no check', async () => {
    const asks = [];
    const box = stubBox((job, n) => (n === 1 ? { layers: [{ id: job.layers[0].id, errorFrames: 80,
      firstError: 'x is not defined' }] } : { ok: true }));
    const { store, idea, queue } = onClaude(async (ctx) => { asks.push(ctx.repair); return answer(); }, box);
    const i = idea('a tide');
    queue.enqueue(i);
    await queue.idle();
    const done = store.ideas.get(i.id);
    assert.equal(done.status, 'ready', done.error);
    assert.equal(asks.length, 2);
    assert.equal(asks[1].errors[0].code, 'runtime');
    assert.match(asks[1].errors[0].message, /x is not defined/);
    assert.equal(box.jobs.length, 2);
    assert.equal(typeof done.timing.check, 'number');

    const plain = onClaude(async () => answer(), undefined), j = plain.idea('a tide');
    plain.queue.enqueue(j);
    await plain.queue.idle();
    assert.equal(plain.store.ideas.get(j.id).timing.check, undefined);
  });

  test('a refinement asks with the composition and the request, saves an edit, and says what changed', async () => {
    const asks = [];
    const claude = async (ctx) => {
      asks.push(ctx);
      return answer({ layers: [{ ...answer().layers[0], level: 0.4 }] });
    };
    const { store, user, queue } = onClaude(claude, stubBox());
    const look = store.looks.create({ owner: user.id, ...lookOf(answer()), bake: { status: 'done' }, reviewed: true });
    const i = store.ideas.create({ owner: user.id, text: 'dimmer', status: 'queued', generator: 'claude',
      lookId: look.id, refine: {} });
    queue.enqueue(i);
    await queue.idle();
    const done = store.ideas.get(i.id), after = store.looks.get(look.id);
    assert.equal(done.status, 'ready', done.error);
    assert.match(asks[0].turn, /<request>\ndimmer\n<\/request>/);
    assert.match(asks[0].turn, new RegExp(`"use": ?"${PACED}"`));
    assert.match(done.changes.join('\n'), /level 0\.8 → 0\.4/);
    assert.equal(after.layers[0].level, 0.4);
    assert.equal(after.bake, undefined);
    assert.equal(after.reviewed, false);
    assert.equal(after.versions.length, 1);
    assert.equal(store.looks.list().length, 1, 'no new look');
  });

  test('a later refinement is told the look\'s history; an undone one is left out', async () => {
    const turns = [];
    let level = 0.8;
    const claude = async (ctx) => {
      turns.push(ctx.turn);
      return answer({ layers: [{ ...answer().layers[0], level: level /= 2 }] });
    };
    const { store, user, queue } = onClaude(claude, stubBox());
    const made = store.ideas.create({ owner: user.id, text: 'A slow tide', status: 'ready', generator: 'claude' });
    const look = store.looks.create({ owner: user.id, ...lookOf(answer()), ideaId: made.id });
    const refine = async (text) => {
      const i = store.ideas.create({ owner: user.id, text, status: 'queued', generator: 'claude', lookId: look.id,
        refine: {} });
      queue.enqueue(i);
      await queue.idle();
      return i;
    };
    const one = await refine('dimmer');
    await refine('dimmer still');
    assert.match(turns[0], /<history>\nThe idea: "A slow tide"\n<\/history>/);
    assert.match(turns[1], /The idea: "A slow tide"\nThen "dimmer" → .*level 0\.8 → 0\.4\n<\/history>/);
    store.ideas.update(one.id, { undone: true });
    await refine('brighter');
    assert.doesNotMatch(turns[2], /Then "dimmer" →/);
    assert.match(turns[2], /Then "dimmer still" →/);
  });

  test('a muted layer and a switched-off module stay so; an edit made meanwhile is never overwritten', async () => {
    let edit = null;
    const claude = async () => {
      if (edit) await store.looks.update(look.id, edit);
      return answer({ layers: [{ ...answer().layers[0], level: 0.4 }] });
    };
    const { store, user, queue } = onClaude(claude, stubBox());
    const made = lookOf(answer()), off = { ...made.layers[0].modules[0], id: 'm2', enabled: false };
    const look = store.looks.create({ owner: user.id, ...made,
      layers: [{ ...made.layers[0], enabled: false, solo: true, modules: [made.layers[0].modules[0], off] }] });
    const refine = (text) => {
      const i = store.ideas.create({ owner: user.id, text, status: 'queued', generator: 'claude', lookId: look.id,
        refine: {} });
      queue.enqueue(i);
      return i;
    };
    const one = refine('dimmer');
    await queue.idle();
    assert.equal(store.ideas.get(one.id).status, 'ready', store.ideas.get(one.id).error);
    const [layer] = store.looks.get(look.id).layers;
    assert.deepEqual([layer.level, layer.enabled, layer.solo], [0.4, false, true]);
    assert.deepEqual(layer.modules.map((m) => m.enabled ?? true), [true, false]);
    assert.equal(layer.modules[1].id, 'm2');
    edit = { layers: [{ ...layer, level: 0.3 }] };
    const two = refine('dimmer');
    await queue.idle();
    assert.match(store.ideas.get(two.id).error, /edited while it was being refined/);
    assert.equal(store.looks.get(look.id).layers[0].level, 0.3);
  });

  test('a critique on request: the stills and timeline, one round, the revision kept when it renders', async () => {
    const asks = [];
    const claude = async (ctx) => {
      asks.push(ctx.repair);
      return answer({ layers: [{ ...answer().layers[0], level: 0.5 }] });
    };
    const box = stubBox();
    const { store, user, queue } = onClaude(claude, box);
    const look = store.looks.create({ owner: user.id, ...lookOf(answer()) });
    const i = store.ideas.create({ owner: user.id, text: '', status: 'queued', generator: 'claude', lookId: look.id,
      refine: { critique: true } });
    queue.enqueue(i);
    await queue.idle();
    const done = store.ideas.get(i.id);
    assert.equal(done.status, 'ready', done.error);
    assert.equal(asks.length, 1, 'the look itself is the answer critiqued: no first ask');
    assert.equal(asks[0].images.length, 3);
    assert.match(asks[0].message, /at 1, 4.3, 7.6 s/);
    assert.deepEqual(box.jobs.map((j) => j.seconds), [8, 2]);
    assert.equal(typeof done.timing.critique, 'number');
    assert.equal(store.looks.get(look.id).layers[0].level, 0.5);
    assert.equal(done.verdict, 'revised');
  });

  test('sketch refines in words, or fails and leaves the look as it was', async () => {
    const { store, user, queue } = queueSetup(createQueue, { loadLibrary: () => REAL });
    const look = store.looks.create({ owner: user.id, ...lookOf(answer()) });
    const ask = (text) => {
      const i = store.ideas.create({ owner: user.id, text, status: 'queued', generator: 'sketch', lookId: look.id,
        refine: {} });
      queue.enqueue(i);
      return i;
    };
    const ok = ask('brighter');
    await queue.idle();
    assert.equal(store.ideas.get(ok.id).status, 'ready', store.ideas.get(ok.id).error);
    assert.ok(store.looks.get(look.id).layers[0].level > 0.8);
    const before = store.looks.get(look.id), no = ask('write me a poem');
    await queue.idle();
    assert.equal(store.ideas.get(no.id).status, 'failed');
    assert.match(store.ideas.get(no.id).error, /Sketch can't/);
    assert.deepEqual(store.looks.get(look.id).layers, before.layers);
  });
});
