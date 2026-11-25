// How the Studio draws a layer's chain (public/js/ui/studio/model.ts): how each module joins the one above, and what
// each warp and filter reaches.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { chainWires, isStageEnd } from '../public/js/ui/studio/model.ts';
import type { Module } from '../shared/schemas/look.ts';

const mod = (id: string, kind: Module['kind'], extra: Partial<Module> = {}): Module => ({ id, kind, title: id, code: '',
  params: {}, ...extra });

test('each module joins the came; each warp and filter reaches everything above it, to a stage\'s start', () => {
  const { first, joins, reaches } = chainWires([mod('a', 'source'), mod('w', 'warp'),
    mod('c', 'source', { as: 'input' }), mod('f', 'filter', { input: 'c' }), mod('b', 'source', { blend: 'max' })]);
  assert.deepEqual([first, joins], [0, ['over', 'warp', 'input', 'filter', 'max']]);
  assert.deepEqual(reaches.map((x) => `${x.kind} ${x.from}-${x.to} ${x.lane}`),
    ['warp 0-1 1', 'filter 0-3 0', 'input 2-3 1'], 'the longest outermost, its input feed dashed inside');
  const trails = { code: "const stage = 'history';" };
  const staged = chainWires([mod('a', 'source'), mod('t', 'filter', trails), mod('b', 'source'),
    mod('w', 'warp'), mod('x', 'filter', { enabled: false }), mod('f', 'filter', { input: 'gone' })]);
  assert.deepEqual(staged.reaches.map((x) => `${x.kind} ${x.from}-${x.to} ${x.lane}`),
    ['filter 0-1 1', 'warp 1-3 1', 'filter 1-5 0'], 'trails ends a stage; an off module reaches nothing');
  assert.deepEqual(chainWires([mod('w', 'warp'), mod('a', 'source', { enabled: false })]), { first: -1,
    joins: ['warp', 'add'], reaches: [] }, 'a warp at the top has nothing above it');
  const blur = { code: "const spatial = 'blur';\nconst stage = 'spatial';" };
  assert.deepEqual([isStageEnd(mod('b', 'filter', blur)), isStageEnd(mod('b', 'source', blur)),
    isStageEnd(mod('b', 'filter', { ref: 'blur' }))], [true, false, false], 'the code says so, not the ref');
});
