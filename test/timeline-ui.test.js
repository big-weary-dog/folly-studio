// The timeline editor's pure edits (public/js/ui/timeline-model.ts): every edit keeps clips
// sorted, apart and inside their neighbours, so what the editor makes the API accepts.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import {
  addClip, cleanBpm, cleanDuration, clock, contentEnd, editClip, fadeClip, importLook,
  MIN_CLIP, moveClip, removeClip, rulerStep, shownFades, snapStep, trimClip,
} from '../public/js/ui/timeline-model.ts';
import { MAX_CLIPS } from '../public/js/core/timeline.js';
import { validateLayers } from '../src/api-looks.ts';

const clip = (start, end, fadeIn = 0, fadeOut = 0) => ({ start, end, fadeIn, fadeOut });
const THREE = [clip(0, 2), clip(4, 6, 0.5, 0.5), clip(10, 12)];
/** The API takes it unchanged. */
const accepted = (clips) => assert.deepEqual(validateLayers([{ code: 'function pixel() {}', clips }])[0].clips, clips);

describe('editing clips', () => {
  test('move keeps the length and stays between the neighbours', () => {
    assert.deepEqual(moveClip(THREE, 1, 5)[1], clip(5, 7, 0.5, 0.5));
    assert.deepEqual(moveClip(THREE, 1, 1)[1], clip(2, 4, 0.5, 0.5), 'stops at the clip before');
    assert.deepEqual(moveClip(THREE, 1, 9)[1], clip(8, 10, 0.5, 0.5), 'stops at the clip after');
    assert.deepEqual(moveClip(THREE, 0, -3)[0], clip(0, 2), 'not before 0');
    assert.deepEqual(moveClip(THREE, 2, 700)[2], clip(598, 600), 'not past 600 s');
    assert.deepEqual(moveClip(THREE, 2, 700, 0, 30)[2], clip(28, 30), 'not past the look\'s end');
    assert.deepEqual(moveClip([clip(28, 40)], 0, 50, 0, 30)[0], clip(28, 40), 'unless it already reaches further');
    assert.deepEqual(trimClip(THREE, 2, 'end', 50, 0, 30)[2], clip(10, 30));
    assert.equal(addClip(THREE, 31, 4, 0, 30), null, 'nothing added after the end');
    assert.deepEqual(addClip(THREE, 29, 4, 0, 30).clips[3], clip(26, 30));
    assert.deepEqual(THREE[1], clip(4, 6, 0.5, 0.5), 'the input is untouched');
    accepted(moveClip(THREE, 1, 9));
  });

  test('move snaps whichever edge is nearer the grid', () => {
    const odd = [clip(0, 1.3)];
    assert.deepEqual(moveClip(odd, 0, 1.05, 0.25)[0], clip(1, 2.3));    // start 1.05 → 1
    assert.deepEqual(moveClip(odd, 0, 0.94, 0.25)[0], clip(0.95, 2.25)); // end 2.24 → 2.25
  });

  test('trim moves one edge, keeps MIN_CLIP and the neighbours', () => {
    assert.deepEqual(trimClip(THREE, 1, 'start', 3)[1], clip(3, 6, 0.5, 0.5));
    assert.deepEqual(trimClip(THREE, 1, 'start', 1)[1], clip(2, 6, 0.5, 0.5));
    assert.deepEqual(trimClip(THREE, 1, 'start', 6.5)[1].start, 6 - MIN_CLIP);
    assert.deepEqual(trimClip(THREE, 1, 'end', 20)[1], clip(4, 10, 0.5, 0.5));
    assert.deepEqual(trimClip(THREE, 1, 'end', 7.1, 0.25)[1].end, 7);
    const tiny = trimClip(THREE, 1, 'end', 4)[1];
    assert.equal(tiny.end, 4 + MIN_CLIP);
    accepted(trimClip(THREE, 1, 'end', 20));
  });

  test('trimming keeps the fades as written; they play shrunk, and come back when the clip grows', () => {
    const long = [clip(4, 10, 2, 3)];
    const short = trimClip(long, 0, 'end', 4.5);
    assert.deepEqual(short[0], clip(4, 4.5, 2, 3));
    const [fi, fo] = shownFades(short[0]);
    assert.ok(Math.abs(fi - 0.2) < 1e-9 && Math.abs(fo - 0.3) < 1e-9, 'shown in proportion, as they play');
    assert.deepEqual(trimClip(short, 0, 'end', 12)[0], clip(4, 12, 2, 3));
    assert.deepEqual(shownFades(clip(0, 10, 2, 3)), [2, 3]);
    accepted(short);
  });

  test('fades stay inside the clip', () => {
    assert.equal(fadeClip(THREE, 1, 'in', 1)[1].fadeIn, 1);
    assert.equal(fadeClip(THREE, 1, 'in', 5)[1].fadeIn, 1.5, 'leaves room for the fade out');
    assert.equal(fadeClip(THREE, 1, 'out', -1)[1].fadeOut, 0);
    assert.equal(fadeClip(THREE, 1, 'out', 0.6, 0.25)[1].fadeOut, 0.5);
  });

  test('typed numbers: clamped to the neighbours; nonsense refused', () => {
    assert.deepEqual(editClip(THREE, 1, { start: 3, end: 8 })[1], clip(3, 8, 0.5, 0.5));
    assert.deepEqual(editClip(THREE, 1, { start: 0, end: 99 })[1], clip(2, 10, 0.5, 0.5));
    assert.deepEqual(editClip(THREE, 1, { start: 5, end: 4 })[1], clip(4, 5, 0.5, 0.5), 'both reversed: swapped');
    assert.equal(editClip(THREE, 1, { start: 5, end: 5 }), null);
    assert.equal(editClip(THREE, 1, { start: 'soon' }), null);
  });

  test('typed edges in any order: one past the other moves the clip, never a sliver', () => {
    // The phone repro: a clip at 0-10.35 s, fades 1 and 2; Start 9, then End 8.
    let c = editClip([clip(0, 10.35, 1, 2)], 0, { start: 9 });
    assert.deepEqual(c[0], clip(9, 10.35, 1, 2));
    c = editClip(c, 0, { end: 8 });
    assert.deepEqual(c[0], clip(6.65, 8, 1, 2), 'moved back to end at 8, same length, same fades');
    assert.deepEqual(editClip(c, 0, { start: 0 })[0], clip(0, 8, 1, 2));
    // A new clip placed late, then End typed before Start: the same result as Start first.
    const late = [clip(12, 16)];
    const endFirst = editClip(editClip(late, 0, { end: 8 }), 0, { start: 0 });
    const startFirst = editClip(editClip(late, 0, { start: 0 }), 0, { end: 8 });
    assert.deepEqual(endFirst, startFirst);
    assert.deepEqual(endFirst[0], clip(0, 8));
    // Moving still stops at the neighbours and keeps the length.
    assert.deepEqual(editClip(THREE, 1, { start: 7 })[1], clip(7, 9, 0.5, 0.5));
    assert.deepEqual(editClip(THREE, 1, { start: 11 })[1], clip(8, 10, 0.5, 0.5));
    assert.deepEqual(editClip(THREE, 1, { end: 1 })[1], clip(2, 4, 0.5, 0.5));
    accepted(c);
  });

  test('add goes into the gap that holds the time, never over a clip', () => {
    const a = addClip(THREE, 7, 2);
    assert.equal(a.index, 2);
    assert.deepEqual(a.clips[2], clip(7, 9));
    assert.deepEqual(addClip(THREE, 9.5, 2).clips[2], clip(8, 10), 'shifted left to fit');
    assert.deepEqual(addClip(THREE, 7, 9).clips[2], clip(6, 10), 'shortened to the gap');
    assert.equal(addClip(THREE, 5, 4), null, 'inside a clip');
    assert.deepEqual(addClip([], 3.1, 4, 0.25).clips, [clip(3, 7)]);
    assert.deepEqual(addClip(undefined, 0, 4).clips, [clip(0, 4)]);
    const full = Array.from({ length: MAX_CLIPS }, (_, i) => clip(i, i + 0.5));
    assert.equal(addClip(full, 100), null);
    accepted(addClip(THREE, 13, 4).clips);
  });

  test('remove, contentEnd', () => {
    assert.deepEqual(removeClip(THREE, 1), [clip(0, 2), clip(10, 12)]);
    assert.equal(contentEnd([{ clips: THREE }], 30), 12);
    assert.equal(contentEnd([{ clips: THREE }, { code: '' }], 30), 30, 'an always-on layer fills the duration');
  });
});

describe('importing a look', () => {
  let n = 0;
  const newId = () => `new${++n}`;
  const base = { id: 'a', title: 'A', groups: ['cathedral'], params: {} };
  const other = (layers, duration) => ({ duration, layers });

  test('appends after the current content; always-on layers end there', () => {
    const r = importLook([base], 30, other([{ id: 'x', title: 'X', groups: ['spires'] }], 20), newId);
    assert.equal(r.start, 30);
    assert.equal(r.end, 50);
    assert.equal(r.duration, 50);
    assert.equal(r.ended, 1);
    assert.deepEqual(r.layers[0].clips, [clip(0, 30)]);
    assert.equal(r.layers[1].id, 'new1');
    assert.deepEqual(r.layers[1].clips, [clip(30, 50)]);
    const saved = validateLayers(r.layers.map((l) => ({ ...l, code: '' })));
    assert.deepEqual(saved.map((l) => l.clips), [[clip(0, 30)], [clip(30, 50)]]);
  });

  test('keeps the imported layers\' own clips, shifted and cut to its duration', () => {
    const mine = [{ ...base, clips: [clip(0, 8)] }];
    const theirs = other([{ id: 'x', clips: [clip(1, 3, 1), clip(9, 40)] }], 10);
    const r = importLook(mine, 30, theirs, newId);
    assert.equal(r.start, 8);
    assert.equal(r.ended, 0);
    assert.deepEqual(r.layers[0].clips, [clip(0, 8)], 'clipped layers are left alone');
    assert.deepEqual(r.layers[1].clips, [clip(9, 11, 1), clip(17, 18)]);
    assert.equal(r.duration, 30, 'the look is already long enough');
  });

  test('refuses more than 8 layers, an empty look, and a full timeline', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...base, id: `l${i}` }));
    assert.match(importLook(seven, 30, other([{}, {}], 10), newId).error, /at most 8 layers/);
    assert.match(importLook([base], 30, other([], 10), newId).error, /no layers/);
    assert.match(importLook([{ ...base, clips: [clip(0, 600)] }], 600, other([{}], 10), newId).error, /600 s/);
  });
});

test('small helpers', () => {
  assert.equal(cleanDuration('45.5'), 45.5);
  assert.equal(cleanDuration(0.2), 1);
  assert.equal(cleanDuration(9999), 600);
  assert.equal(cleanDuration('x'), 30);
  assert.equal(cleanBpm(''), null);
  assert.equal(cleanBpm(30), null);
  assert.equal(cleanBpm('128'), 128);
  assert.equal(snapStep('beat', 120), 0.5);
  assert.equal(snapStep('beat', null), 0.25, 'no tempo: the quarter-second grid');
  assert.equal(snapStep('off', 120), 0);
  assert.equal(rulerStep(100), 1);
  assert.equal(rulerStep(10), 10);
  assert.equal(clock(75.5), '1:15.5');
  assert.equal(clock(5), '0:05');
  assert.equal(clock(0.25), '0:00.25');
});
