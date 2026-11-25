// A bug report's captured Studio is an account's data: the replay sets only what parses and fits
// (public/js/ui/bug-report/captured.ts).
import assert from 'node:assert/strict';

import { test } from 'vitest';

Object.assign(globalThis, { matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) });
const { parseCaptured } = await import('../public/js/ui/bug-report/captured.ts');

const draft = { title: 'Mine', layers: [{ id: 'a' }] };

test('a report with no draft to open is not the Studio\'s', () => {
  for (const studio of [undefined, null, 'cut at 64,000 characters', [], { draft: {} }, { draft: { layers: 'x' } }]) {
    assert.equal(parseCaptured(studio), null, JSON.stringify(studio));
  }
});

test('what was captured comes back as it was', () => {
  const c = parseCaptured({ draft,
    selection: { layer: 'a', picked: { a: 'm1' }, muted: ['a'], solo: [] },
    layout: { dock: 'look', tab: 'time', side: 'params', folded: true },
    timeline: { sel: { id: 'c1', index: 2 }, fit: false, zoomPps: 40 },
    clock: { t: 12.5, playing: true, speed: 2, baked: true },
    preview: { view: 'front', mode: 'playa', quality: 'lite', venue: false } })!;
  assert.deepEqual(c.draft, draft);
  assert.deepEqual(c.selection, { layer: 'a', picked: { a: 'm1' }, muted: new Set(['a']), solo: new Set() });
  assert.deepEqual(c.layout, { dock: 'look', tab: 'time', side: 'params', folded: true });
  assert.deepEqual(c.timeline, { sel: { id: 'c1', index: 2 }, fit: false, zoomPps: 40 });
  assert.deepEqual(c.clock, { t: 12.5, speed: 2, baked: true });
  assert.deepEqual(c.preview, { view: 'front', mode: 'playa', quality: 'lite', venue: false });
});

test('a piece of the wrong shape or past its bounds is left out, not applied', () => {
  const c = parseCaptured({ draft,
    selection: { layer: { id: 'a' }, picked: { a: 7, b: 'm', ['k'.repeat(300)]: 'm' }, muted: 'a',
      solo: ['x', 3, 'y'.repeat(300), ...Array.from({ length: 900 }, (_, k) => `s${k}`)] },
    layout: { dock: 'side', tab: '__proto__', side: 1, folded: 'yes' },
    timeline: { sel: { id: 'c1', index: -1 }, fit: 1, zoomPps: 1e9 },
    clock: { t: -3, speed: 1000, baked: 'yes' },
    preview: { view: 'v'.repeat(65), mode: 'webgpu', quality: 'ultra', venue: 'on' } })!;
  assert.deepEqual(c.selection.picked, { b: 'm' });
  assert.equal(c.selection.layer, undefined);
  assert.equal(c.selection.muted, undefined);
  assert.equal(c.selection.solo!.size, 498, 'the first 500, less the 2 that are not ids');
  assert.deepEqual(Object.values(c.layout), [undefined, undefined, undefined, undefined]);
  assert.deepEqual(c.timeline, { sel: undefined, fit: undefined, zoomPps: undefined });
  assert.deepEqual(c.clock, { t: 0, speed: 1, baked: false });
  assert.deepEqual(Object.values(c.preview), [undefined, undefined, undefined, undefined]);
  assert.equal(parseCaptured({ draft, selection: { layer: null }, timeline: { sel: null } })!.timeline.sel, null);
});
