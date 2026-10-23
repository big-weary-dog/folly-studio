// pi/src/library.ts: the Pi plays our library's code only, by ref, and says why a look cannot play; the shipped looks
// all play, light the sculpture and never trip the flash guard at their defaults (pushed: library-controls.test.ts).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, test } from 'vitest';

import { type PiLook, readLooks, resolveLook } from '../src/library.ts';
import { engineOn, lib, LOOKS, oneModule, shipped } from './fixture.ts';

describe('the library', () => {
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

  test('malformed local layers and timing cannot be advertised as playable', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pi-invalid-'));
    for (const [field, value] of Object.entries({ groups: 42, clips: [{ start: 2, end: 1 }],
      level: 'bright', soften: { radius: -1 }, modules: [null] })) {
      writeFileSync(path.join(dir, 'safe.json'), JSON.stringify({
        layers: [{ modules: [{ ref: 'clouds' }], [field]: value }],
      }));
      const entry = readLooks([LOOKS, dir], lib).get('safe')!;
      assert.equal(entry.look, null, field);
      assert.ok(entry.error, field);
    }
    for (const more of [{ duration: -1 }, { duration: 'long' }, { bpm: NaN }]) {
      assert.throws(() => oneModule('bad', 'clouds', {}, more));
    }
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
});
