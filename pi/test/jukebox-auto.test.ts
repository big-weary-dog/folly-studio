// Jukebox on its own (SPEC-liveplay "Modes"): every change fades over FADE.jukebox each way (at most half the
// pattern), and with nothing queued the engine picks the next of its own looks, a seeded shuffle round by round.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { FADE } from '../src/engine.ts';
import { engineOn, oneModule } from './fixture.ts';

const short = (id: string, duration: number) => oneModule(id, 'colour-wash', { speed: 0 }, { duration });
const near = (v: number, to: number, why: string) => assert.ok(Math.abs(v - to) < 0.06, `${why}: ${v}`);

/** An engine in Jukebox on `looks` alone (and `safe`), playing the first. */
function jukebox(looks: ReturnType<typeof short>[]) {
  const r = engineOn(looks);
  for (const id of r.looks.keys()) if (id !== 'safe' && !looks.some((l) => l.id === id)) r.looks.delete(id);
  r.engine.setMode('jukebox');
  r.engine.play(looks[0]!.id, FADE.switch);
  r.run(FADE.switch * 2 + 0.05);
  return r;
}

/** The looks played over `secs`, in order. */
function played(r: ReturnType<typeof engineOn>, secs: number) {
  const ids: string[] = [];
  for (let i = 0; i < Math.round(secs * r.engine.fps); i++) {
    r.engine.tick();
    const id = r.engine.state().look!.id;
    if (ids.at(-1) !== id) ids.push(id);
  }
  return ids;
}

describe('Jukebox fades', () => {
  test('long to short to long uses each look\'s own fade and plays every short frame', () => {
    const r = jukebox([short('long', 12), short('short', 1)]);
    r.engine.queue('short');
    r.engine.queue('long');
    let frames = 0, peak = 0, incoming = 0;
    for (let i = 0; i < 16 * r.engine.fps; i++) {
      r.engine.tick();
      const s = r.engine.state();
      if (s.look?.id === 'short') { frames++; peak = Math.max(peak, s.gain); }
      else if (frames) { incoming++; }
      if (incoming === r.engine.fps) {
        near(s.gain, 0.25, 'one second into the long look\'s four second fade');
        break;
      }
    }
    assert.equal(frames, r.engine.fps);
    near(peak, 1, 'the short look reaches full gain');
    assert.equal(incoming, r.engine.fps);
  });
  test('out over the last FADE.jukebox of a pattern and in over the next one\'s first', () => {
    const r = jukebox([short('a', 12), short('b', 12)]);
    r.engine.queue('b');
    r.run(12 - FADE.jukebox - FADE.switch * 2 - 0.2);
    assert.equal(r.engine.state().gain, 1);
    r.run(FADE.jukebox / 2 + 0.1);
    near(r.engine.state().gain, 0.5, 'halfway out');
    r.run(FADE.jukebox / 2 + 0.1);
    assert.equal(r.engine.state().look?.id, 'b');
    r.run(FADE.jukebox / 2 - 0.1);
    near(r.engine.state().gain, 0.5, 'halfway in');
    r.run(FADE.jukebox / 2 + 0.1);
    assert.equal(r.engine.state().gain, 1);
  });

  test('a pattern shorter than two fades fades over half of it; Live Play keeps FADE.queue', () => {
    const r = jukebox([short('a', 4), short('b', 4)]);
    r.engine.queue('b');
    const at = (r.engine.state().look!.left ?? 0) - 2;
    r.run(at + 1);
    near(r.engine.state().gain, 0.5, 'a 2 s fade');
    r.engine.setMode('live');
    r.run(3);
    r.engine.queue('a');
    r.run(r.engine.state().look!.left! - FADE.queue / 2);
    near(r.engine.state().gain, 1, 'Live Play overlaps the looks without a dip in master gain');
  });
});

describe('Jukebox picks', () => {
  test('nothing queued: each of its own looks once a round, never safe, never twice in a row', () => {
    const r = jukebox([short('a', 2), short('b', 2), short('c', 2), short('d', 2)]);
    const ids = played(r, 2 * 13);
    assert.ok(ids.length >= 12, ids.join());
    assert.ok(!ids.includes('safe'));
    for (let i = 1; i < ids.length; i++) assert.notEqual(ids[i], ids[i - 1], ids.join());
    assert.deepEqual([...new Set(ids.slice(0, 5))].sort(), ['a', 'b', 'c', 'd'], ids.join());
    assert.ok(ids.some((id, i) => i > 0 && id < ids[i - 1]!), 'shuffled, not in order');
  });

  test('a round that starts with the look playing plays it last, not never', () => {
    const ids = played(jukebox([short('a', 2), short('b', 2), short('c', 2)]), 2 * 16 - 1);
    const count = (id: string) => ids.filter((x) => x === id).length;
    assert.deepEqual([count('a'), count('b'), count('c')], [6, 5, 5], ids.join());
  });

  test('the same seed picks the same order', () => {
    const one = played(jukebox([short('a', 2), short('b', 2), short('c', 2)]), 20);
    const two = played(jukebox([short('a', 2), short('b', 2), short('c', 2)]), 20);
    assert.deepEqual(one, two);
  });

  test('a queued look comes first; the only look loops on; Live Play picks nothing', () => {
    const r = jukebox([short('a', 2), short('b', 2)]);
    r.looks.set('c', { look: short('c', 2), file: '' });
    r.engine.queue('c');
    assert.equal(played(r, 2)[1], 'c');
    const one = jukebox([short('a', 2)]);
    assert.deepEqual(played(one, 7), ['a']);
    assert.equal(one.engine.next(), false);
    const live = jukebox([short('a', 2), short('b', 2)]);
    live.engine.setMode('live');
    assert.deepEqual(played(live, 7), ['a']);
    assert.equal(live.engine.state().look?.left, null);
  });

  test('Fade to next with nothing queued goes on to a pick; a flash-guard pause picks nothing', () => {
    const r = jukebox([short('a', 30), short('b', 30)]);
    assert.equal(r.engine.next(), true);
    r.run(FADE.jukebox * 2 + 0.1);
    assert.equal(r.engine.state().look?.id, 'b');
    const strobe = jukebox([oneModule('strobe', 'strobe', { speed: 12 }, { duration: 8 }), short('a', 8)]);
    strobe.run(3);
    assert.equal(strobe.engine.state().paused, true);
    assert.deepEqual(played(strobe, 20), ['safe']);
  });
});
