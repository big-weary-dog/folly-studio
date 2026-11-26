// What the sandbox says, as the Studio shows it (public/js/ui/studio/layer-status.ts): what upgrade() changed, and
// each module's compile report.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { upgradedOf } from '../public/js/ui/params/bindings.ts';
import { createLayerStatus } from '../public/js/ui/studio/layer-status.ts';
import type { Layer } from '../public/js/ui/studio/model.ts';

const layer = (id: string): Layer => ({ id, title: id, groups: ['g'], blend: 'add', level: 1, modules: [] });

describe('what the sandbox says', () => {
  test('Settings shows what upgrade() changed while the saved value is still what it changed', () => {
    const schema = { direction: {}, often: {} }, up = { direction: ['round', 'clockwise'], often: [undefined, 60],
      gone: [undefined, 1] };
    assert.deepEqual(upgradedOf(up, schema, { direction: 'round' }), { direction: 'clockwise', often: 60 });
    assert.deepEqual(upgradedOf(up, schema, { direction: 'up', often: 30 }), {}, 'edited since: the edit wins');
    assert.deepEqual(upgradedOf('junk', schema, {}), {});
  });

  const m = { id: 'm', kind: 'source' as const, title: 'S', ref: 'r', params: {} };
  const L: Layer = { ...layer('a'), modules: [m] };
  const reply = (ok: boolean) => [{ id: 'a', ok, params: {}, modules: [{ id: 'm', ok,
    ...(ok ? { params: { k: { value: 1 } } } : { params: {}, error: 'SyntaxError' }) }] }];

  test('a module is compiling until its report, then as reported', () => {
    const status = createLayerStatus(() => L, () => false);
    assert.equal(status.module('a', m).kind, 'pending');
    assert.equal(status.params('a', m).note, 'Compiling…');
    status.compiled(reply(false));
    assert.equal(status.of('a').kind, 'compile');
    assert.deepEqual(status.problem('a', m), { kind: 'compile', message: 'SyntaxError' });
    assert.equal(status.params('a', m).schema, null);
    status.compiled(reply(true));
    assert.equal(status.of('a').kind, 'ok');
    assert.deepEqual(status.params('a', m), { schema: { k: { value: 1 } }, note: '', upgraded: undefined });
  });
});
