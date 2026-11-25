// The shipped looks pushed: left alone or pushed anywhere in its range, and tapped to a dance floor's tempo, a look
// stays clear of the flash guard. The person picked it, and the safe look cutting in mid-set is for a mistake.
import assert from 'node:assert/strict';

import { test } from 'vitest';

import { engineOn, shipped } from './fixture.ts';

// Each control as it is, at its low end, its high end, or alternating. Each end's looks run in `parts` files, part
// `part` taking every parts-th look, so the matrix spreads over the test processes.
const ends = { default: null, low: () => 0, high: () => 1, alternate: (k: number) => k % 2 };
export function controls(end: keyof typeof ends, part = 0, parts = 1) {
  const looks = [...shipped().keys()].filter((_, i) => i % parts === part);
  test.each(looks)('%s with its controls ' + end + ', tapped, plays 30 s without a flash', (id) => {
    const r = engineOn();
    r.engine.play(id);
    r.run(7);
    const bpm = { default: 120, low: 90, high: 150, alternate: 120 }[end], at = ends[end];
    r.engine.state().look!.controls.forEach((c, k) => {
      if (at && c.kind === 'macro') r.engine.set(c.name, c.min + at(k) * (c.max - c.min));
    });
    // The tempo as the page sets it: four taps, each one a downbeat, so the beat restarts mid-pulse.
    for (let i = 0; i < 4; i++) { r.engine.tap(i * 60_000 / bpm); r.run(60 / bpm); }
    r.run(30);
    assert.equal(r.engine.state().tripped, null);
  }, 60_000);
}
