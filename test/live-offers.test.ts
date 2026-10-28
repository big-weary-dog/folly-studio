import assert from 'node:assert/strict';
import { test } from 'vitest';
import { offersOf } from '../public/js/ui/look-offers.tsx';
import type { Module } from '../shared/schemas/look.ts';
import type { Layer } from '../public/js/ui/model.ts';

const module = (id: string, more: Partial<Module> = {}): Module => ({ id, kind: 'source', title: id,
  code: '', params: {}, live: ['mode'], ...more });
const layer = (id: string, modules: Module[], more: Partial<Layer> = {}): Layer => ({ id, title: id,
  modules, blend: 'add', level: 1, ...more });
const schema = () => ({ mode: { type: 'choice', value: 'along', options: ['along', 'bounce'], label: 'Mode' } });

test('the overview omits disabled layers and attached settings, even with cached schemas', () => {
  const look = { globals: { macros: { drive: { value: 0.5, min: 0, max: 1 } } }, layers: [
    layer('off', [module('hidden')], { enabled: false }),
    layer('on', [module('visible'), module('disabled', { enabled: false }),
      module('attached', { kind: 'warp', on: 'disabled' })]),
  ] };
  assert.deepEqual(offersOf(look, schema), [
    { name: 'Drive', kind: 'Fader' }, { name: 'on · visible · Mode', kind: 'Choice' },
    { name: 'Palette', kind: 'Palette' },
  ]);
});
