// runtime.js — the app side of the pattern sandbox (SPEC "Sandbox protocol").
//
// Pattern code is untrusted and never runs in this page: it goes to a hidden
// <iframe sandbox="allow-scripts" src="/sandbox.html"> (opaque origin, no network, no
// cookies) and only plain data comes back. This module:
//   • spawns the iframe, answers its `ready` with `init`, then sends the look;
//   • pumps frames, at most one in flight, each tagged with a sequence number;
//   • runs a backstop watchdog. The sandbox runs patterns in a Worker and catches hangs itself
//     (it answers every frame within 1.5 s and reports a hung layer as an error), so this only
//     fires if the sandbox page itself stops answering: then the iframe is torn down and
//     rebuilt, and the layer(s) to blame are parked on a stub until their code changes (when
//     the culprit is unknown, layers come back one at a time);
//   • renders frames for export.

const FRAME_TIMEOUT_MS = 4000;
const INIT_GRACE_MS = 1500;
const LOAD_TIMEOUT_MS = 6000;
const RENDER_STALL_MS = 8000;
const FROZEN_GAP_MS = 1000;      // a watchdog tick this late: the tab was busy, throttled or frozen
const PROBATION_FRAMES = 24;
const RECENT_CHANGE_FRAMES = 12;
const STUB_CODE = 'function pixel() { return [0, 0, 0]; }';
const EMPTY = Object.freeze([]);

export const HUNG_MESSAGE = 'Pattern hung: the pattern engine stopped answering, so this layer is paused. Edit the code to try again.';

export class Runtime {
  /**
   * @param {object} o
   * @param {HTMLElement} [o.container]  where the hidden iframe lives
   * @param {string} [o.src]
   * @param {(rgb: Float32Array, t: number) => void} [o.onFrame]
   * @param {(layers: Array<{id, ok, error?, params?, hung?}>) => void} [o.onCompiled]
   * @param {(errors: Array<{id, error}>) => void} [o.onFrameErrors]
   * @param {(ids: string[], info: {probation: boolean}) => void} [o.onHung]
   * @param {(state: string, detail?: string) => void} [o.onStatus]
   */
  constructor({ container = document.body, src = '/sandbox.html', onFrame, onCompiled, onFrameErrors, onHung, onStatus } = {}) {
    this.container = container;
    this.src = src;
    this.onFrame = onFrame || (() => {});
    this.onCompiled = onCompiled || (() => {});
    this.onFrameErrors = onFrameErrors || (() => {});
    this.onHung = onHung || (() => {});
    this.onStatus = onStatus || (() => {});

    this.cathedral = null;
    this.iframe = null;
    this.phase = 'idle';            // idle → loading → init → ready (→ dead)
    this.layers = [];               // what the app wants running
    this.lookDirty = false;
    this.lookVersion = 0;
    this.frameLookVersion = -1;
    this.lastT = NaN;
    this.seq = 0;
    this.frameInFlight = null;      // this._frame while a frame request is out, else null
    this._frame = { seq: 0, t: 0, sentAt: 0, look: 0 };     // reused: no garbage per frame
    this._frameMsg = { type: 'frame', seq: 0, t: 0 };
    this.waits = [];                // FIFO of non-frame replies we expect: { kind, since, seq? }
    this.sentCode = new Map();      // id → code the sandbox has (real code, not stubs)
    this.lookQueue = [];            // per look sent: id → the layer's code, to tag `compiled` replies
    this.quarantine = new Map();    // id → code that hung
    this.probation = [];            // ids parked only because the culprit was unknown
    this.lastChanged = [];
    this.framesSinceChange = Infinity;
    this.respawns = [];
    this.render_ = null;
    this.stats = { fps: 0, ms: 0 };
    this._fpsCount = 0;
    this._fpsSince = performance.now();

    this._onMessage = (e) => this._message(e);
    window.addEventListener('message', this._onMessage);
    this._lastCheck = performance.now();
    this._watchdog = setInterval(() => this._check(), 200);
  }

  start(cathedral) {
    this.cathedral = cathedral;
    this._spawn();
  }

  /** layers: [{ id, title, code, groups, blend, level, params }] — sent on the next pump. */
  setLook(layers) {
    this.layers = layers.map((l) => ({ ...l }));
    this.lookDirty = true;
  }

  /** The user wants a parked layer back now (e.g. pressed Retry). */
  retry(id) {
    this.quarantine.delete(id);
    this.probation = this.probation.filter((x) => x !== id);
    this.lookDirty = true;
  }

  isHung(id) { return this.quarantine.has(id); }

  /** Ask for a fresh frame on the next pump even if nothing changed (e.g. after an export). */
  refresh() { this.lastT = NaN; }

  get ready() { return this.phase === 'ready'; }

  /**
   * Call once per animation frame. Sends a pending look, then a frame request for time
   * `t` if none is in flight and something changed (or `force`).
   */
  pump(t, force = false) {
    if (this.phase !== 'ready' || this.render_) return;
    if (this.lookDirty) this._sendLook();
    if (this.frameInFlight) return;
    if (!force && t === this.lastT && this.frameLookVersion === this.lookVersion) return;
    const f = this._frame;
    f.seq = ++this.seq;
    f.t = t;
    f.sentAt = performance.now();
    f.look = this.lookVersion;
    this.frameInFlight = f;
    this._frameMsg.seq = f.seq;
    this._frameMsg.t = t;
    this._post(this._frameMsg);          // cloned synchronously, so the object can be reused
  }

  /** Does the pump still have work for time t (so a paused loop should keep ticking)? */
  pending(t) {
    if (this.phase !== 'ready' || this.render_) return false;
    return this.lookDirty || !!this.frameInFlight || t !== this.lastT || this.frameLookVersion !== this.lookVersion;
  }

  /** Render frames for export → Uint8Array(frames × channelsPerFrame). */
  render({ start = 0, frames, fps = 40, gamma = 1, brightness = 1, onProgress } = {}) {
    return new Promise((resolve, reject) => {
      if (this.phase !== 'ready') { reject(new Error('The pattern engine is not ready yet.')); return; }
      if (this.render_) { reject(new Error('An export is already running.')); return; }
      if (this.lookDirty) this._sendLook();
      const seq = ++this.seq;
      this.render_ = { seq, resolve, reject, onProgress, frames };
      this.waits.push({ kind: 'render', seq, since: performance.now() });
      this._post({ type: 'render', seq, start, frames, fps, gamma, brightness });
    });
  }

  cancelRender() {
    if (!this.render_) return;
    const r = this.render_;
    this.render_ = null;
    r.reject(new Error('Export cancelled.'));
    // The sandbox is busy rendering: start over with a fresh one.
    this._respawn('cancel');
  }

  destroy() {
    this.phase = 'dead';
    clearInterval(this._watchdog);
    window.removeEventListener('message', this._onMessage);
    if (this.render_) { this.render_.reject(new Error('Closed.')); this.render_ = null; }
    this._kill();
  }

  // -- iframe lifecycle -------------------------------------------------------------------

  _spawn() {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('title', 'Pattern sandbox');
    f.setAttribute('aria-hidden', 'true');
    f.setAttribute('tabindex', '-1');
    f.className = 'sandbox-frame';
    f.src = this.src;
    this.iframe = f;
    this.heard = false;
    this.phase = 'loading';
    this.waits = [{ kind: 'load', since: performance.now() }];
    this.frameInFlight = null;
    this.onStatus('loading');
    this.container.append(f);
  }

  _kill() {
    if (this.iframe) {
      try { this.iframe.src = 'about:blank'; } catch { /* ignore */ }
      this.iframe.remove();
    }
    this.iframe = null;
    this.frameInFlight = null;
    this.waits = [];
    this.lookQueue = [];
  }

  _respawn(reason) {
    const now = performance.now();
    this.respawns = this.respawns.filter((t) => now - t < 20000);
    this.respawns.push(now);
    this._kill();
    if (this.render_) {
      const r = this.render_;
      this.render_ = null;
      r.reject(new Error(reason === 'hang' ? 'Export stopped: a pattern hung.' : 'Export stopped: the pattern engine restarted.'));
    }
    if (this.respawns.length > 5) {
      this.phase = 'dead';
      this.onStatus('dead', 'The pattern engine keeps hanging. Reload the page to try again.');
      return;
    }
    this.sentCode = new Map();
    this.lookDirty = true;
    this._spawn();
  }

  _post(msg, transfer) {
    const w = this.iframe && this.iframe.contentWindow;
    if (w) w.postMessage(msg, '*', transfer || []);
  }

  _sendInit() {
    this.phase = 'init';
    this.waits = this.waits.filter((w) => w.kind !== 'load');
    this.waits.push({ kind: 'init', since: performance.now() });
    this._post({ type: 'init', cathedral: this.cathedral });
  }

  _becomeReady() {
    if (this.phase !== 'init') return;
    this.phase = 'ready';
    this.waits = this.waits.filter((w) => w.kind !== 'init');
    this.lookDirty = true;
    this.onStatus('ready');
  }

  _sendLook() {
    this.lookDirty = false;
    const changed = [];
    const out = this.layers.map((l) => {
      if (this.quarantine.has(l.id)) {
        if (this.quarantine.get(l.id) === l.code) return { ...l, code: STUB_CODE, level: 0, enabled: false };
        this.quarantine.delete(l.id);            // code changed: give it another go
        this.probation = this.probation.filter((x) => x !== l.id);
      }
      if (this.sentCode.get(l.id) !== l.code) changed.push(l.id);
      return l;
    });
    this.sentCode = new Map(out.filter((l) => l.code !== STUB_CODE).map((l) => [l.id, l.code]));
    if (changed.length) {
      this.lastChanged = changed;
      this.framesSinceChange = 0;
    }
    this.lookVersion++;
    this.lookQueue.push(new Map(this.layers.map((l) => [l.id, l.code])));
    this.waits.push({ kind: 'look', since: performance.now() });
    this._post({
      type: 'look',
      layers: out.map(({ id, title, code, groups, blend, level, params, clips, enabled }) => (
        { id, title, code, groups, blend, level, params, ...(clips ? { clips } : {}), enabled: enabled !== false })),
    });
  }

  // -- messages ---------------------------------------------------------------------------

  _message(e) {
    if (!this.iframe || e.source !== this.iframe.contentWindow) return;
    const m = e.data;
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
    this.heard = true;
    this.deadTries = 0;
    switch (m.type) {
      case 'ready':
        if (this.phase === 'loading') this._sendInit();
        else if (this.phase === 'init') this._becomeReady();
        break;
      case 'compiled': {
        this._done('look');
        if (this.phase === 'init') this._becomeReady();
        const codes = this.lookQueue.shift() || new Map();
        const layers = Array.isArray(m.layers) ? m.layers : [];
        this.onCompiled(layers.map((l) => (this.quarantine.has(l.id)
          ? { ...l, ok: false, hung: true, error: HUNG_MESSAGE, params: null, code: codes.get(l.id) }
          : { ...l, code: codes.get(l.id) })));
        break;
      }
      case 'frame': {
        const f = this.frameInFlight;
        if (!f || m.seq !== f.seq) break;
        this.frameInFlight = null;
        this.lastT = f.t;
        this.frameLookVersion = f.look;
        this.framesSinceChange++;
        const now = performance.now();
        this._fpsCount++;
        if (now - this._fpsSince >= 1000) {
          this.stats.fps = (this._fpsCount * 1000) / (now - this._fpsSince);
          this._fpsCount = 0;
          this._fpsSince = now;
        }
        if (typeof m.ms === 'number') this.stats.ms = m.ms;
        let errors = Array.isArray(m.errors) ? m.errors : EMPTY;
        if (errors.length && this.quarantine.size) errors = errors.filter((x) => !this.quarantine.has(x.id));
        if (m.rgb) this.onFrame(m.rgb, f.t);
        this.onFrameErrors(errors);
        this._probation();
        break;
      }
      case 'progress': {
        const r = this.render_;
        if (!r || m.seq !== r.seq) break;
        const w = this.waits.find((x) => x.kind === 'render' && x.seq === m.seq);
        if (w) w.since = performance.now();
        if (r.onProgress) r.onProgress(m.done, r.frames);
        break;
      }
      case 'rendered': {
        const r = this.render_;
        this._done('render', m.seq);
        if (!r || m.seq !== r.seq) break;
        this.render_ = null;
        if (Array.isArray(m.errors) && m.errors.length) this.onFrameErrors(m.errors);
        if (m.channels instanceof Uint8Array) r.resolve(m.channels);
        else r.reject(new Error(m.error || 'The sandbox returned no channel data.'));
        break;
      }
      case 'error': {
        // Not in the contract, but a sandbox may report a failure this way.
        if (this.render_ && (m.seq == null || m.seq === this.render_.seq)) {
          const r = this.render_;
          this.render_ = null;
          this._done('render', r.seq);
          r.reject(new Error(m.error || 'Render failed.'));
        }
        this.onStatus('warning', m.error || 'The sandbox reported an error.');
        break;
      }
      default:
        break;
    }
  }

  _done(kind, seq) {
    const i = this.waits.findIndex((w) => w.kind === kind && (seq == null || w.seq == null || w.seq === seq));
    if (i >= 0) this.waits.splice(i, 1);
  }

  _probation() {
    if (!this.probation.length || this.framesSinceChange < PROBATION_FRAMES) return;
    const id = this.probation.shift();
    this.quarantine.delete(id);
    this.lookDirty = true;
  }

  // -- watchdog ---------------------------------------------------------------------------

  _check() {
    const now = performance.now();
    const gap = now - this._lastCheck;
    this._lastCheck = now;
    if (this.phase === 'dead' || this.phase === 'idle') return;
    if (gap > FROZEN_GAP_MS) {
      // Replies may be queued behind this very tick: restart the clocks rather than blame patterns.
      if (this.frameInFlight) this.frameInFlight.sentAt += gap;
      for (const w of this.waits) w.since += gap;
      return;
    }
    if (this.frameInFlight && now - this.frameInFlight.sentAt > FRAME_TIMEOUT_MS) { this._hang('frame'); return; }
    if (!this.waits.length) return;
    for (const w of this.waits) {
      const age = now - w.since;
      if (w.kind === 'load' && age > LOAD_TIMEOUT_MS) {
        // No `ready` on load: try init anyway; if that fails too, the sandbox is broken.
        if (this.phase === 'loading') { this._sendInit(); this.onStatus('warning', 'The pattern sandbox is slow to start.'); }
        return;
      }
      if (w.kind === 'init' && age > INIT_GRACE_MS) {
        // Sandbox did not answer init with ready: carry on, the look's `compiled` will tell.
        this.waits = this.waits.filter((x) => x !== w);
        this.phase = 'init';
        this._becomeReady();
        return;
      }
      if (w.kind === 'look' && age > FRAME_TIMEOUT_MS) { this._hang('look'); return; }
      if (w.kind === 'render' && age > RENDER_STALL_MS) { this._hang('render'); return; }
    }
  }

  _hang(kind) {
    if (!this.heard) {
      // Not a pattern: the sandbox never said a word. Retry a few times, then give up.
      this.deadTries = (this.deadTries || 0) + 1;
      this._kill();
      if (this.deadTries > 3) {
        this.phase = 'dead';
        this.onStatus('dead', 'The pattern sandbox did not start (is /sandbox.html served?). Reload to try again.');
        return;
      }
      this.phase = 'idle';
      this.onStatus('warning', 'The pattern sandbox is not answering; retrying…');
      setTimeout(() => {
        if (this.phase !== 'idle') return;
        this.sentCode = new Map();
        this.lookDirty = true;
        this._spawn();
      }, 2500);
      return;
    }
    const ids = this.layers.map((l) => l.id).filter((id) => !this.quarantine.has(id));
    const recent = kind === 'look' || this.framesSinceChange < RECENT_CHANGE_FRAMES;
    let suspects = recent ? this.lastChanged.filter((id) => ids.includes(id)) : [];
    let probation = false;
    if (!suspects.length) {
      suspects = ids;
      probation = suspects.length > 1;
    }
    for (const id of suspects) {
      const layer = this.layers.find((l) => l.id === id);
      if (layer) this.quarantine.set(id, layer.code);
    }
    if (probation) this.probation = [...suspects];
    this.lastChanged = [];
    this.framesSinceChange = Infinity;
    this.onHung(suspects, { probation });
    this.onStatus('restarting', 'A pattern hung; restarting the sandbox.');
    this._respawn('hang');
  }
}
