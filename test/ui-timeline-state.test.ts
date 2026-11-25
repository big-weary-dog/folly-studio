// The timeline on the Studio's state (public/js/ui/timeline/state.ts), without a browser: zoom, clips added and
// removed, a drag shown before the look has it, snapping, and a look imported after this one.
import assert from 'node:assert/strict';

import { computed, signal } from '@preact/signals';
import { describe, test } from 'vitest';

import type { Preview } from '../public/js/ui/studio/preview.ts';
import type { Layer } from '../public/js/ui/studio/model.ts';
import type { Draft, Studio } from '../public/js/ui/studio/store.ts';
import { createTimeline } from '../public/js/ui/timeline/state.ts';

/** The Studio's state as the timeline uses it: the look, the selection, edits. */
function fakeStudio(layers: Layer[], extra: Partial<Draft> = {}) {
  const look = signal({ id: 'x', title: 'T', summary: '', layers, duration: 30, bpm: null, shared: false,
    ...extra } as Draft);
  const selectedId = signal<string | null>(layers[0]?.id ?? null);
  const st = {
    look, selectedId, narrow: signal(false), clock: { t: 0 }, data: { rig: null },
    selected: computed(() => look.value.layers.find((l) => l.id === selectedId.value) || null),
    layerById: (id: string) => look.peek().layers.find((l) => l.id === id) || null,
    select: (id: string | null) => { selectedId.value = id; },
    edit: (fn: (l: Draft) => Partial<Draft>) => { look.value = { ...look.value, ...fn(look.value) }; },
    step: () => null, undoStep: () => {},
    editLayer: (id: string, fn: (l: Layer) => Partial<Layer>) => st.edit((L) => ({
      layers: L.layers.map((l) => (l.id === id ? { ...l, ...fn(l) } : l)) })),
  };
  return st as unknown as Studio;
}
const layer = (id: string, clips?: Layer['clips']): Layer => ({ id, title: id, groups: ['g'], blend: 'add', level: 1,
  modules: [{ id: 'm', kind: 'source', title: 'S', code: '', params: {} }], ...(clips ? { clips } : {}) });
const clip = (start: number, end: number) => ({ start, end, fadeIn: 0, fadeOut: 0 });

describe('the timeline on the Studio\'s state', () => {
  test('zoom: fits the view, never past 200 px a second, and spans clips past the end', () => {
    const st = fakeStudio([layer('a', [clip(0, 10), clip(40, 45)])]);
    const tl = createTimeline(st, {} as Preview);
    tl.viewW.value = 900;
    assert.equal(tl.span.value, 45, 'a clip past the look\'s end widens the view');
    assert.equal(tl.pps.value, 20);
    tl.fit.value = false;
    tl.zoomPps.value = 5;
    assert.equal(tl.pps.value, 20, 'never narrower than the fit');
    tl.zoomPps.value = 1000;
    assert.equal(tl.pps.value, 200);
    assert.equal(tl.contentW.value, 9000);
  });

  test('a clip a bar long at the playhead, selected; removing the last makes the layer always on', () => {
    const st = fakeStudio([layer('a')], { bpm: 120 });
    const tl = createTimeline(st, {} as Preview);
    tl.addClipAt(st.selected.peek(), 10.1);
    assert.deepEqual(st.look.peek().layers[0].clips, [clip(10, 12)], 'snapped to ¼ s, a 2 s bar at 120 bpm');
    assert.deepEqual(tl.selected.peek()?.clip, clip(10, 12));
    tl.removeSelected();
    assert.equal(st.look.peek().layers[0].clips, undefined);
    assert.equal(tl.selected.peek(), null);
  });

  test('a drag shows before the look has it; the selection follows the selected layer', () => {
    const st = fakeStudio([layer('a', [clip(0, 4)]), layer('b', [clip(1, 2)])]);
    const tl = createTimeline(st, {} as Preview);
    tl.drag.value = { id: 'a', clips: [clip(2, 6)] };
    assert.deepEqual(tl.clipsOf(st.look.peek().layers[0]), [clip(2, 6)]);
    assert.deepEqual(st.look.peek().layers[0].clips, [clip(0, 4)]);
    tl.selectClip('b', 0);
    assert.equal(st.selectedId.peek(), 'b');
    assert.deepEqual(tl.selected.peek()?.clip, clip(1, 2));
    st.select('a');
    assert.equal(tl.selected.peek(), null, 'another layer: no clip');
  });

  test('without a tempo, beat snapping goes back to the grid', () => {
    const st = fakeStudio([layer('a')], { bpm: 100 });
    const tl = createTimeline(st, {} as Preview);
    tl.setSnap('beat');
    assert.equal(tl.step(), 0.6);
    tl.setBpm(null);
    assert.deepEqual([st.look.peek().bpm, tl.snap.peek(), tl.step()], [null, 'grid', 0.25]);
    tl.setBpm(120);
    tl.setSnap('beat');
    assert.equal(tl.step(), 0.5);
    tl.setSnap('off');
    assert.equal(tl.step(), 0);
  });

  test('importing a look appends it after this one, and says why when it cannot', () => {
    const st = fakeStudio([layer('a')]);
    const tl = createTimeline(st, {} as Preview);
    assert.equal(tl.importLook({ title: 'O', duration: 10, layers: [] }), 'That look has no layers.');
    const other = { title: 'O', duration: 10 };
    assert.equal(tl.importLook({ ...other, layers: [layer('z')] }), '');
    const L = st.look.peek();
    assert.equal(L.duration, 40);
    assert.deepEqual(L.layers.map((l) => l.clips), [[clip(0, 30)], [clip(30, 40)]]);
    assert.equal(st.selectedId.peek(), L.layers[1].id);
  });
});
