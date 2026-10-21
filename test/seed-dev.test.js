// tools/seed-dev.ts: an empty dev data dir seeded from another's shared looks, their frames and previews, light and
// models; never users, sessions, invites or ideas; the source read only; a non-empty or same target refused.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, test } from 'vitest';

import { createStore } from '../src/store.ts';
import { seedDev } from '../tools/seed-dev.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-seed-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const KEY = '0123456789abcdef';

/** Every file under dir: { relative path: [bytes, mtimeMs] }. */
function tree(dir) {
  const out = {};
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const file = path.join(e.parentPath, e.name), st = fs.statSync(file);
    out[path.relative(dir, file)] = [fs.readFileSync(file).toString('base64'), st.mtimeMs];
  }
  return out;
}

async function source(name) {
  const data = path.join(tmp, name);
  const store = await createStore(data);
  const ana = store.users.create({ username: 'ana', passwordHash: 'x' });
  store.sessions.create({ userId: ana.id, expiresAt: '2099-01-01T00:00:00Z' });
  store.invites.create({ hash: 'h', uses: 1, used: 0, createdBy: ana.id });
  const idea = store.ideas.create({ owner: ana.id, text: 'a reef', status: 'done', generator: 'x' });
  const reef = store.looks.create({ owner: ana.id, ownerName: 'old', title: 'Reef', shared: true, ideaId: idea.id,
    layers: [] });
  const mine = store.looks.create({ owner: ana.id, title: 'Private', layers: [] });
  const gone = store.looks.create({ owner: 'nobody', ownerName: 'Bo', title: 'Orphan', shared: true, layers: [] });
  await store.flush();
  fs.writeFileSync(path.join(data, 'light.json'), '{"gamma":2.2}\n');
  fs.writeFileSync(path.join(data, 'models.json'), '{"models":[]}\n');
  fs.writeFileSync(path.join(data, 'live.json'), '{"rev":1}\n');
  fs.mkdirSync(path.join(data, 'frames', 'abc'), { recursive: true });
  fs.writeFileSync(path.join(data, 'frames', 'abc', 'manifest.json'), '{}');
  fs.mkdirSync(path.join(data, 'previews'));
  for (const look of [reef, mine]) {
    fs.writeFileSync(path.join(data, 'frames', `${look.id}.fseq`), `frames of ${look.title}`);
    fs.writeFileSync(path.join(data, 'previews', `${look.id}-${KEY}.webp`), 'webp');
    fs.writeFileSync(path.join(data, 'previews', `${look.id}-${KEY}-still.webp`), 'still');
  }
  fs.mkdirSync(path.join(data, 'ideas-log', idea.id), { recursive: true });
  fs.writeFileSync(path.join(data, 'ideas-log', idea.id, 'idea.json'), '{}');
  return { data, ana, reef, mine, gone };
}

test('shared looks with their frames and previews, light and models; nothing about people', async () => {
  const { data, ana, reef, gone } = await source('prod');
  const before = tree(data);
  const to = path.join(tmp, 'dev');
  const r = await seedDev({ from: data, to });
  assert.deepEqual(r, { looks: 2, frames: 1, previews: 2, files: ['looks.json', 'light.json', 'models.json'] });
  assert.deepEqual(tree(data), before, 'the source is unchanged');
  assert.deepEqual(Object.keys(tree(to)).sort(), ['frames/' + reef.id + '.fseq', 'light.json', 'looks.json',
    'models.json', `previews/${reef.id}-${KEY}-still.webp`, `previews/${reef.id}-${KEY}.webp`].sort());
  assert.equal(fs.statSync(path.join(to, 'looks.json')).mode & 0o777, 0o600);

  const store = await createStore(to);
  assert.deepEqual([store.users, store.sessions, store.invites, store.ideas].map((c) => c.list().length), [0, 0, 0, 0]);
  const copied = store.looks.get(reef.id);
  assert.equal(copied.owner, ana.id);
  assert.equal(copied.ownerName, 'ana', 'named from the source users, which are not copied');
  assert.equal(copied.ideaId, undefined);
  assert.equal(copied.createdAt, reef.createdAt);
  assert.equal(store.looks.get(gone.id).ownerName, 'Bo');
  assert.equal(store.looks.list().length, 2, 'the unshared look stays behind');
});

test('refuses a non-empty target, the source itself and a folder inside it', async () => {
  const { data } = await source('prod2');
  const full = path.join(tmp, 'full');
  fs.mkdirSync(full);
  fs.writeFileSync(path.join(full, 'note'), 'x');
  const before = tree(data);
  await assert.rejects(seedDev({ from: data, to: full }), /not empty/);
  await assert.rejects(seedDev({ from: data, to: data }), /source/);
  await assert.rejects(seedDev({ from: data, to: path.join(data, 'dev') }), /source/);
  fs.symlinkSync(data, path.join(tmp, 'alias'));
  await assert.rejects(seedDev({ from: data, to: path.join(tmp, 'alias') }), /source/);
  assert.deepEqual(tree(data), before);
});
