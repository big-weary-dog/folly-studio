// Both rigs fresh from lighting, on the channels lighting drives, and palettes.json fresh.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { missingLighting } from './fixtures/sources.js';

const here = (p) => new URL(p, import.meta.url);

const LIGHTING = ['city-of-gods/pixel-map/out', 'city-of-gods/xlights-show', 'show-builder/pixel-map',
  'show-builder/xlights', 'falcon-backups'];
const python = (skip, ...args) => {
  const why = missingLighting(...LIGHTING);
  skip(!!why, why);
  const run = spawnSync('python3', ['-B', fileURLToPath(here(`../tools/${args[0]}`)), ...args.slice(1)],
    { encoding: 'utf8' });
  skip(run.error?.code === 'ENOENT', 'python3 not available');
  return run;
};

test('the rigs are fresh from lighting (build_rig.py --check)', ({ skip }) => {
  const run = python(skip, 'build_rig.py', '--check');
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});

test('the rigs are on the channels lighting drives: xLights, the Falcon (check_channels.py)', ({ skip }) => {
  const run = python(skip, 'check_channels.py');
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});

test('palettes.json is fresh (build_palettes.py --check), roles in order', ({ skip }) => {
  const pals = JSON.parse(readFileSync(here('../public/data/palettes.json'), 'utf8'));
  assert.deepEqual(pals.roles, ['low', 'body', 'accent', 'high']);
  assert.ok(pals.palettes.length >= 8 && pals.palettes.every((p) => p.body.length && p.low.length));
  const script = fileURLToPath(here('../tools/build_palettes.py'));
  const run = spawnSync('python3', [script, '--check'], { encoding: 'utf8' });
  skip(run.error?.code === 'ENOENT', 'python3 not available');
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});
