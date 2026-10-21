// The engine's queue (SPEC-offline "Playing on the lights"): each queued look plays its whole pattern once, fading out
// over its last second and the next in over its first; nothing queued, what plays loops on; play now, next and end;
// a flash-guard trip pauses the queue until a person goes on.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { FADE, MAX_QUEUE } from '../src/engine.ts';
import { engineOn, oneModule } from './fixture.ts';

const short = (id: string, duration: number) => oneModule(id, 'clouds', {}, { duration });

describe('the queue', () => {
  test('each look plays whole, then the next, fading out over its last second and in over the next\'s first', () => {
    const r = engineOn([short('a', 4), short('b', 3)]);
    r.engine.play('a');
    r.run(FADE.queue + 0.5);
    assert.equal(r.engine.state().look?.id, 'a');
    assert.equal(r.engine.state().look?.left, null);       // nothing queued: it loops on
    r.engine.queue('b');
    r.engine.queue('fire', 'end', 'ana');
    assert.deepEqual(r.engine.state().queue.map((q) => [q.id, q.kind, q.by]),
      [['b', 'look', undefined], ['fire', 'look', 'ana']]);
    const left = r.engine.state().look!.left!;
    r.run(left - FADE.queue - 0.1);
    assert.equal(r.engine.state().gain, 1);               // the pattern plays at full until its last second
    r.run(FADE.queue / 2 + 0.1);
    assert.ok(r.engine.state().gain < 0.6);
    assert.equal(r.engine.state().switching?.id, 'b');
    r.run(FADE.queue / 2 + 0.05);
    const s = r.engine.state();
    assert.equal(s.look?.id, 'b');
    assert.ok(s.look!.t < 0.1 && s.gain < 0.2, `${s.look!.t} ${s.gain}`);   // from its top, fading in
    assert.deepEqual(s.queue.map((q) => q.id), ['fire']);
    r.run(3);
    assert.equal(r.engine.state().look?.id, 'fire');
    r.run(40);
    assert.equal(r.engine.state().look?.id, 'fire');       // the queue ran out: the last loops on
  });

  test('now plays at once, next goes first, end last; move, unqueue and a full queue', () => {
    const r = engineOn([short('a', 30)]);
    r.engine.play('a');
    r.run(1.5);
    r.engine.queue('fire');
    r.engine.queue('beat-bars', 'next');
    assert.deepEqual(r.engine.state().queue.map((q) => q.id), ['beat-bars', 'fire']);
    const [first, second] = r.engine.state().queue;
    assert.equal(r.engine.move(second!.key, 0), true);
    assert.deepEqual(r.engine.state().queue.map((q) => q.id), ['fire', 'beat-bars']);
    assert.equal(r.engine.unqueue(first!.key), true);
    assert.equal(r.engine.queue('nope'), false);
    r.engine.queue('heartbeat-plasma', 'now');
    r.run(FADE.queue + 0.1);
    assert.equal(r.engine.state().look?.id, 'heartbeat-plasma');
    assert.deepEqual(r.engine.state().queue.map((q) => q.id), ['fire']);
    assert.equal(r.engine.next(), true);
    r.run(FADE.queue + 0.1);
    assert.equal(r.engine.state().look?.id, 'fire');
    assert.equal(r.engine.next(), false);
    for (let i = 0; i < MAX_QUEUE; i++) assert.equal(r.engine.queue('safe'), true);
    assert.equal(r.engine.queue('safe'), false);
  });

  test('a look Studio sent plays as live, with its controls', () => {
    const r = engineOn();
    r.engine.play('fire');
    r.run(1.5);
    const mine = oneModule('abc123', 'bars', {}, { title: 'Mine', globals: { macros: { pace: { value: 0.3 } } } });
    assert.equal(r.engine.send(mine, 'now', 'ana'), true);
    r.run(FADE.queue + 0.1);
    const s = r.engine.state();
    assert.deepEqual([s.look?.id, s.look?.title, s.look?.kind], ['abc123', 'Mine', 'live']);
    assert.deepEqual(s.look?.controls.map((c) => c.name), ['pace', 'palette']);
  });

  test('a flash-guard trip pauses the queue until a person goes on', () => {
    const r = engineOn([oneModule('strobe', 'strobe', { speed: 12 }, { duration: 8 })]);
    r.engine.play('strobe');
    r.engine.queue('fire');
    r.run(4);
    let s = r.engine.state();
    assert.deepEqual([s.look?.id, s.paused, s.look?.left], ['safe', true, null]);
    r.run(40);
    assert.equal(r.engine.state().look?.id, 'safe');
    assert.equal(r.engine.next(), true);
    r.run(FADE.queue + 0.1);
    s = r.engine.state();
    assert.deepEqual([s.look?.id, s.paused, s.tripped], ['fire', false, null]);
  });
});
