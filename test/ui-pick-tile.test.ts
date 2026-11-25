// The pick tile's edits (public/js/ui/params/pick-model.ts): a pick read, edited and stored back, and custom colours.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import {
  addColour, CUSTOM_MAX, editText, editValue, readEdit, toggleRole, toggleSlot, toggleToken,
} from '../public/js/ui/params/pick-model.ts';

describe('the pick tile', () => {
  test('a pick read, edited by role, slot and token, and stored back with only what differs', () => {
    const e = readEdit(undefined, 'body/accent');
    assert.deepEqual([e.tokens, e.deal], [['body', 'accent'], true]);
    assert.equal(editValue(e, 'step'), 'body/accent');
    const one = toggleSlot(e, 'body', 2, 4);
    assert.equal(editText(one), 'body1 body3 body4/accent', 'a slot out of a whole role: the others');
    assert.equal(editText(toggleSlot(readEdit(undefined, 'all'), 'accent', 1, 3)), 'accent1', 'over all: just it');
    assert.equal(editText(toggleRole(one, 'body')), 'body/accent', 'the whole role back, in its place');
    assert.equal(editText({ ...toggleToken(one, '#ff0000'), deal: false }), 'body1 body3 body4 accent #ff0000');
    assert.equal(editValue(toggleRole(toggleRole(e, 'body'), 'accent'), 'step'), undefined, 'nothing: the default');
    const opts = readEdit({ pick: 'all', blend: 'smooth', range: [0.2, 0.8], rotate: { mod: 'lfo', rate: 1 } }, 'low');
    assert.deepEqual(editValue(opts, 'smooth'), { pick: 'all', range: [0.2, 0.8], rotate: { mod: 'lfo', rate: 1 } });
    assert.deepEqual(editValue({ ...opts, blend: 'step', range: [0, 1], rotate: undefined }, 'smooth'),
      { pick: 'all', blend: 'step' });
    assert.deepEqual(readEdit('banana', 'high').tokens, ['high'], 'a bad value: the default');
  });

  test('a custom colour is added once, at the end, up to 4, in place of the whole palette or rainbow', () => {
    const red = addColour(readEdit(undefined, 'all'), '#ca1c1c');
    assert.equal(editValue(red, 'step'), '#ca1c1c', 'over all: just it, so it plays');
    assert.equal(editText(addColour(readEdit('rainbow body2', 'all'), '#00ff00')), 'body2 #00ff00');
    assert.equal(editText(addColour(red, '#ca1c1c')), '#ca1c1c', 'already there: kept once');
    assert.equal(editText(addColour(red, '#0000ff')), '#ca1c1c #0000ff');
    const four = ['#000001', '#000002', '#000003'].reduce(addColour, red);
    assert.equal(editText(addColour(four, '#ffffff')), editText(four), `at ${CUSTOM_MAX}: no more`);
    const five = '#000001 #000002 #000003 #000004 #000005 low';
    assert.equal(editText(addColour(readEdit(five, 'all'), '#ffffff')), five, 'more from code: kept as they are');
  });
});
