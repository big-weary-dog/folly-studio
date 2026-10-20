// The Pi's engine: plays one look at a time on the rig, fixed-step at the rig's fps (so stateful patterns never drift),
// on a drift-free timer. Each frame: the look's live controls eased, rendered by the core, watched by the flash guard
// (a strobe dips to the safe look and holds there until someone picks a look again), then out through the LEDs'
// output transform (core/light.ts: v^gamma, × the master, blackout and fade as a linear cap after the curve, so
// dimming never shifts a hue) as the rig's channels to `output`. Look switches dip through black.
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

export const FADE = { switch: 0.25, blackout: 0.3, level: 0.05, exit: 1 };   // seconds
type Ease = { now: number, to: number, secs: number };
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
  let playing: { id: string, look: PiLook, live: LiveLook, layers: PreparedLayer[], errors: number } | null = null;
  let pending: string | null = null, frame = 0, tripped: { at: string, look: string } | null = null;
  let rev = 0, source: PiSource | null = null;      // rev: +1 at each switch, and each push that leaves a lane
  const stats = { frames: 0, late: 0, renderMs: 0, worstMs: 0, layerErrors: 0, lastError: '' };

  /** The look by id, compiled and prepared; throws, saying why, if it cannot play. */
  function load(id: string) {
    const entry = o.looks().get(id);
    if (!entry?.look) throw new Error(entry ? entry.error! : `no look ${id}`);
    const look = entry.look;
    const layers = look.layers.map((l) => prepareLayer(scene, l, compileLayer(l)));
    return { id, look, live: liveLook(look), layers, errors: 0 };
  }

  function start(id: string) {
    try {
      playing = load(id);
    } catch (e) {
      log(`look ${id} cannot play: ${(e as Error).message}; playing ${o.safe}`);
      playing = load(o.safe);
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
      pending = o.safe;
      fade.to = 0;
    }
    o.output(ledChannels(scene, rgb, light, cells, gain));
    frame++;
    stats.frames++;
    const ms = now() - t0;
    stats.renderMs += (ms - stats.renderMs) * 0.05;
    stats.worstMs = Math.max(stats.worstMs * 0.999, ms);
  }

  return {
    scene, fps, tick, stats,
    /** Skip k frames of show time (the timer fell behind): the look keeps to the clock. */
    skip(k: number) { frame += k; stats.late += k; },
    /** Switch to a look (dipping through black); a person picking one re-arms the flash guard. */
    play(id: string) {
      if (!o.looks().get(id)?.look) return false;
      tripped = null;
      guard.reset();
      pending = id;
      fade.to = 0;
      return true;
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
      look: playing && { id: playing.id, rev, title: playing.look.title, t: frame * dt,
        duration: playing.look.duration || 30,
        bpm: playing.live.look.bpm, beats: (frame * dt - playing.live.look.beat0) * playing.live.look.bpm / 60,
        offset: playing.live.look.offset, beat0: playing.live.look.beat0,
        paces: Object.fromEntries(playing.live.look.paceOffset),
        controls: playing.live.controls.map((c) => ({ ...c })) },
      gain: master.now * black.now * fade.now,
      level: master.to, blackout: black.to === 0, tripped, switching: pending,
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
