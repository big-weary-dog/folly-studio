// A number as one field (public/js/ui/kit.tsx), without a browser: steps, drags, typed values and the decimals shown,
// soft bounds, and an automated macro's value now.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { laneNow } from '../public/js/ui/globals/look-globals.tsx';
import { decimals, exact, onSpan, places, scrubTo, snap } from '../public/js/ui/kit.tsx';
import { fmt } from '../public/js/ui/params/bindings.ts';

describe('a number as one field', () => {
  const r = { min: 5, max: 200, step: 1 };

  test('a value lands on the step from min, within min..max; a drag across the field spans the range', () => {
    assert.deepEqual([snap(90.4, r), snap(999, r), snap(-3, r), snap(0.37, { min: 0, max: 1, step: 0.25 })],
      [90, 200, 5, 0.25]);
    assert.equal(snap(0.01 + 37 * 0.01, { min: 0.01, max: 1, step: 0.01 }), 0.38, 'no float noise');
    assert.deepEqual([decimals(1), decimals(0.05), decimals(1e-7)], [0, 2, 4]);
    assert.deepEqual([scrubTo(60, 50, 100, r), scrubTo(60, -30, 100, r), scrubTo(60, 50, 100, r, true)], [158, 5, 70],
      'half the width: half the range; held to min; Shift: a tenth');
  });

  test('a typed value or a Shift-drag goes between the steps, and the field shows its decimals', () => {
    const fine = { min: 0, max: 2, step: 0.01 };
    assert.deepEqual([exact(0.003, fine), exact(0.0125, fine), exact(9, fine), exact(-1, fine)], [0.003, 0.0125, 2, 0],
      'kept as typed, held to min..max');
    assert.deepEqual([exact(30.6, r), exact(1, r)], [31, 5], 'a whole step (a count) stays whole');
    assert.deepEqual([scrubTo(0, 3, 200, fine, true), scrubTo(0.003, 2, 200, fine, true), scrubTo(0.003, 2, 200, fine)],
      [0.003, 0.005, 0.02], 'Shift: on a grid a tenth of the step, from where it started; else on the step');
    assert.deepEqual([places(0.003, 0.01), places(0.5, 0.01), places(0.0125, 0.01), places(1 / 3, 0.01), places(7, 1)],
      [3, 2, 4, 6, 0]);
    assert.deepEqual([fmt(0.0025), fmt(0.05), fmt(1 / 3), fmt(120.12345)], ['0.0025', '0.05', '0.333', '120.123'],
      'the popover\'s From/To keep a small end');
    assert.deepEqual([onSpan(0.0123456, 0.05), onSpan(0.5004, 1), onSpan(37.26, 100)], [0.01235, 0.5, 37.3],
      'a lane\'s value to a thousandth of its span');
    const drift = { value: 0, min: 0, max: 0.05 }, look = { layers: [], globals: { macros: { drift } },
      automation: { drift: [[0, 0], [16, 0.05]] } } as unknown as Parameters<typeof laneNow>[0];
    assert.deepEqual([laneNow(look, 'drift', drift, 2), laneNow(look, 'drift', drift, 16)], [0.00625, 0.05],
      'an automated macro reads its lane now, not its stored 0');
  });

  test('soft bounds keep dragging familiar while typing reaches the hard bounds', () => {
    const r = { min: -8, max: 8, soft: [-2, 2] as [number, number], step: 0.01 };
    assert.equal(scrubTo(0, 50, 100, r), 2);
    assert.equal(scrubTo(0, -100, 100, r), -2);
    assert.equal(scrubTo(0, 1000, 100, r, true), 2);
    assert.equal(scrubTo(-6, 25, 100, r), -1, 'a drag starts from the pinned end');
    assert.equal(exact(-6, r), -6);
    assert.equal(exact(-20, r), -8);
  });
});
