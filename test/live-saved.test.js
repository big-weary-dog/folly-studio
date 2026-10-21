// src/live/hub.ts and live.json: read back through SavedLive (an older file takes the new fields' defaults; anything
// else starts the stage empty), saved whole at shutdown through a temporary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, test } from 'vitest';

import { createHub } from '../src/live/hub.ts';
import { emptyLive } from '../src/live/state.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-live-saved-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const playable = () => ({ error: 'no' });
const LOOK = { id: 'look1', title: 'Sea', ownerName: 'alice', duration: 10, layers: [{ id: 'l1', modules: [] }],
  globals: null, automation: null };

async function hubOn(name, saved) {
  const dataDir = path.join(tmp, name), warnings = [];
  fs.mkdirSync(dataDir);
  if (saved !== undefined) {
    fs.writeFileSync(path.join(dataDir, 'live.json'), typeof saved === 'string' ? saved : JSON.stringify(saved));
  }
  const log = { warn: (...a) => warnings.push(a.join(' ')), error: (...a) => warnings.push(a.join(' ')) };
  return { hub: await createHub({ dataDir, playable, log }), warnings, dataDir };
}

test('an older live.json, without the newer fields, still loads', async () => {
  const { driver: _, ...old } = { ...emptyLive(), rev: 7, look: LOOK, held: { speed: 2 } };
  const { hub, warnings } = await hubOn('old', old);
  assert.equal(hub.live.rev, 7);
  assert.equal(hub.live.look.title, 'Sea');
  assert.equal(hub.live.driver, 'stage');
  assert.deepEqual(warnings, []);
  await hub.close();
});

test('a live.json that is not a stage starts the stage empty, saying why', async () => {
  for (const [name, saved] of [['rev', { rev: 'x' }], ['lanes', { ...emptyLive(), rev: 3, lanes: { speed: [1] } }],
    ['look', { ...emptyLive(), rev: 3, look: { id: 'x' } }], ['array', [1, 2]], ['json', '{"rev": ']]) {
    const { hub, warnings } = await hubOn(name, saved);
    assert.deepEqual(hub.live, emptyLive(), name);
    assert.equal(warnings.length, 1, name);
    await hub.close();
  }
});

test('the save at shutdown goes through a temporary', async () => {
  const { hub, dataDir } = await hubOn('close', { ...emptyLive(), rev: 2 });
  hub.piDrove();
  await hub.close();
  assert.deepEqual(fs.readdirSync(dataDir), ['live.json']);
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'live.json'), 'utf8'));
  assert.equal(saved.rev, 3);
  assert.equal(saved.driver, 'pi');
});
