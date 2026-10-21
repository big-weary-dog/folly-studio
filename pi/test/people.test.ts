// pi/src/people.ts through the server (SPEC-liveplay "Modes", "People"): Jukebox refuses knobs, Blackout and Play
// now, whatever a page sends; only Studio's feed sets the mode, and entering Jukebox lets everything go; in Live
// Play one person has the knobs until someone takes over or their last page closes; watchers watch.
import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { JUKEBOX_NOW } from '../src/people.ts';
import type { PiState } from '../src/protocol.ts';
import { serve, socket } from './sockets.ts';

const settle = () => new Promise((r) => setTimeout(r, 60));
/** A page said hello as `who` (none: the Pi's own page), or Studio's feed. */
async function page(origin: string, who?: { name: string, drive: boolean } | 'feed') {
  const c = await socket(origin);
  c.send(who === 'feed' ? { type: 'hello', feed: true } : { type: 'hello', ...who ? { who } : {} });
  await c.next('state');
  /** Sends m; the error it brought, or '' when none came. */
  const ask = async (m: object) => {
    const from = c.got.length;
    c.send(m);
    await settle();
    const e = c.got.slice(from).find((x) => x.type === 'error');
    return e?.type === 'error' ? e.error : '';
  };
  const state = async () => ((await c.next('state', c.got.length)) as { state: PiState }).state;
  return { ...c, ask, state };
}

describe('Jukebox', () => {
  test('refuses knobs, Master, tempo, Blackout and Play now; queues and fades to next', async () => {
    const { origin, engine } = await serve('', { t: 0 }, '', 'jukebox');
    const cara = await page(origin, { name: 'cara', drive: true });
    for (const m of [{ type: 'set', name: 'heat', value: 1 }, { type: 'release', name: 'heat' },
      { type: 'palette', name: 'chapel' }, { type: 'level', value: 0 }, { type: 'tap', at: 1 },
      { type: 'blackout', on: true }, { type: 'take' }]) {
      assert.match(await cara.ask(m), /Jukebox/, m.type);
    }
    assert.equal(await cara.ask({ type: 'play', id: 'beat-bars' }), JUKEBOX_NOW);
    assert.equal(await cara.ask({ type: 'queue', id: 'beat-bars', at: 'now' }), JUKEBOX_NOW);
    assert.equal(await cara.ask({ type: 'queue', id: 'beat-bars', at: 'next' }), '');
    assert.equal(await cara.ask({ type: 'next', fade: 8 }), '');
    const s = engine.state();
    assert.deepEqual([s.blackout.on, s.level, s.switching?.id, s.queue.length], [false, 1, 'beat-bars', 0]);
    assert.equal((await cara.state()).mode, 'jukebox');
  });

  test('only Studio\'s feed sets the mode; entering Jukebox lets the knobs go and brings the lights back', async () => {
    const { origin, engine, run } = await serve();
    const feed = await page(origin, 'feed'), cara = await page(origin, { name: 'cara', drive: true });
    assert.equal(await cara.ask({ type: 'mode', mode: 'jukebox' }), 'Only Studio sends that.');
    assert.equal(await cara.ask({ type: 'set', name: 'heat', value: 1 }), '');
    assert.equal(await cara.ask({ type: 'level', value: 0.2 }), '');
    assert.equal(await cara.ask({ type: 'blackout', on: true }), '');
    run(0.5);
    assert.equal(engine.state().look?.controls.find((c) => c.name === 'heat')?.held, true);
    assert.equal(await feed.ask({ type: 'mode', mode: 'jukebox' }), '');
    run(0.5);
    const s = await cara.state();
    assert.deepEqual([s.mode, s.driver, s.level, s.blackout.on], ['jukebox', null, 1, false]);
    const heat = s.look?.controls.find((c) => c.name === 'heat');
    assert.deepEqual([heat?.held, heat?.value], [false, heat?.default]);
  });
});

describe('Live Play', () => {
  test('the first to move a knob has them; the others are refused until they take over', async () => {
    const { origin, clock } = await serve();
    const cara = await page(origin, { name: 'cara', drive: true });
    const jo = await page(origin, { name: 'jo', drive: true });
    assert.equal(await cara.ask({ type: 'set', name: 'heat', value: 1 }), '');
    clock.t = 4000;
    let s = await jo.state();
    assert.deepEqual(s.driver, { name: 'cara', ago: 4 });
    assert.deepEqual(s.here, ['cara', 'jo']);
    assert.equal(await jo.ask({ type: 'level', value: 0.5 }), 'cara has the knobs: Take over first');
    assert.equal(await jo.ask({ type: 'blackout', on: true }), '', 'Blackout is for anyone who may drive');
    s = await jo.state();
    assert.deepEqual([s.blackout.on, s.blackout.by], [true, 'jo']);
    assert.equal(await jo.ask({ type: 'take' }), '');
    assert.equal((await jo.state()).driver?.name, 'jo');
    assert.equal(await cara.ask({ type: 'tap', at: 1 }), 'jo has the knobs: Take over first');
  });

  test('the knobs are free when the driver\'s last page closes, not before', async () => {
    const { origin } = await serve();
    const a = await page(origin, { name: 'cara', drive: true }), b = await page(origin, { name: 'cara', drive: true });
    const jo = await page(origin, { name: 'jo', drive: true });
    assert.equal(await a.ask({ type: 'palette', name: 'chapel' }), '');
    a.ws.close();
    await settle();
    assert.equal((await jo.state()).driver?.name, 'cara');
    b.ws.close();
    await settle();
    const s = await jo.state();
    assert.deepEqual([s.driver, s.here], [null, ['jo']]);
    assert.equal(await jo.ask({ type: 'set', name: 'heat', value: 0 }), '');
  });

  test('a watcher may queue but not drive; the Pi\'s own page drives as itself', async () => {
    const { origin, engine } = await serve();
    const ana = await page(origin, { name: 'ana', drive: false }), pi = await page(origin);
    for (const m of [{ type: 'set', name: 'heat', value: 1 }, { type: 'blackout', on: true }, { type: 'take' },
      { type: 'play', id: 'beat-bars' }, { type: 'queue', id: 'beat-bars', at: 'now' }]) {
      assert.match(await ana.ask(m), /Watching only/, m.type);
    }
    assert.equal(await ana.ask({ type: 'queue', id: 'beat-bars' }), '');
    assert.equal(await ana.ask({ type: 'next', fade: 4 }), '');
    assert.equal(await pi.ask({ type: 'blackout', on: true }), '');
    const s = engine.state();
    assert.deepEqual([s.blackout.by, s.switching?.id], ['the Pi\'s page', 'beat-bars']);
    assert.deepEqual((await pi.state()).here, ['ana', 'the Pi\'s page']);
  });
});
