// The app side of the pattern sandbox (SPEC "Sandbox protocol"): the hidden iframe pattern code runs in, the look,
// frames (one in flight, at 40, 30 or 20 fps by their cost) and exports. After `init` it talks over a MessagePort:
// Chrome takes a millisecond to unpack a window message from an opaque origin. The page pauses hung layers itself;
// this watchdog rebuilds it only when it stops answering.
import type { Automation, Globals } from '../../shared/schemas/look.ts';
import type { LibraryEntry, Rig } from '../../shared/schemas/rig.ts';
import SANDBOX_URL from '../sandbox.html?sandbox';
import type { LiveSet } from './live-set.ts';
import type { LayerInput, OutputCorrection } from './pattern-core.ts';
import type { Layer } from './ui/model.ts';

const LOAD_MS = 6000, INIT_MS = 1500;  // no `ready` by then: init anyway; then carry on (a look's `compiled` tells)
const SILENT_MS = 4000;          // owed a reply and heard nothing this long: the page is gone (it answers in 1.5 s)
const RENDER_MS = 8000;          // an export goes quiet while the page probes a hung layer
const FROZEN_GAP_MS = 1000;      // a watchdog tick this late: the tab was busy, throttled or frozen
export const RATES = [40, 30, 20];
export const BUDGET = 0.8;       // a frame's budget: this share of its interval (the rest: messages, the draw)
export const HEAVY = 0.4;        // a layer over this share of a 40 fps frame's budget is heavy
const budget = (rate: number) => (BUDGET * 1000) / rate;
const SLACK_MS = 4;              // a frame due this soon goes now, on this display frame
const EMPTY: readonly FrameError[] = Object.freeze([]);
const ema = (old: number | undefined, v: number) => (old ? old + (v - old) * 0.15 : v);  // smoothed over ~10 frames

/** A look's globals, automation and tempo, as the sandbox takes them; clock 'fresh': not continued from the look
 * before (the live stage, whose lanes make every viewer's clock the same). */
export type Extra = { globals?: Globals | null; automation?: Automation | null; bpm?: number; clock?: 'fresh' };

type Compiled = { id: string; ok: boolean; error?: string; params: Record<string, unknown> };   // params: untrusted
/** A layer's compile report (SPEC "Sandbox protocol"), each module's code added. */
export type Report = Compiled & { modules: (Compiled & { code: string; upgraded?: unknown })[] };
/** A layer (or one of its modules) that failed this frame. */
export type FrameError = { id: string; module?: string; error: string };
/** What the sandbox page says; it is checked as it arrives. */
type FromSandbox = { type: 'ready' } | { type: 'compiled'; layers?: (Compiled & { modules?: Compiled[] })[] }
  | { type: 'frame'; seq: number; rgb?: Float32Array; errors?: FrameError[]; ms: number;
    layerMs: Record<string, number> }
  | { type: 'progress'; seq: number; done: number } | { type: 'error'; seq?: number; error?: string }
  | { type: 'rendered'; seq: number; channels?: Uint8Array; errors?: FrameError[]; error?: string };
/** What the app asks of the sandbox page (SPEC "Sandbox protocol"). */
export type ToSandbox = { type: 'init'; rig: Rig; library: Pick<LibraryEntry, 'name' | 'code'>[] }
  | ({ type: 'look'; layers: (LayerInput & { id: string })[] } & Extra)
  | { type: 'frame'; seq: number; t: number; set?: LiveSet }
  | { type: 'render'; seq: number; start: number; frames: number; fps: number; brightness: number;
    correction: OutputCorrection };
type Status = 'loading' | 'ready' | 'warning' | 'dead';
type Frame = { seq: number; t: number; look: number };
type Render = { seq: number; frames: number; resolve: (c: Uint8Array) => void; reject: (e: Error) => void;
  onProgress?: (done: number, frames: number) => void };

export class Runtime {
  rig!: Rig; library: Pick<LibraryEntry, 'name' | 'code'>[] = []; iframe: HTMLIFrameElement | null = null;
  port: MessagePort | null = null; heard = false; deadTries = 0; playing = false;
  phase: 'idle' | 'loading' | 'init' | 'ready' | 'dead' = 'idle';
  layers: Layer[] = []; extra: Extra = {}; lookDirty = false; lookVersion = 0; frameLookVersion = -1; lastT = NaN;
  seq = 0; respawns: number[] = []; render_: Render | null = null;
  frame: Frame = { seq: 0, t: 0, look: 0 };     // reused: no garbage per frame
  frameMsg: { type: 'frame'; seq: number; t: number; set?: LiveSet } = { type: 'frame', seq: 0, t: 0 };
  liveSet: LiveSet | null = null; liveDirty = false;     // values for the next frame to set in place
  frameInFlight: Frame | null = null;
  lookQueue: Map<string, Map<string, string>>[] = [];   // per look sent, not compiled yet: its code, to tag the reply
  since = 0;         // when this phase began, or the page last spoke while owing us something
  rate = RATES[0]; due = 0; rateAt = 0; layerMs = new Map<string, number>(); stats = { fps: 0, ms: 0 };
  fpsCount = 0; fpsSince = performance.now(); lastCheck = performance.now();
  watchdog = setInterval(() => this._check(), 200);
  onMessage = (e: MessageEvent) => { if (e.source === this.iframe?.contentWindow) this._message(e.data); };
  container!: HTMLElement; time!: () => number;    // the show time now
  onFrame!: (rgb: Float32Array, t: number) => void; onCompiled!: (layers: Report[]) => void;
  onFrameErrors!: (errors: readonly FrameError[]) => void; onStatus!: (state: Status, detail?: string) => void;

  constructor(o: Pick<Runtime, 'container' | 'time' | 'onFrame' | 'onCompiled' | 'onFrameErrors' | 'onStatus'>) {
    Object.assign(this, o);
    window.addEventListener('message', this.onMessage);
  }

  /** The rig, and the library's sources for use(). */
  start(rig: Rig, library: Runtime['library']) {
    Object.assign(this, { rig, library });
    this._spawn();
  }

  /** layers as saved (+ enabled: false). */
  setLook(layers: Layer[], extra: Extra = {}) {
    this.layers = layers;
    this.extra = { globals: extra.globals, automation: extra.automation, bpm: extra.bpm, clock: extra.clock };
    this.lookDirty = true;
    for (const id of this.layerMs.keys()) if (!layers.some((l) => l.id === id)) this.layerMs.delete(id);
  }

  /** Values to set in place on the look before the next frame (and again after each new look). */
  setLive(set: LiveSet | null) { this.liveSet = set; this.liveDirty = !!set; }

  /** A fresh frame on the next pump even if nothing changed (after an export). */
  refresh() { this.lastT = NaN; }
  get ready() { return this.phase === 'ready'; }
  /** Layers whose time takes over HEAVY of a 40 fps frame's budget: Map id → ms. */
  heavy() {
    return new Map([...this.layerMs].filter(([, ms]) => ms > HEAVY * budget(RATES[0])));
  }

  /** Per animation frame: a pending look, then frame `t` when due and changed (always while playing). */
  pump(t: number, playing = false) {
    this.playing = playing;
    if (this.phase !== 'ready' || this.render_) return;
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
    if (this.liveDirty) { this.frameMsg.set = this.liveSet!; this.liveDirty = false; }
    this._post(this.frameMsg);          // cloned synchronously, so the object can be reused
    delete this.frameMsg.set;
    this.frameInFlight = f;
  }

  /** Should a paused loop keep ticking for time t? */
  pending(t: number) {
    return this.phase === 'ready' && !this.render_ && (this.lookDirty || !!this.frameInFlight || t !== this.lastT
      || this.frameLookVersion !== this.lookVersion);
  }

  /** Render frames for export → Uint8Array(frames × channelsPerFrame). */
  render({ start = 0, frames, fps = 40, brightness = 1, correction, onProgress }: { start?: number; frames: number;
    fps?: number; brightness?: number; correction: OutputCorrection; onProgress?: Render['onProgress'] }) {
    return new Promise<Uint8Array>((resolve, reject) => {
      if (this.phase !== 'ready') return reject(new Error('The pattern engine is not ready yet.'));
      if (this.render_) return reject(new Error('An export is already running.'));
      if (this.lookDirty) this._sendLook();
      const seq = ++this.seq;
      this._post({ type: 'render', seq, start, frames, fps, brightness, correction });
      this.render_ = { seq, resolve, reject, onProgress, frames };
    });
  }

  cancelRender() {
    if (!this.render_) return;
    this._failRender('Export cancelled.');
    this._respawn(); // the sandbox is busy rendering: start over with a fresh one
  }

  destroy() {
    this.phase = 'dead';
    clearInterval(this.watchdog);
    window.removeEventListener('message', this.onMessage);
    this._failRender('Closed.');
    this._kill();
  }

  _spawn() {
    const f = document.createElement('iframe');
    const attrs = { sandbox: 'allow-scripts', title: 'Pattern sandbox', 'aria-hidden': 'true', tabindex: '-1' };
    for (const [k, v] of Object.entries(attrs)) f.setAttribute(k, v);
    f.className = 'sandbox-frame';
    f.src = SANDBOX_URL;
    Object.assign(this, { iframe: f, heard: false, phase: 'loading', frameInFlight: null, since: performance.now() });
    this.onStatus('loading');
    this.container.append(f);
  }

  _kill() {
    this.iframe?.remove();
    this.port?.close();
    Object.assign(this, { iframe: null, port: null, frameInFlight: null, lookQueue: [] });
  }

  _failRender(message: string) {
    const r = this.render_;
    this.render_ = null;
    r?.reject(new Error(message));
  }

  _respawn() {
    const now = performance.now();
    this.respawns = [...this.respawns.filter((t) => now - t < 20000), now];
    this._kill();
    this._failRender('Export stopped: the pattern engine restarted.');
    if (this.respawns.length > 5) return this._die('The pattern engine keeps stopping. Reload the page to try again.');
    this.lookDirty = true;
    this._spawn();
  }

  _die(detail: string) {
    this.phase = 'dead';
    this.onStatus('dead', detail);
  }

  /** Owed anything: a frame, a compile, an export? */
  get owed() { return !!(this.frameInFlight || this.lookQueue.length || this.render_); }

  _post(msg: ToSandbox) {
    if (!this.owed) this.since = performance.now();     // the silence that counts starts with what we ask
    this.port?.postMessage(msg);
  }

  _sendInit() {
    this.phase = 'init';
    this.since = performance.now();
    const { port1, port2 } = new MessageChannel();
    this.port?.close();
    this.port = port1;
    port1.onmessage = (e) => { if (this.port === port1) this._message(e.data); };
    const init: ToSandbox = { type: 'init', rig: this.rig, library: this.library };
    this.iframe?.contentWindow?.postMessage(init, '*', [port2]);
  }

  _becomeReady() {
    if (this.phase !== 'init') return;
    this.phase = 'ready';
    this.lookDirty = true;
    this.onStatus('ready');
  }

  _sendLook() {
    this.lookDirty = false;
    this.lookVersion++;
    this._post({ type: 'look', ...this.extra, layers: this.layers });
    if (this.liveSet) this.liveDirty = true;
    this.lookQueue.push(new Map(this.layers.map((l) => [l.id, new Map(l.modules.map((m) => [m.id, m.code]))])));
  }

  /** A frame came back; while playing, one that came late asks for the next at once. */
  _frame(m: Extract<FromSandbox, { type: 'frame' }>, f: Frame) {
    this.frameInFlight = null;
    this.lastT = f.t;
    this.frameLookVersion = f.look;
    const now = performance.now(), st = this.stats;
    this.fpsCount++;
    if (now - this.fpsSince >= 1000) {
      st.fps = (this.fpsCount * 1000) / (now - this.fpsSince);
      this.fpsCount = 0;
      this.fpsSince = now;
    }
    if (+m.ms >= 0) st.ms = ema(st.ms, +m.ms);
    for (const id in m.layerMs) {
      const ms = +m.layerMs[id];
      if (ms >= 0) this.layerMs.set(id, ema(this.layerMs.get(id), ms));
    }
    // Step down while frames cost over budget; back up once well under the faster rate's, a second apart.
    const i = RATES.indexOf(this.rate);
    const next = st.ms > budget(this.rate) ? RATES[i + 1] : st.ms < 0.7 * budget(RATES[i - 1]) ? RATES[i - 1] : 0;
    if (next && now - this.rateAt > 1000) { this.rate = next; this.rateAt = now; }
    if (m.rgb) this.onFrame(m.rgb, f.t);
    this.onFrameErrors(Array.isArray(m.errors) ? m.errors : EMPTY);
    if (this.playing && !this.lookDirty && !this.render_) this._request(this.time());
  }

  _message(m: FromSandbox) {
    const r = this.render_;
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
    Object.assign(this, { heard: true, deadTries: 0, since: performance.now() });
    switch (m.type) {
      case 'ready':
        if (this.phase === 'loading') this._sendInit();
        else this._becomeReady();
        break;
      case 'compiled': {
        this._becomeReady();
        const codes = this.lookQueue.shift() || new Map<string, Map<string, string>>();
        this.onCompiled((Array.isArray(m.layers) ? m.layers : []).map((l) => ({ ...l,
          modules: (l.modules || []).map((x) => ({ ...x, code: codes.get(l.id)?.get(x.id) ?? '' })) })));
        break;
      }
      case 'frame':
        if (this.frameInFlight && m.seq === this.frameInFlight.seq) this._frame(m, this.frameInFlight);
        break;
      case 'progress':
        if (r && m.seq === r.seq) r.onProgress?.(m.done, r.frames);
        break;
      case 'rendered':
        if (!r || m.seq !== r.seq) break;
        this.render_ = null;
        if (Array.isArray(m.errors) && m.errors.length) this.onFrameErrors(m.errors);
        if (m.channels instanceof Uint8Array) r.resolve(m.channels);
        else r.reject(new Error(m.error || 'The sandbox returned no channel data.'));
        break;
      case 'error':
        if (r && (m.seq == null || m.seq === r.seq)) this._failRender(m.error || 'Render failed.');
        this.onStatus('warning', m.error || 'The sandbox reported an error.');
        break;
      default:
    }
  }

  _check() {
    const now = performance.now(), gap = now - this.lastCheck;
    this.lastCheck = now;
    if (gap > FROZEN_GAP_MS) this.since += gap;    // replies may be queued behind this very tick: no blame
    else if (this.phase === 'loading' && now - this.since > LOAD_MS) {
      this._sendInit();
      this.onStatus('warning', 'The pattern sandbox is slow to start.');
    } else if (this.phase === 'init' && now - this.since > INIT_MS) this._becomeReady();
    else if (this.phase === 'ready' && this.owed && now - this.since > (this.render_ ? RENDER_MS : SILENT_MS)) {
      this._hang();
    }
  }

  /** Rebuild a silent page (one that never spoke: retry a few times). */
  _hang() {
    if (this.heard) {
      this.onStatus('warning', 'The pattern engine stopped answering, so it was restarted.');
      return this._respawn();
    }
    this.deadTries++;
    this._kill();
    if (this.deadTries > 3) {
      return this._die('The pattern sandbox did not start (is sandbox.html served?). Reload to try again.');
    }
    this.phase = 'idle';
    this.onStatus('warning', 'The pattern sandbox is not answering; retrying…');
    setTimeout(() => {
      if (this.phase !== 'idle') return;
      this.lookDirty = true;
      this._spawn();
    }, 2500);
  }
}
