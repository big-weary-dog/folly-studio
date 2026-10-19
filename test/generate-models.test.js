// The queue with the model registry: each idea on its own model's transport (the real claude adapter on a mocked
// fetch, the real codex adapter on the stand-in CLI), the prompt built once and sent byte for byte the same, the
// fallback, a lane per transport, timing, watching, and stopping.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, test } from 'vitest';

import { createQueue } from '../src/generate/index.ts';
import { createRegistry } from '../src/generate/models.ts';
import {
  FIX, goodLayer, jsonRes, LIBRARY, lookJson, queueSetup, quiet, sse, streamOf, tmp,
} from './fixtures/generate/shared.js';

const BIN = path.join(FIX, 'bin');
const saved = { fetch: globalThis.fetch, env: { ...process.env } };
afterEach(() => {
  globalThis.fetch = saved.fetch;
  for (const k of ['ANTHROPIC_API_KEY', 'CODEX_FAKE_LOG', 'CODEX_FAKE_MODE', 'STUDIO_CODEX_WORK']) {
    if (saved.env[k] === undefined) delete process.env[k];
    else process.env[k] = saved.env[k];
  }
});

/** A queue over a fresh registry; idea(text, model) files an idea that asks for `model`. */
function routed(opts = {}, change = (c) => c) {
  const dir = tmp('routes');
  const models = createRegistry({ file: path.join(dir, 'models.json'), env: { ANTHROPIC_API_KEY: 'k', PATH: BIN },
    log: quiet });
  models.save(change(models.config()));
  const setup = queueSetup(createQueue, { models, codexBin: path.join(BIN, 'codex'), ...opts });
  const idea = (text, model) => setup.store.ideas.create({ owner: setup.user.id, text, status: 'queued', model,
    generator: model });
  return { ...setup, models, idea, dir };
}

describe('the queue with models', () => {
  test('each idea runs on its model: its transport, model name and effort; the prompt is built once', async () => {
    const bodies = [];
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    globalThis.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return sse(streamOf(lookJson())); };
    const log = path.join(tmp('codex-log'), 'calls.jsonl');
    Object.assign(process.env, { CODEX_FAKE_LOG: log, STUDIO_CODEX_WORK: tmp('codex-work') });
    let loads = 0, version = 'v1';
    const { store, idea, queue } = routed({ loadVersion: () => version,
      loadLibrary: () => { loads++; return LIBRARY; } });
    const ids = [['a', 'opus'], ['b', 'sol'], ['c', 'luna'], ['d', 'sketch'], ['e', 'opus']]
      .map(([t, m]) => idea(t, m).id);
    ids.forEach((id) => queue.enqueue(id));
    await queue.idle();
    const done = ids.map((id) => store.ideas.get(id));
    assert.deepEqual(done.map((i) => [i.status, i.generator, i.by]), [['ready', 'opus', 'Opus'],
      ['ready', 'sol', 'Sol'], ['ready', 'luna', 'Luna'], ['ready', 'sketch', 'Sketch'], ['ready', 'opus', 'Opus']]);
    for (const { timing } of done) {
      assert.deepEqual(Object.keys(timing), ['wait', 'prompt', 'request', 'parse', 'total']);
      assert.ok(Object.values(timing).every((ms) => Number.isInteger(ms) && ms >= 0));
      assert.ok(timing.total >= timing.request);
    }
    // Through claude: its model and effort, and a cached system prompt sent byte for byte the same both times.
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies.map((b) => [b.model, b.output_config.effort]), [['claude-opus-5-5', 'medium'],
      ['claude-opus-5-5', 'medium']]);
    assert.equal(JSON.stringify(bodies[0].system), JSON.stringify(bodies[1].system));
    assert.equal(JSON.stringify(bodies[0].output_config), JSON.stringify(bodies[1].output_config));
    assert.deepEqual(bodies[0].system[0].cache_control, { type: 'ephemeral' });
    assert.notEqual(JSON.stringify(bodies[0].messages), JSON.stringify(bodies[1].messages));
    // Through codex: the CLI with each model's name; the library was read once for all five.
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l).args);
    const flag = (args, f) => args[args.indexOf(f) + 1];
    assert.deepEqual(calls.map((a) => flag(a, '-m')).sort(), ['gpt-6-luna', 'gpt-6.1-sol']);
    assert.ok(calls.every((a) => a.includes('model_reasoning_effort="low"')));
    assert.equal(loads, 1);
    version = 'v2'; // the library changed: read again, and the prompt built again
    queue.enqueue(idea('f', 'sketch').id);
    await queue.idle();
    assert.equal(loads, 2);
  });

  test('a model that fails hands the idea to the fallback, which says why', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    globalThis.fetch = async () => jsonRes(401, { error: { type: 'authentication_error', message: 'bad key' } });
    const { store, idea, queue } = routed({ fallbackName: 'sketch' });
    const i = idea('stars on the rose window', 'opus');
    queue.enqueue(i.id);
    await queue.idle();
    const done = store.ideas.get(i.id);
    assert.deepEqual([done.status, done.model, done.generator, done.by], ['ready', 'opus', 'sketch', 'Sketch']);
    assert.match(store.looks.get(done.lookId).summary, /^The AI generator is misconfigured on this server\. /);
  });

  test('a lane per transport: Opus never waits behind Sol, and each lane keeps its own limit', async () => {
    const order = [], gates = [];
    const codex = async ({ text }) => {
      order.push(`start ${text}`);
      await new Promise((r) => gates.push(r));
      order.push(`end ${text}`);
      return { title: text, layers: [goodLayer()] };
    };
    const claude = async ({ text }) => { order.push(`opus ${text}`); return { title: text, layers: [goodLayer()] }; };
    const { store, idea, queue } = routed({ adapters: { codex, claude } },
      (c) => ({ ...c, concurrency: { codex: 1 } }));
    const [s1, s2, o] = [idea('s1', 'sol'), idea('s2', 'luna'), idea('o', 'opus')];
    [s1, s2, o].forEach((i) => queue.enqueue(i.id));
    for (let i = 0; i < 50 && store.ideas.get(o.id).status !== 'ready'; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(store.ideas.get(o.id).status, 'ready', 'Opus finished while Sol was still running');
    assert.equal(store.ideas.get(s2.id).status, 'queued', 'Luna waits: one codex call at a time');
    assert.equal(queue.size, 2);
    gates.shift()();
    for (let i = 0; i < 50 && !gates.length; i++) await new Promise((r) => setTimeout(r, 5));
    gates.shift()();
    await queue.idle();
    assert.deepEqual(order, ['start s1', 'opus o', 'end s1', 'start s2', 'end s2']);
  });

  test('watch hears every change of an idea; stop cuts running calls and leaves their ideas for the next start',
    async () => {
    const codex = ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort',
      () => reject(new Error('aborted'))));
    const { store, idea, queue } = routed({ adapters: { codex }, fallbackName: 'sketch' });
    const i = idea('slow', 'sol'), heard = [];
    const unwatch = queue.watch(i.id, () => heard.push(store.ideas.get(i.id).status));
    queue.enqueue(i.id);
    queue.enqueue(idea('later', 'luna').id);
    for (let n = 0; n < 50 && !heard.length; n++) await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(heard, ['generating']);
    queue.stop();
    await queue.idle();
    assert.equal(store.ideas.get(i.id).status, 'generating', 'not failed, not handed to the fallback');
    assert.equal(queue.size, 0);
    assert.equal(queue.enqueue(idea('after stop', 'sketch').id), false);
    unwatch();
  });
});
