// The Pi's engine: plays one look at a time on the rig, fixed-step at the rig's fps (so stateful patterns never drift),
// on a drift-free timer, and a queue of looks (the jukebox, SPEC-offline "Playing on the lights"): each queued look
// plays its whole pattern once, then the next, fading out over its last second and in over the next's first (in
// Jukebox over FADE.jukebox each way, and with nothing queued it picks the next of its own looks, shuffled); else with
// nothing queued what plays loops on; a person's change may fade over its own time (SPEC-liveplay). Each frame: the
// look's live controls eased, rendered by the core, watched by the flash guard (a strobe dips to the safe look,
// pausing the queue, until someone picks a look again), then out through the LEDs' output transform (core/light.ts:
// v^gamma, × the master, blackout and fade as a linear cap after the curve, so dimming never shifts a hue) as the
// rig's channels to `output`.
import { rand } from '../../public/js/core/stdlib.ts';
import { FlashGuard } from '../../public/js/flash-guard.ts';
import {
  compileLayer, type Light, ledChannels, prepareLayer, type PreparedLayer, prepareLight, prepareScene,
  renderFrame, setLibrary,
} from '../../public/js/pattern-core.ts';
import type { PiSource } from '../../shared/schemas/live.ts';
import type { Layer } from '../../shared/schemas/look.ts';
import type { Rig } from '../../shared/schemas/rig.ts';
import type { Baked } from './baked.ts';
import { liveLook, type LiveLook } from './controls.ts';
import type { Library, PiLook } from './library.ts';
import type { Mode } from './protocol.ts';
import type { Relay } from './relay.ts';

export const FADE = { switch: 0.25, queue: 1, jukebox: 4, blackout: 0.3, level: 0.05, exit: 1 };   // seconds
export const MAX_QUEUE = 20;
const WARM_FRAMES = 8;
type Ease = { now: number, to: number, secs: number };
/** What the queue holds: one of the engine's own looks (`look`, by id), a look Studio sent (`live`, resolved), or a
 * look's bake (`baked`: its frames read when it is next, `error` if they cannot play). */
export type Item = { key: string, id: string, title: string, kind: 'look' | 'live' | 'baked', by?: string,
  look?: PiLook, sha256?: string, duration?: number, baked?: Baked, loading?: boolean, error?: string };
export type At = 'now' | 'next' | 'end';
const ease = (e: Ease, dt: number) => {
  const most = dt / e.secs;
  e.now = Math.abs(e.to - e.now) <= most ? e.to : e.now + Math.sign(e.to - e.now) * most;
  return e.now;
};

export type EngineOptions = { rig: Rig, lib: Library, looks: () => Map<string, { look: PiLook | null, error?: string }>,
  safe: string, output: (cells: Uint8Array) => void, log?: (line: string) => void, now?: () => number,
  light?: Light,     // the light settings (pi/light.json): the output transform, and the light the flash guard judges
  bake?: (id: string, sha256: string) => Promise<Baked>,     // a look's bake from Studio's frames (baked.ts)
  relay?: Relay,     // frames a browser renders, played in place of the engine's own (relay.ts)
  mode?: Mode,       // until setMode says (default live: no auto picks, 1 s fades)
  seed?: number };   // the auto picks' shuffle (default: the clock, so each night's order differs)

export function createEngine(o: EngineOptions) {
  const scene = prepareScene(o.rig), fps = scene.fps, dt = 1 / fps;
  const rgb = new Float32Array(scene.count * 3), cells = new Uint8Array(scene.frameChannels);
  const guard = new FlashGuard(o.rig, null, o.light), log = o.log ?? (() => {});
  const light = prepareLight(scene, o.light);
  const now = o.now ?? (() => performance.now());
  setLibrary([...o.lib.entries.values()]);
  const master: Ease = { now: 1, to: 1, secs: FADE.level }, black: Ease = { now: 1, to: 1, secs: FADE.blackout };
  const fade: Ease = { now: 0, to: 1, secs: FADE.switch };
  type Playing = { item: Item, id: string, title: string, duration: number, look: PiLook | null,
    live: LiveLook | null, layers: PreparedLayer[], baked: Baked | null };
  let playing: Playing | null = null, want = false;     // want: a person asked to go on as soon as the next is ready
  let pending: Item | null = null, frame = 0, tripped: { at: string, look: string } | null = null;
  let queue: Item[] = [], paused = false, keys = 0;
  // Jukebox's auto picks: a shuffled round of the engine's own looks (not the safe one), the next one prepared ahead
  // off the frame; `tried`: this look's end already asked for one.
  let jukebox = o.mode === 'jukebox', bag: string[] = [], rounds = 0, ahead: Item | null = null, tried = false;
  const seed = o.seed ?? Date.now();
  let dark = { by: null as string | null, at: now() };       // who last turned blackout on or off, and when
  let rev = 0, source: PiSource | null = null;      // rev: +1 at each switch, and each push that leaves a lane
  const stats = { frames: 0, late: 0, renderMs: 0, worstMs: 0, layerErrors: 0, lastError: '' };
  // Each look compiled and prepared as it arrives (or why it cannot play), never in a frame: preparing a look that
  // warps builds its grid, up to 100 ms. A bake is read when it is next (ready()) and has nothing more to prepare.
  const prepared = new WeakMap<Item, Playing | Error>();

  /** One of the engine's own looks as an item, or null if it has none that plays. */
  function own(id: string, by?: string): Item | null {
    const look = o.looks().get(id)?.look;
    return look ? { key: `q${++keys}`, id, title: look.title, kind: 'look', look, ...by ? { by } : {} } : null;
  }

  function prepare<T extends Item | null>(item: T): T {
    if (!item) return item;
    try {
      prepared.set(item, load(item));
    } catch (e) {
      prepared.set(item, e as Error);
    }
    return item;
  }

  // Each of the engine's own looks run for a few frames at start, into a scratch frame, and thrown away: its code
  // compiled and run warm, its grids built, so its first frames when it plays are not its slowest.
  const scratch = new Float32Array(scene.count * 3);
  for (const { look } of o.looks().values()) {
    if (!look) continue;
    try {
      const layers = look.layers.map((l) => prepareLayer(scene, l, compileLayer(l))), live = liveLook(look);
      for (let f = 0; f < WARM_FRAMES; f++) {
        live.step(f * dt, dt);
        renderFrame(scene, layers, f * dt, scratch, live.look);
      }
    } catch { /* it says why when it is played */ }
  }

  // The safe look, prepared ahead for the flash guard to dip to; the next one is prepared off the frame.
  let spare = prepare(own(o.safe));
  function safe() {
    const item = spare ?? prepare(own(o.safe)!);
    spare = null;
    setTimeout(() => { spare ??= prepare(own(o.safe)); });
    return item;
  }

  /** The item compiled and prepared; throws, saying why, if it cannot play. */
  function load(item: Item): Playing {
    if (item.baked) {
      return { item, id: item.id, title: item.title, duration: item.baked.duration, look: null, live: null,
        layers: [], baked: item.baked };
    }
    const entry = item.kind === 'look' ? o.looks().get(item.id) : { look: item.look ?? null, error: 'no look' };
    if (!entry?.look) throw new Error(entry ? entry.error! : `no look ${item.id}`);
    const look = entry.look;
    const layers = look.layers.map((l) => prepareLayer(scene, l, compileLayer(l)));
    return { item, id: item.id, title: look.title, duration: look.duration || 30, look, live: liveLook(look), layers,
      baked: null };
  }

  function start(item: Item) {
    // A bake's frames are in by now; a look of the engine's own is prepared again if the looks were read since.
    if (item.kind === 'baked' || (item.kind === 'look' && o.looks().get(item.id)?.look !== item.look)) prepare(item);
    const p = prepared.get(item) ?? prepared.get(prepare(item))!;
    if (p instanceof Error) {
      log(`look ${item.id} cannot play: ${p.message}; playing ${o.safe}`);
      playing = prepared.get(safe()) as Playing;
    } else playing = p;
    frame = 0;
    fade.to = 1;
    tried = false;
    pickAhead();
    rev++;
    log(`playing ${playing.id} (${playing.title})${playing.baked ? ', baked' : ''}`);
  }

  /** One frame: what the sculpture shows next. */
  function tick() {
    if (pending !== null && (fade.now === 0 || !playing)) { start(pending); pending = null; }
    if (!playing) return;
    const t0 = now(), p = playing, duration = p.duration;
    let t = frame * dt;
    ready(queue[0]);
    // The pattern's last fade: out toward the next queued look (in Jukebox, else a pick), so it has played whole when
    // the next starts.
    const end = !paused && !pending && t + turn() >= duration;
    if (end && jukebox && !queue.length && !tried) { tried = true; autoPick(); }
    if (!pending && (want || (end && queue.length)) && advance()) want = false;
    if (t >= duration) {
      // Back by whole frames, and the beat by exactly as much, so a duration off the frame grid never drifts it.
      const back = Math.floor(t / duration) * Math.round(duration * fps);
      frame -= back;
      t = frame * dt;
      tried = false;
      p.live?.wrapped(back * dt);
    }
    // A relayed frame (slots count every tick and skip) stands in for the render; the controls step on regardless.
    if (o.relay?.fill(stats.frames + stats.late, rev, rgb, dt)) p.live?.step(t, dt);
    else if (p.baked) p.baked.fill(frame, rgb);
    else {
      p.live!.step(t, dt);
      const out = renderFrame(scene, p.layers, t, rgb, p.live!.look);
      if (out.errors.length) { stats.layerErrors++; stats.lastError = out.errors[0]!.error; }
    }
    const gain = ease(master, dt) * ease(black, dt) * ease(fade, dt) * (o.relay?.gain() ?? 1);
    if (guard.observe(rgb, stats.frames * 1000 / fps, gain) && !tripped && p.id !== o.safe) {
      tripped = { at: new Date().toISOString(), look: p.id };
      log(`flash guard: ${p.id} flashed; dipping to ${o.safe} until a look is picked`);
      o.relay?.tripped();
      if (pending) queue.unshift(pending);     // a queued look on its way in waits for the person too
      pending = safe();
      paused = true;
      want = false;
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

  /** A baked item's frames, read when it is next (off the frame loop); dropped, saying why, if they cannot play. */
  function ready(item: Item | undefined) {
    if (item?.kind !== 'baked' || item.baked || item.loading || item.error) return;
    item.loading = true;
    const read = o.bake ? o.bake(item.id, item.sha256!) : Promise.reject(new Error('this engine plays no bakes'));
    read.then((b) => { item.baked = b; }, (e: Error) => {
      item.error = e.message;
      log(`look ${item.id} cannot play baked: ${e.message}`);
      if (queue[0] === item) want = false;     // asked for now: what plays goes on, not whatever comes after it
      queue = queue.filter((q) => q !== item);
    }).finally(() => { item.loading = false; });
  }

  /** The full fade each way: FADE.queue, in Jukebox FADE.jukebox (at most half the playing pattern). */
  const turn = () => (jukebox ? Math.min(FADE.jukebox, (playing?.duration ?? Infinity) / 2) : FADE.queue);

  /** The engine's own looks but the safe one, in a shuffled order of their own each round. */
  function shuffled() {
    const ids = [...o.looks()].filter(([id, l]) => l.look && id !== o.safe).map(([id]) => id).sort();
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rand(seed, rounds, i) * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    rounds++;
    return ids;
  }
  /** The next look of the rounds that is not the one playing (so none plays twice in a row: it goes to the round's
   * end); null when there is none other, and what plays loops on. */
  function pick(): Item | null {
    for (let round = 0; round < 2; round++) {
      if (!bag.length) bag = shuffled();
      while (bag.length) {
        const id = bag.shift()!;
        if (id === playing?.id) { if (bag.length) bag.push(id); continue; }
        const item = own(id);
        if (item) return item;
      }
    }
    return null;
  }
  /** Prepares the next pick off the frame loop, in Jukebox. */
  function pickAhead() {
    setTimeout(() => { if (jukebox && !ahead) ahead = prepare(pick()); });
  }
  /** Queues the pick made ahead (or one now, if none was); false when there is none. Only into an empty queue, and
   * one of the engine's own looks, so the advance() that follows takes it at once: it never waits in the queue. */
  function autoPick() {
    let item = ahead;
    ahead = null;
    if (item && (item.id === playing?.id || !o.looks().get(item.id)?.look)) item = null;
    item ??= prepare(pick());
    if (item) queue.push(item);
    return !!item;
  }

  /** The queue's next item to play, fading out what plays over `secs` (the full fade); false with nothing queued, or
   * while the next one's frames are being read. */
  function advance(secs = turn()) {
    const next = queue[0];
    if (!next) { want = false; return false; }
    ready(next);
    if (next.kind === 'baked' && !next.baked) return false;
    queue.shift();
    pending = next;
    fade.secs = secs;
    fade.to = 0;
    return true;
  }

  /** A change to the playing look's live side; a source change (a lane left, a palette) bumps rev. */
  function knob(change: (live: LiveLook) => boolean) {
    const live = playing?.live;
    if (!live) return false;
    const before = live.automation, palette = live.paletteHex(), ok = change(live);
    if (live.automation !== before || live.paletteHex() !== palette) rev++;
    return ok;
  }

  /** A person picked: the flash guard re-armed and the queue going again. */
  function picked() {
    tripped = null;
    paused = false;
    guard.reset();
  }

  /** Puts an item in the queue at `at` (now: plays it, fading over `secs`); false when the queue is full. */
  function enqueue(item: Item, at: At, secs?: number) {
    if (queue.length >= MAX_QUEUE) return false;
    if (item.kind !== 'baked') prepare(item);
    if (at === 'end') queue.push(item); else queue.unshift(item);
    if (at === 'now') { picked(); want = !advance(secs); }
    return true;
  }
  /** Seconds an item plays (a bake not read yet: null). */
  const lasts = (q: Item) => q.baked?.duration ?? q.duration ?? (q.look ? q.look.duration || 30 : null);

  return {
    scene, fps, tick, stats,
    /** Skip k frames of show time (the timer fell behind): the look keeps to the clock. */
    skip(k: number) { frame += k; stats.late += k; },
    /** Plays one of the engine's own looks now (fading over `secs`); a person picking one re-arms the flash guard. */
    play(id: string, secs = FADE.queue) {
      const item = prepare(own(id));
      if (!item) return false;
      picked();
      pending = item;
      fade.secs = secs;
      fade.to = 0;
      return true;
    },
    /** Queues one of the engine's own looks; false if it has none that plays, or the queue is full. */
    queue(id: string, at: At = 'end', by?: string, secs?: number) {
      const item = own(id, by);
      return !!item && enqueue(item, at, secs);
    },
    /** Queues a look Studio sent, resolved against the library by the caller; false when the queue is full. */
    send(look: PiLook, at: At = 'end', by?: string, secs?: number) {
      return enqueue({ key: `q${++keys}`, id: look.id, title: look.title, kind: 'live', look, ...by ? { by } : {} },
        at, secs);
    },
    /** Queues a look's bake by its id and the SHA-256 Studio holds for it (and its length, if it says); false when
     * the queue is full. */
    sendBaked(b: { id: string, title: string, sha256: string, duration?: number }, at: At = 'end', by?: string,
      secs?: number) {
      return enqueue({ key: `q${++keys}`, ...b, kind: 'baked', ...by ? { by } : {} }, at, secs);
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
    /** Skips to the next queued look now (fading; in Jukebox with nothing queued, a pick), going on from a
     * flash-guard pause too. */
    next(secs?: number) {
      if (!queue.length && !(jukebox && autoPick())) { paused = false; return false; }
      picked();
      want = !advance(secs);
      return true;
    },
    set(name: string, v: number) { return knob((live) => live.set(name, v, frame * dt)); },
    /** Lets a control go: back to the look's own value. */
    release(name: string) { return knob((live) => live.release(name, frame * dt)); },
    /** Blends to a palette by name ('': the look's own). */
    palette(name: string) { return knob((live) => live.palette(name)); },
    tap: (ms: number) => (playing?.live ? playing.live.tap(frame * dt, ms) : NaN),
    level(v: number) { master.to = Math.min(1, Math.max(0, v)); },
    /** Blackout on or off, by whom (null: the engine itself). */
    blackout(on: boolean, by: string | null = null) {
      if ((black.to === 0) !== on) dark = { by, at: now() };
      black.to = on ? 0 : 1;
    },
    /** Into Jukebox: every held control let go, the master back to full and the lights back, so nothing is left
     * that Jukebox has no control for. */
    jukebox() {
      knob((live) => { live.releaseAll(frame * dt); return true; });
      master.to = 1;
      this.blackout(false);
    },
    /** The mode (SPEC-liveplay "Modes"): Jukebox fades over FADE.jukebox and picks when nothing is queued. */
    setMode(m: Mode) {
      jukebox = m === 'jukebox';
      if (!jukebox) ahead = null;
      else pickAhead();
    },
    /** Fade everything out over `secs` (on exit). */
    fadeOut(secs = FADE.exit) { master.secs = secs; master.to = 0; },
    state: () => {
      const p = playing, L = p?.live?.look, t = frame * dt;
      return {
        // A bake has no clock of its own to share: its beat and controls are none.
        look: p && { id: p.id, rev, title: p.title, kind: p.item.kind, t, duration: p.duration,
          left: (queue.length || (jukebox && ahead)) && !paused ? Math.max(0, p.duration - t) : null,
          bpm: L?.bpm ?? 120, beats: L ? (t - L.beat0) * L.bpm / 60 : 0, offset: L?.offset ?? 0, beat0: L?.beat0 ?? 0,
          paces: L ? Object.fromEntries(L.paceOffset) : {}, controls: p.live?.controls.map((c) => ({ ...c })) ?? [] },
        gain: master.now * black.now * fade.now,
        level: master.to, blackout: { on: black.to === 0, by: dark.by, ago: (now() - dark.at) / 1000 }, tripped,
        paused, switching: pending && { id: pending.id, title: pending.title },
        queue: queue.map((q) => ({ key: q.key, id: q.id, title: q.title, kind: q.kind, ...q.by ? { by: q.by } : {},
          duration: lasts(q) })),
      };
    },
    /** What plays, for a viewer to render it too: its modules by ref (the viewer has the library), no code; a bake
     * as its title alone (`baked`). */
    source(): PiSource | null {
      if (!playing) return null;
      if (source?.rev === rev) return source;
      const { id, title, duration, look, live } = playing;
      if (!look || !live) {
        source = { rev, id, title, duration, globals: null, automation: null, layers: [], baked: true };
        return source;
      }
      const layers = look.layers.map((l) => ({ ...l, modules: (l.modules ?? []).map(({ code: _, ...m }) => m) }));
      const palette = live.paletteHex(), globals = palette ? { ...look.globals!, palette } : look.globals ?? null;
      source = { rev, id, title, duration, ...(look.bpm ? { bpm: look.bpm } : {}),
        globals, automation: live.automation, layers: layers as Layer[] };
      return source;
    },
  };
}
export type Engine = ReturnType<typeof createEngine>;
