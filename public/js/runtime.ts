// The app side of the pattern sandbox (SPEC "Sandbox protocol"). Pattern code never runs on this thread, which a
// `while (true) {}` would freeze: it runs in a module Worker (sandbox-worker.ts) served under a CSP of its own, with
// no network (src/static.ts). The runtime sends it the look, asks for frames (one in flight, at 40, 30 or 20 fps by
// their cost) and exports, reads its answers as data (sandbox-messages.ts), and restarts it when the look hangs.
import { extrasOf, type ExtraKey } from '../../shared/plays.ts';
import type { Automation, Globals } from '../../shared/schemas/look.ts';
import type { LibraryEntry, Rig } from '../../shared/schemas/rig.ts';
import { flatModules } from '../../core/tree.ts';
import { fromLibrary } from './library-fill.ts';
import type { LayerInput, Light } from '../../core/pattern-core.ts';
import {
  channelsOf, compiledReport, frameErrors, frameRgb, type FromWorker, isTime, type Layer as Sent, type LayerReport,
  layerTime, text,
} from './sandbox-messages.ts';
import type { Layer } from './ui/studio/model.ts';

const BUSY_MS = 1000;            // owed an answer and the worker silent this long: the look has stopped responding
const INIT_MS = 6000;            // preparing the scene (no pattern code runs)
const TICK_MS = 200;
const FROZEN_GAP_MS = 600;       // a watchdog tick this late: this thread was busy, throttled or frozen
const RESTARTS = 5;              // more restarts than this in RESTART_WINDOW_MS: give up
const RESTART_WINDOW_MS = 20000;
const PROGRESS_EVERY = 40;       // export progress goes on every 40 frames or 250 ms
const PROGRESS_MS = 250;
export const RATES = [40, 30, 20];
export const BUDGET = 0.8;       // a frame's budget: this share of its interval (the rest: messages, the draw)
const HEAVY = 0.4;        // a layer over this share of a 40 fps frame's budget is heavy
const budget = (rate: number) => (BUDGET * 1000) / rate;
const SLACK_MS = 4;              // a frame due this soon goes now, on this display frame
const ema = (old: number | undefined, v: number) => (old ? old + (v - old) * 0.15 : v);  // smoothed over ~10 frames
const STOPPED = 'This look stopped responding: a frame or its code ran for over 1 s, so the preview stopped. '
  + 'Change the look to try again.';

/** A look's globals, automation and tempo, as the sandbox takes them. */
export type Extra = { [K in ExtraKey]?: { globals: Globals | null, automation: Automation | null, bpm: number }[K] };

/** A layer's compile report (SPEC "Sandbox protocol"), each module's code added. */
export type Report = LayerReport & { modules: { code: string }[] };
/** A layer (or one of its modules) that failed this frame. */
export type FrameError = { id: string; module?: string; error: string };
/** What the app asks of the worker (SPEC "Sandbox protocol"). */
export type ToSandbox = { type: 'init'; rig: Rig; library: Pick<LibraryEntry, 'name' | 'code'>[] }
  | ({ type: 'look'; layers: (LayerInput & { id: string })[] } & Extra)
  | { type: 'frame'; seq: number; t: number }
  | { type: 'render'; seq: number; start: number; frames: number; fps: number; brightness: number;
    light: Light };
type Status = 'loading' | 'ready' | 'warning' | 'stopped' | 'dead';
type Frame = { seq: number; t: number; look: number };
type Render = { seq: number; frames: number; bytes: number; done: number; sentDone: number; sentAt: number;
  look: Sent[]; resolve: (c: Uint8Array) => void; reject: (e: Error) => void;
  onProgress?: (done: number, frames: number) => void };

/** A pattern worker: one place for the URL, so the build emits it once (sandbox-worker-<hash>.js). */
const spawnWorker = () => new Worker(new URL('./sandbox-worker.ts', import.meta.url),
  { type: 'module', name: 'folly-patterns' });

export class Runtime {
  rig!: Rig; library: Pick<LibraryEntry, 'name' | 'code'>[] = []; worker: Worker | null = null;
  codes: ReadonlyMap<string, string> = new Map();   // every library module's code by name, hidden ones too
  black = new Float32Array(0);                      // the frame for an rgb that is not the rig's
  playing = false; held = false; stopped = false;   // stopped: the look stopped responding, until it changes
  phase: 'idle' | 'init' | 'ready' | 'dead' = 'idle';
  layers: Layer[] = []; extra: Extra = {}; lookDirty = false; lookVersion = 0; frameLookVersion = -1; lastT = NaN;
  sent: Sent[] = [];                                // the newest look's layers, as given to the worker
  seq = 0; restarts: number[] = []; render_: Render | null = null;
  frame: Frame = { seq: 0, t: 0, look: 0 };     // reused: no garbage per frame
  frameMsg: { type: 'frame'; seq: number; t: number } = { type: 'frame', seq: 0, t: 0 };
  frameInFlight: Frame | null = null;
  lookQueue: { layers: Sent[]; codes: Map<string, Map<string, string>> }[] = [];   // per look sent, not compiled yet
  heard = 0; overdue = false; timer = 0; lastTick = 0;   // when the worker last spoke or was given work; the watchdog
  rate = RATES[0]; due = 0; rateAt = 0; layerMs = new Map<string, number>(); stats = { fps: 0, ms: 0 };
  fpsCount = 0; fpsSince = performance.now();
  time!: () => number;    // the show time now
  onFrame!: (rgb: Float32Array, t: number) => void; onCompiled!: (layers: Report[]) => void;
  onFrameErrors!: (errors: readonly FrameError[]) => void; onStatus!: (state: Status, detail?: string) => void;

  constructor(o: Pick<Runtime, 'time' | 'onFrame' | 'onCompiled' | 'onFrameErrors' | 'onStatus'>) {
    Object.assign(this, o);
  }

  /** The rig, and the library's modules: its sources for use(), and every module's code for the look's refs. */
  start(rig: Rig, modules: Pick<LibraryEntry, 'name' | 'kind' | 'code'>[]) {
    const library = modules.filter((e) => (e.kind || 'source') === 'source').map(({ name, code }) => ({ name, code }));
    Object.assign(this, { rig, library, codes: new Map(modules.map((e) => [e.name, e.code])),
      black: new Float32Array(Math.max(0, rig.count | 0) * 3) });
    this._spawn();
  }

  /** layers as saved (+ enabled: false). A look that stopped responding plays again. */
  setLook(layers: Layer[], extra: Extra = {}) {
    this.layers = layers;
    this.extra = extrasOf(extra);
    this.lookDirty = true;
    if (this.stopped) { this.stopped = false; if (this.phase === 'ready') this.onStatus('ready'); }
    for (const id of this.layerMs.keys()) if (!layers.some((l) => l.id === id)) this.layerMs.delete(id);
  }

  /** A fresh frame on the next pump even if nothing changed (after an export). */
  refresh() { this.lastT = NaN; }
  get ready() { return this.phase === 'ready'; }
  /** Layers whose time takes over HEAVY of a 40 fps frame's budget: Map id → ms. */
  heavy() {
    return new Map([...this.layerMs].filter(([, ms]) => ms > HEAVY * budget(RATES[0])));
  }

  /** Something else has the picture (baked playback): no frames, and a reply on its way is dropped, until a pump. */
  hold() { this.held = true; this.playing = false; }

  /** Per animation frame: a pending look, then frame `t` when due and changed (always while playing). */
  pump(t: number, playing = false) {
    this.held = false;
    this.playing = playing;
    if (this.phase !== 'ready' || this.render_ || this.stopped) return;
    if (this.lookDirty) this._sendLook();
    if (playing || t !== this.lastT || this.frameLookVersion !== this.lookVersion) this._request(t);
  }

  _request(t: number) {
    const now = performance.now(), iv = 1000 / this.rate;
    if (this.frameInFlight || now < this.due - SLACK_MS) return;
    this.due = now - this.due < iv ? this.due + iv : now + iv;       // keep the cadence unless far behind
    const f = this.frame;
    f.seq = this.frameMsg.seq = ++this.seq;
    f.t = this.frameMsg.t = t;
    f.look = this.lookVersion;
    this._post(this.frameMsg);          // cloned synchronously, so the object can be reused
    this.frameInFlight = f;
  }

  /** Should a paused loop keep ticking for time t? */
  pending(t: number) {
    return this.phase === 'ready' && !this.render_ && !this.stopped && (this.lookDirty || !!this.frameInFlight
      || t !== this.lastT || this.frameLookVersion !== this.lookVersion);
  }

  /** Render frames for export → Uint8Array(frames × channelsPerFrame). */
  render({ start = 0, frames, fps = 40, brightness = 1, light, onProgress }: { start?: number; frames: number;
    fps?: number; brightness?: number; light: Light; onProgress?: Render['onProgress'] }) {
    return new Promise<Uint8Array>((resolve, reject) => {
      if (this.phase !== 'ready') return reject(new Error('The pattern engine is not ready yet.'));
      if (this.stopped) return reject(new Error('This look stopped responding. Change it, then export again.'));
      if (this.render_) return reject(new Error('An export is already running.'));
      if (this.lookDirty) this._sendLook();
      const seq = ++this.seq, out = this.rig.output, now = performance.now();
      this._post({ type: 'render', seq, start, frames, fps, brightness, light });
      this.render_ = { seq, resolve, reject, onProgress, frames, done: 0, sentDone: 0, sentAt: now, look: this.sent,
        bytes: Math.max(0, Math.floor(frames)) * out.universes * out.channelsPerUniverse };
    });
  }

  cancelRender() {
    if (!this.render_) return;
    this._failRender('Export cancelled.');
    this._restart(); // the worker is busy rendering: start over with a fresh one
  }

  destroy() {
    this.phase = 'dead';
    this._failRender('Closed.');
    this._kill();
  }

  _spawn() {
    let w: Worker;
    try {
      w = spawnWorker();
    } catch (e) {
      return this._die(`The pattern worker could not start: ${(e as Error)?.message || e}`);
    }
    w.onmessage = (e) => { if (this.worker === w) this._message(e.data); };
    w.onerror = (e) => {
      e.preventDefault();       // stray async errors from pattern code
      // Before `ready` its script did not load: a fresh one would not either.
      if (this.worker === w && this.phase === 'init') this._die('The pattern worker could not load. Reload the page.');
    };
    Object.assign(this, { worker: w, phase: 'init' });
    this.onStatus('loading');
    this._post({ type: 'init', rig: this.rig, library: this.library });
  }

  _kill() {
    this.worker?.terminate();
    clearInterval(this.timer);
    Object.assign(this, { worker: null, frameInFlight: null, lookQueue: [], timer: 0, overdue: false });
  }

  _failRender(message: string) {
    const r = this.render_;
    this.render_ = null;
    r?.reject(new Error(message));
  }

  _restart() {
    const now = performance.now();
    this.restarts = [...this.restarts.filter((t) => now - t < RESTART_WINDOW_MS), now];
    this._kill();
    this._failRender('Export stopped: the pattern engine restarted.');
    if (this.restarts.length > RESTARTS) return this._die('The pattern engine keeps stopping. Reload the page.');
    this._spawn();
  }

  _die(detail: string) {
    this._kill();
    this._failRender(detail);
    this.phase = 'dead';
    this.onStatus('dead', detail);
  }

  /** Owed anything: the scene, a frame, a compile, an export? */
  get owed() { return this.phase === 'init' || !!(this.frameInFlight || this.lookQueue.length || this.render_); }

  _post(msg: ToSandbox) {
    if (!this.worker) return;
    if (!this.owed || !this.timer) this.heard = performance.now();   // the silence that counts starts now
    this.worker.postMessage(msg);
    if (!this.timer) {
      this.lastTick = performance.now();
      this.timer = window.setInterval(() => this._tick(), TICK_MS);
    }
  }

  _sendLook() {
    this.lookDirty = false;
    this.lookVersion++;
    const msg = { type: 'look', ...this.extra, layers: fromLibrary(this.layers, this.codes) } as const;
    const codes = (l: Layer) => new Map(flatModules(l.modules).map((m) => [m.id, m.code ?? '']));
    this._post(msg);
    this.sent = msg.layers;
    this.lookQueue.push({ layers: msg.layers, codes: new Map(this.layers.map((l) => [l.id, codes(l)])) });
  }

  /** A frame came back; while playing, one that came late asks for the next at once. */
  _frame(m: FromWorker, f: Frame) {
    this.frameInFlight = null;
    this.lastT = f.t;
    this.frameLookVersion = f.look;
    const now = performance.now(), st = this.stats, sent = this.sent;
    this.fpsCount++;
    if (now - this.fpsSince >= 1000) {
      st.fps = (this.fpsCount * 1000) / (now - this.fpsSince);
      this.fpsCount = 0;
      this.fpsSince = now;
    }
    if (isTime(m.ms)) st.ms = ema(st.ms, m.ms);
    for (let i = 0; i < sent.length; i++) {
      const id = sent[i].id, ms = layerTime(m.layerMs, id);
      if (ms >= 0) this.layerMs.set(id, ema(this.layerMs.get(id), ms));
    }
    // Step down while frames cost over budget; back up once well under the faster rate's, a second apart.
    const i = RATES.indexOf(this.rate);
    const next = st.ms > budget(this.rate) ? RATES[i + 1] : st.ms < 0.7 * budget(RATES[i - 1]) ? RATES[i - 1] : 0;
    if (next && now - this.rateAt > 1000) { this.rate = next; this.rateAt = now; }
    if (!this.held) this.onFrame(frameRgb(m.rgb, this.black.length / 3, this.black), f.t);
    this.onFrameErrors(frameErrors(m.errors, sent));
    if (this.playing && !this.lookDirty && !this.render_) this._request(this.time());
  }

  _progress(r: Render, done: number) {
    const now = performance.now();
    r.done = done;
    if (done - r.sentDone < PROGRESS_EVERY && now - r.sentAt < PROGRESS_MS) return;
    r.sentDone = done;
    r.sentAt = now;
    r.onProgress?.(done, r.frames);
  }

  _message(m: FromWorker) {
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
    const r = this.render_;
    this.heard = performance.now();
    this.overdue = false;
    switch (m.type) {
      case 'ready':
        if (this.phase !== 'init') break;
        this.phase = 'ready';
        this.lookDirty = !this.stopped;
        if (this.stopped) this.onStatus('stopped', STOPPED); else this.onStatus('ready');
        break;
      case 'compiled': {
        const q = this.lookQueue.shift();
        if (!q) break;
        this.onCompiled(compiledReport(q.layers, m.layers).map((l) => ({ ...l,
          modules: l.modules.map((x) => ({ ...x, code: q.codes.get(l.id)?.get(x.id) ?? '' })) })));
        break;
      }
      case 'frame':
        if (this.frameInFlight && m.seq === this.frameInFlight.seq) this._frame(m, this.frameInFlight);
        break;
      case 'progress':
        if (r && m.seq === r.seq && Number(m.done) > r.done) this._progress(r, Number(m.done));
        break;
      case 'rendered': {
        if (!r || m.seq !== r.seq) break;
        this.render_ = null;
        const channels = channelsOf(m.channels, r.bytes), errors = frameErrors(m.errors, r.look);
        if (errors.length) this.onFrameErrors(errors);
        if (typeof channels === 'string') r.reject(new Error(channels)); else r.resolve(channels);
        break;
      }
      case 'error': {
        const error = text(m.error);
        if (m.request === 'init') return this._die(`The pattern engine could not start: ${error}`);
        if (m.request === 'look') this.lookQueue.shift();
        if (m.request === 'frame' && this.frameInFlight && m.seq === this.frameInFlight.seq) this.frameInFlight = null;
        if (m.request === 'render' && r && m.seq === r.seq) this._failRender(error);
        else this.onStatus('warning', error);
        break;
      }
      default:   // 'compiling': the worker is busy, not stuck
    }
  }

  _tick() {
    const now = performance.now(), gap = now - this.lastTick;
    this.lastTick = now;
    // Replies may be queued behind a late tick: no blame, the clock starts again.
    if (gap > FROZEN_GAP_MS) { this.heard += gap; this.overdue = false; return; }
    if (!this.owed) { clearInterval(this.timer); this.timer = 0; return; }
    if (now - this.heard <= (this.phase === 'init' ? INIT_MS : BUSY_MS)) return;
    if (!this.overdue) { this.overdue = true; return; }   // overdue on two ticks in a row: a queued reply had its turn
    if (this.phase === 'ready') this.stopped = true;
    this._failRender('Export stopped: the look stopped responding (a frame took over 1 s).');
    this._restart();
  }
}
