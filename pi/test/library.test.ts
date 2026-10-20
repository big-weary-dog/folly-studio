// pi/src/library.ts: the Pi plays our library's code only, by ref, and says why a look cannot play; the shipped looks
// all play, light the sculpture and never trip the flash guard, at their defaults or pushed to their ends.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, test } from 'vitest';

import { type PiLook, readLooks, resolveLook } from '../src/library.ts';
import { engineOn, lib, LOOKS, oneModule, shipped } from './fixture.ts';

describe('the library', () => {
  test('has the sources, warps and filters, and a hash of them', () => {
    const kinds = new Set([...lib.entries.values()].map((e) => e.kind));
    assert.deepEqual([...kinds].sort(), ['filter', 'source', 'warp']);
    assert.ok(lib.entries.has('clouds') && lib.entries.has('blur'));
    assert.match(lib.hash, /^[0-9a-f]{12}$/);
  });

  test("a look's modules run the library's code, whatever code the look carries", () => {
    const look = resolveLook({ id: 'x', title: 'X', layers: [{ modules: [{ ref: 'clouds', code: 'evil()' }] }] } as
      PiLook, lib);
    assert.equal(look.layers[0]!.modules![0]!.code, lib.entries.get('clouds')!.code);
  });

  test('a module with no ref, or an unknown one, cannot play, and says so', () => {
    const one = (m: object) => () => resolveLook({ id: 'x', title: 'X', layers: [{ modules: [m] }] } as PiLook, lib);
    assert.throws(one({ code: 'function render() {}' }), /layer 1, module 1: not a library module/);
    assert.throws(one({ ref: 'no-such' }), /no library module no-such/);
    assert.throws(() => resolveLook({ id: 'x', title: 'X', layers: [] } as PiLook, lib), /needs an id and layers/);
  });

  test('globals are checked as Studio checks them, a palette by name resolved', () => {
    const look = oneModule('p', 'clouds', {}, { globals: { palette: 'ember' } });
    const pal = look.globals?.palette as { name: string, body: string[] };
    assert.equal(pal.name, 'ember');
    assert.ok(pal.body.length);
    assert.throws(() => oneModule('p', 'clouds', {}, { globals: { palette: 'nope' } }), /palette/);
    assert.throws(() => oneModule('p', 'clouds', {}, { globals: { live: ['nope'] } }), /globals/);
  });

  test("the Pi's own looks (a second dir) replace shipped ones by id; a broken file says why", () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pi-looks-'));
    mkdirSync(dir, { recursive: true });
    const mine = { title: 'Mine', layers: [{ modules: [{ ref: 'fire' }] }] };
    writeFileSync(path.join(dir, 'fire.json'), JSON.stringify(mine));
    writeFileSync(path.join(dir, 'broken.json'), '{');
    const looks = readLooks([LOOKS, dir, path.join(dir, 'missing')], lib);
    assert.equal(looks.get('fire')!.look!.title, 'Mine');
    assert.equal(looks.get('broken')!.look, null);
    assert.match(looks.get('broken')!.error!, /JSON/);
  });
});

describe('the shipped looks', () => {
  const looks = shipped();
  test('all play, the safe one among them', () => {
    for (const [id, l] of looks) assert.ok(l.look, `${id}: ${l.error}`);
    assert.ok(looks.has('safe'));
  });

  test.each([...looks.keys()])('%s lights the sculpture for 20 s without an error or a flash', (id) => {
    const r = engineOn();
    r.engine.play(id);
    r.run(20);
    const s = r.engine.state();
    assert.equal(s.look?.id, id);
    assert.equal(s.tripped, null);
    assert.equal(r.engine.stats.layerErrors, 0, r.engine.stats.lastError);
    assert.ok(r.lit() > 0);
  });

  // Left alone or pushed anywhere in its range, and tapped to a dance floor's tempo, a look stays clear of the guard:
  // the person picked it, and the safe look cutting in mid-set is for a mistake. Each control as it is, at its low end,
  // its high end, or alternating.
  const ends = { default: null, low: () => 0, high: () => 1, alternate: (k: number) => k % 2 };
  const cases = [...looks.keys()].flatMap((id) =>
    (['default', 'low', 'high', 'alternate'] as const).map((e) => [id, e] as const));
  test.each(cases)('%s with its controls %s, tapped, plays 30 s without a flash', (id, end) => {
    const r = engineOn();
    r.engine.play(id);
    r.run(7);
    const bpm = { default: 120, low: 90, high: 150, alternate: 120 }[end], at = ends[end];
    r.engine.state().look!.controls.forEach((c, k) => {
      if (at && c.name !== 'level' && c.name !== 'bpm') r.engine.set(c.name, c.min + at(k) * (c.max - c.min));
    });
    // The tempo as the page sets it: four taps, each one a downbeat, so the beat restarts mid-pulse.
    for (let i = 0; i < 4; i++) { r.engine.tap(i * 60_000 / bpm); r.run(60 / bpm); }
    r.run(30);
    assert.equal(r.engine.state().tripped, null);
  }, 60_000);
});
