// A restart must not strand ideas: queued and generating ones go back in the generator queue.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, test } from 'vitest';

import { createServer } from '../src/app.ts';
import { createQueue } from '../src/generate/index.ts';
import { createStore } from '../src/store.ts';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const quiet = Object.assign(() => {}, { info() {}, debug() {}, warn() {}, error() {} });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-restart-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const box = { config: { seconds: 2 }, probe: async () => ({ ok: true }), render: assert.fail };

/** A data dir left by a server that stopped mid-work: one idea of each status. */
async function leftover(name) {
  const dir = path.join(tmp, name);
  const store = await createStore(dir, { log: quiet });
  const ids = {};
  for (const status of ['queued', 'generating', 'ready', 'failed']) {
    ids[status] = store.ideas.create({ owner: 'u1', text: `a ${status} idea`, status, generator: 'sketch' }).id;
  }
  await store.flush();
  return { dir, ids };
}

test('queued and generating ideas are enqueued again on startup, oldest first', async () => {
  const { dir, ids } = await leftover('fake');
  const queue = { enqueued: [], enqueue(idea) { this.enqueued.push(idea.id); }, async idle() {} };
  const app = await createServer({ dataDir: dir, publicDir: PUBLIC, generator: queue, renderBox: box, log: quiet });
  try {
    assert.deepEqual(queue.enqueued, [ids.queued, ids.generating]);
  } finally {
    await app.close();
  }
});

test('with the real queue they finish, so the Ideas page stops waiting', async () => {
  const { dir, ids } = await leftover('real');
  const look = { title: 'Calm', summary: 's', layers: [{ title: 'Base', code: 'function pixel() { return 0.5; }' }] };
  const adapters = { stub: { generate: async () => look } };
  const generator = (deps) => createQueue({ ...deps, adapterName: 'stub', adapters });
  const app = await createServer({ dataDir: dir, publicDir: PUBLIC, generator, renderBox: box, log: quiet });
  try {
    await app.queue.idle();
    for (const id of [ids.queued, ids.generating]) {
      const idea = app.store.ideas.get(id);
      assert.equal(idea.status, 'ready');
      assert.equal(app.store.looks.get(idea.lookId).title, 'Calm');
    }
    assert.equal(app.store.ideas.get(ids.failed).status, 'failed');
  } finally {
    await app.close();
  }
});

test('with no generator they fail instead of waiting forever', async () => {
  const { dir, ids } = await leftover('none');
  const generator = () => ({ adapterName: 'none', enqueue: () => { throw new Error('no generator'); } });
  const app = await createServer({ dataDir: dir, publicDir: PUBLIC, generator, renderBox: box, log: quiet });
  try {
    for (const id of [ids.queued, ids.generating]) assert.equal(app.store.ideas.get(id).status, 'failed');
    assert.equal(app.store.ideas.get(ids.ready).status, 'ready');
  } finally {
    await app.close();
  }
});
