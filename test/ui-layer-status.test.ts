// What the sandbox says, as the Studio shows it (public/js/ui/studio/layer-status.ts): what upgrade() changed, and a
// broken edit keeping the last good code running.
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

  const m = { id: 'm', kind: 'source' as const, title: 'S', code: 'good', params: {} };
  const L: Layer = { ...layer('a'), modules: [m] };
  const reply = (code: string, ok: boolean) => [{ id: 'a', ok, params: {}, modules: [{ id: 'm', ok, code,
    ...(ok ? { params: { k: { value: 1 } } } : { params: {}, error: 'SyntaxError' }) }] }];

  test('a broken edit keeps the last good code running, once, and says so', () => {
    let look = L;
    const status = createLayerStatus(() => look, () => false);
    assert.equal(status.compiled(reply('good', true)), false);
    assert.equal(status.of('a').kind, 'ok');
    look = { ...L, modules: [{ ...m, code: 'bad' }] };
    assert.equal(status.module('a', look.modules[0]).kind, 'pending');
    assert.equal(status.compiled(reply('bad', false)), true, 'send the look again, with the good code');
    assert.equal(status.codeFor('a', look.modules[0]), 'good');
    assert.deepEqual(status.problem('a', look.modules[0]), { kind: 'compile', message: 'SyntaxError', running: true });
    assert.equal(status.compiled(reply('good', true)), false, 'the good code compiles: no loop');
    assert.equal(status.of('a').kind, 'compile', 'the module is still broken');
    assert.deepEqual(status.params('a', look.modules[0]),
      { schema: { k: { value: 1 } }, note: '', upgraded: undefined });
    look = L;
    assert.equal(status.of('a').kind, 'ok', 'fixed');
  });
});
