// Relay to the lights, in the sandbox's worker (SPEC-live "Relay to the lights"): on the worker's own timer (a hidden
// tab throttles the page's timers, not a Worker's), the look rendered ahead at the engine's slots, each frame's
// values set as the engine's state has them, and each posted as the engine takes it: u32 slot, u32 look rev, then the
// rgb as Uint16 (little-endian, as every platform that runs Chrome). A new look waits for the page's next word. With
// the editor's `clock` (Studio's preview), show time is its playhead's at each slot's moment, over any look.
import { setLive, type LiveSet, liveSetOf } from './live-set.ts';
import { type PreparedLayer, type PreparedLook, renderFrame, type Scene } from './pattern-core.ts';

/** The editor's playhead: show time `t` at epoch ms `at`, running at `speed` while `playing`, wrapped by `duration`. */
export type RelayClock = { t: number, at: number, speed: number, playing: boolean, duration: number };
/** What the page says: the engine's slot `index` at epoch ms `at`; `frame` the look's at slot `next`, or `clock`. */
export type RelayCfg = { on: boolean, rev: number, next: number, frame: number, index: number, at: number,
  fps: number, duration: number, lead: number, set: LiveSet | null, clock: RelayClock | null };
const TICK_MS = 10, MAX_TURN = 4, MAX_LEAD = 64;
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clockOf = (k: unknown): RelayClock | null => {
  if (!k || typeof k !== 'object') return null;
  const o = k as Record<string, unknown>;
  return { t: num(o.t), at: num(o.at), speed: num(o.speed, 1), playing: o.playing === true,
    duration: Math.max(0, num(o.duration)) };
};

export function relayAhead(look: () => { scene: Scene | null, layers: PreparedLayer[], live: PreparedLook | null },
  post: (msg: object, transfer: Transferable[]) => void) {
  let cfg: RelayCfg | null = null, sent = -1, timer: ReturnType<typeof setInterval> | 0 = 0, waiting = false;
  let rgb = new Float32Array(0);
  const set: LiveSet = { values: {}, bpm: 0, beat0: 0, offset: 0 };

  /** The editor's show time at slot `slot`: its playhead run on to the slot's moment, wrapped by the duration. */
  function clockAt(c: RelayCfg, k: RelayClock, slot: number) {
    if (!k.playing) return k.t;
    const t = k.t + ((c.at + (slot - c.index) * 1000 / c.fps) - k.at) / 1000 * k.speed;
    return k.duration > 0 ? ((t % k.duration) + k.duration) % k.duration : t;
  }

  function render(scene: Scene, layers: PreparedLayer[], live: PreparedLook | null, c: RelayCfg, slot: number) {
    // The engine's frame for this slot, wrapped as it wraps: whole loops back, the beat's downbeat with them.
    const dt = 1 / c.fps, loop = Math.round(c.duration * c.fps);
    let f = c.frame + (slot - c.next), back = 0;
    if (f * dt >= c.duration && loop > 0) back = Math.floor(f * dt / c.duration) * loop;
    f -= back;
    if (live && c.set && !c.clock) {
      Object.assign(set, c.set);
      set.beat0 = c.set.beat0 - back * dt;
      setLive(live, set);
    }
    if (rgb.length !== scene.count * 3) rgb = new Float32Array(scene.count * 3);
    renderFrame(scene, layers, c.clock ? clockAt(c, c.clock, slot) : f * dt, rgb, live ?? undefined);
    const bytes = new ArrayBuffer(8 + rgb.length * 2), head = new DataView(bytes, 0, 8), q = new Uint16Array(bytes, 8);
    head.setUint32(0, slot, true);
    head.setUint32(4, c.rev, true);
    for (let i = 0; i < rgb.length; i++) {
      const v = rgb[i]!;
      q[i] = v > 0 ? (v < 1 ? Math.round(v * 65535) : 65535) : 0;
    }
    post({ type: 'relayed', bytes }, [bytes]);
  }

  function tick() {
    const c = cfg, { scene, layers, live } = look();
    if (!c || !scene || waiting) return;
    const now = Math.floor(c.index + (performance.timeOrigin + performance.now() - c.at) * c.fps / 1000);
    // Behind (or starting): from the slot after the one playing; never more than a few frames a turn.
    sent = Math.max(sent, now);
    for (let n = 0; sent < now + c.lead && n < MAX_TURN; n++) render(scene, layers, live, c, ++sent);
  }

  return {
    /** The page's word: the engine's clock and state, or `on: false`. */
    relay(m: Partial<RelayCfg>) {
      if (!m.on) { clearInterval(timer); timer = 0; cfg = null; sent = -1; return; }
      const rev = num(m.rev), clock = clockOf(m.clock), was = cfg?.clock;
      // A new rev, or the editor's playhead moved (a seek, play or pause): rendered again from the next slot, over
      // the frames already sent (the engine keeps a slot's latest).
      if (rev !== cfg?.rev || (clock && (!was || clock.t !== was.t || clock.at !== was.at
        || clock.playing !== was.playing || clock.speed !== was.speed))) sent = -1;
      cfg = { on: true, rev, next: num(m.next), frame: num(m.frame), index: num(m.index), at: num(m.at),
        fps: num(m.fps, 40) || 40, duration: num(m.duration, 30) || 30,
        lead: Math.min(MAX_LEAD, Math.max(1, Math.round(num(m.lead, 8)))), set: liveSetOf(m.set ?? undefined),
        clock };
      waiting = false;
      timer ||= setInterval(tick, TICK_MS);
    },
    /** A new look arrived: nothing more is rendered until the page says which rev it is (the editor's: at once). */
    looked() { if (!cfg?.clock) waiting = true; },
  };
}
