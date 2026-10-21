// The Pi's engine: plays one look at a time on the rig, fixed-step at the rig's fps (so stateful patterns never drift),
// on a drift-free timer, and a queue of looks (the jukebox, SPEC-offline "Playing on the lights"): each queued look
// plays its whole pattern once, then the next, fading out over its last second and in over the next's first; with
// nothing queued what plays loops on. Each frame: the look's live controls eased, rendered by the core, watched by the
// flash guard (a strobe dips to the safe look, pausing the queue, until someone picks a look again), then out
// through the LEDs' output transform (core/light.ts: v^gamma, × the master, blackout and fade as a linear cap after
// the curve, so dimming never shifts a hue) as the rig's channels to `output`.
import { FlashGuard } from '../../public/js/flash-guard.ts';
import {
  compileLayer, type Light, ledChannels, prepareLayer, type PreparedLayer, prepareLight, prepareScene,
  renderFrame, setLibrary,
} from '../../public/js/pattern-core.ts';
import type { PiSource } from '../../shared/schemas/live.ts';
import type { Layer } from '../../shared/schemas/look.ts';
import type { Rig } from '../../shared/schemas/rig.ts';
import { liveLook, type LiveLook } from './controls.ts';
import type { Library, PiLook } from './library.ts';

export const FADE = { switch: 0.25, queue: 1, blackout: 0.3, level: 0.05, exit: 1 };   // seconds
export const MAX_QUEUE = 20;
type Ease = { now: number, to: number, secs: number };
/** What the queue holds: one of the engine's own looks (`look`, by id), or a look Studio sent (`live`, resolved). */
export type Item = { key: string, id: string, title: string, kind: 'look' | 'live', by?: string, look?: PiLook };
export type At = 'now' | 'next' | 'end';
const ease = (e: Ease, dt: number) => {
  const most = dt / e.secs;
  e.now = Math.abs(e.to - e.now) <= most ? e.to : e.now + Math.sign(e.to - e.now) * most;
  return e.now;
};

export type EngineOptions = { rig: Rig, lib: Library, looks: () => Map<string, { look: PiLook | null, error?: string }>,
  safe: string, output: (cells: Uint8Array) => void, log?: (line: string) => void, now?: () => number,
  light?: Light };   // the light settings (pi/light.json): the output transform, and the light the flash guard judges

export function createEngine(o: EngineOptions) {
  const scene = prepareScene(o.rig), fps = scene.fps, dt = 1 / fps;
  const rgb = new Float32Array(scene.count * 3), cells = new Uint8Array(scene.frameChannels);
  const guard = new FlashGuard(o.rig, null, o.light), log = o.log ?? (() => {});
  const light = prepareLight(scene, o.light);
  const now = o.now ?? (() => performance.now());
  setLibrary([...o.lib.entries.values()]);
  const master: Ease = { now: 1, to: 1, secs: FADE.level }, black: Ease = { now: 1, to: 1, secs: FADE.blackout };
  const fade: Ease = { now: 0, to: 1, secs: FADE.switch };
  let playing: { item: Item, id: string, look: PiLook, live: LiveLook, layers: PreparedLayer[] } | null = null;
  let pending: Item | null = null, frame = 0, tripped: { at: string, look: string } | null = null;
  let queue: Item[] = [], paused = false, keys = 0;
  let rev = 0, source: PiSource | null = null;      // rev: +1 at each switch, and each push that leaves a lane
  const stats = { frames: 0, late: 0, renderMs: 0, worstMs: 0, layerErrors: 0, lastError: '' };

  /** One of the engine's own looks as an item, or null if it has none that plays. */
  function own(id: string, by?: string): Item | null {
    const look = o.looks().get(id)?.look;
    return look ? { key: `q${++keys}`, id, title: look.title, kind: 'look', look, ...by ? { by } : {} } : null;
  }

  /** The item compiled and prepared; throws, saying why, if it cannot play. */
  function load(item: Item) {
    const entry = item.kind === 'look' ? o.looks().get(item.id) : { look: item.look ?? null, error: 'no look' };
    if (!entry?.look) throw new Error(entry ? entry.error! : `no look ${item.id}`);
    const look = entry.look;
    const layers = look.layers.map((l) => prepareLayer(scene, l, compileLayer(l)));
    return { item, id: item.id, look, live: liveLook(look), layers };
  }

  function start(item: Item) {
    try {
      playing = load(item);
    } catch (e) {
      log(`look ${item.id} cannot play: ${(e as Error).message}; playing ${o.safe}`);
      playing = load(own(o.safe)!);
    }
    frame = 0;
    fade.to = 1;
    rev++;
    log(`playing ${playing.id} (${playing.look.title})`);
  }

  /** One frame: what the sculpture shows next. */
  function tick() {
    if (pending !== null && (fade.now === 0 || !playing)) { start(pending); pending = null; }
    if (!playing) return;
    const t0 = now(), p = playing, duration = p.look.duration || 30;
    let t = frame * dt;
    // The pattern's last second: fade out toward the next queued look, so it has played whole when the next starts.
    if (!pending && !paused && queue.length && t + FADE.queue >= duration) advance();
    if (t >= duration) {
      // Back by whole frames, and the beat by exactly as much, so a duration off the frame grid never drifts it.
      const back = Math.floor(t / duration) * Math.round(duration * fps);
      frame -= back;
      t = frame * dt;
      p.live.wrapped(back * dt);
    }
    p.live.step(t, dt);
    const out = renderFrame(scene, p.layers, t, rgb, p.live.look);
    if (out.errors.length) { stats.layerErrors++; stats.lastError = out.errors[0]!.error; }
    const gain = ease(master, dt) * ease(black, dt) * ease(fade, dt);
    if (guard.observe(rgb, stats.frames * 1000 / fps, gain) && !tripped && p.id !== o.safe) {
      tripped = { at: new Date().toISOString(), look: p.id };
      log(`flash guard: ${p.id} flashed; dipping to ${o.safe} until a look is picked`);
      pending = own(o.safe);
      paused = true;
      fade.secs = FADE.switch;
      fade.to = 0;
    }
    o.output(ledChannels(scene, rgb, light, cells, gain));
    frame++;
    stats.frames++;
    const ms = now() - t0;
    stats.renderMs += (ms - stats.renderMs) * 0.05;
    stats.worstMs = Math.max(stats.worstMs * 0.999, ms);
  }

  /** The queue's next item to play, fading out what plays over FADE.queue; false with nothing queued. */
  function advance() {
    const next = queue.shift();
    if (!next) return false;
    pending = next;
    fade.secs = FADE.queue;
    fade.to = 0;
    return true;
  }

  /** A person picked: the flash guard re-armed and the queue going again. */
  function picked() {
    tripped = null;
    paused = false;
    guard.reset();
  }

  /** Puts an item in the queue at `at` (now: plays it, fading); false when the queue is full. */
  function enqueue(item: Item, at: At) {
    if (queue.length >= MAX_QUEUE) return false;
    if (at === 'end') queue.push(item); else queue.unshift(item);
    if (at === 'now') { picked(); advance(); }
    return true;
  }

  return {
    scene, fps, tick, stats,
    /** Skip k frames of show time (the timer fell behind): the look keeps to the clock. */
    skip(k: number) { frame += k; stats.late += k; },
    /** Plays one of the engine's own looks now (fading); a person picking one re-arms the flash guard. */
    play(id: string) {
      const item = own(id);
      if (!item) return false;
      picked();
      pending = item;
      fade.secs = FADE.queue;
      fade.to = 0;
      return true;
    },
    /** Queues one of the engine's own looks; false if it has none that plays, or the queue is full. */
    queue(id: string, at: At = 'end', by?: string) {
      const item = own(id, by);
      return !!item && enqueue(item, at);
    },
    /** Queues a look Studio sent, resolved against the library by the caller; false when the queue is full. */
    send(look: PiLook, at: At = 'end', by?: string) {
      return enqueue({ key: `q${++keys}`, id: look.id, title: look.title, kind: 'live', look, ...by ? { by } : {} },
        at);
    },
    unqueue(key: string) {
      const before = queue.length;
      queue = queue.filter((q) => q.key !== key);
      return queue.length < before;
    },
    /** Moves a queued item to place `to` (0 first). */
    move(key: string, to: number) {
      const i = queue.findIndex((q) => q.key === key);
      if (i < 0) return false;
      const [item] = queue.splice(i, 1);
      queue.splice(Math.max(0, Math.min(queue.length, to)), 0, item!);
      return true;
    },
    /** Skips to the next queued look now (fading), going on from a flash-guard pause too. */
    next() {
      if (!queue.length) { paused = false; return false; }
      picked();
      return advance();
    },
    set(name: string, v: number) {
      if (!playing) return false;
      const before = playing.live.automation, ok = playing.live.set(name, v, frame * dt);
      if (playing.live.automation !== before) rev++;
      return ok;
    },
    tap: (ms: number) => (playing ? playing.live.tap(frame * dt, ms) : NaN),
    level(v: number) { master.to = Math.min(1, Math.max(0, v)); },
    blackout(on: boolean) { black.to = on ? 0 : 1; },
    /** Fade everything out over `secs` (on exit). */
    fadeOut(secs = FADE.exit) { master.secs = secs; master.to = 0; },
    state: () => ({
      look: playing && { id: playing.id, rev, title: playing.look.title, kind: playing.item.kind, t: frame * dt,
        duration: playing.look.duration || 30,
        left: queue.length && !paused ? Math.max(0, (playing.look.duration || 30) - frame * dt) : null,
        bpm: playing.live.look.bpm, beats: (frame * dt - playing.live.look.beat0) * playing.live.look.bpm / 60,
        offset: playing.live.look.offset, beat0: playing.live.look.beat0,
        paces: Object.fromEntries(playing.live.look.paceOffset),
        controls: playing.live.controls.map((c) => ({ ...c })) },
      gain: master.now * black.now * fade.now,
      level: master.to, blackout: black.to === 0, tripped, paused,
      switching: pending && { id: pending.id, title: pending.title },
      queue: queue.map(({ look: _, ...q }) => q),
    }),
    /** What plays, for a viewer to render it too: its modules by ref (the viewer has the library), no code. */
    source(): PiSource | null {
      if (!playing) return null;
      if (source?.rev === rev) return source;
      const { id, look, live } = playing;
      const layers = look.layers.map((l) => ({ ...l, modules: (l.modules ?? []).map(({ code: _, ...m }) => m) }));
      source = { rev, id, title: look.title, duration: look.duration || 30, ...(look.bpm ? { bpm: look.bpm } : {}),
        globals: look.globals ?? null, automation: live.automation, layers: layers as Layer[] };
      return source;
    },
  };
}
export type Engine = ReturnType<typeof createEngine>;
