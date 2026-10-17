// The app side of the pattern sandbox (SPEC "Sandbox protocol"). Pattern code never runs in this
// page: it goes to a hidden sandboxed iframe and only plain data comes back. This spawns the iframe,
// answers its `ready` with `init`, sends the look, pumps frames (one in flight) and renders exports.
// The sandbox pauses hung layers itself; this watchdog rebuilds the iframe only when it stops answering.

const FRAME_TIMEOUT_MS = 4000;
const INIT_GRACE_MS = 1500;
const LOAD_TIMEOUT_MS = 6000;
const RENDER_STALL_MS = 8000;
const FROZEN_GAP_MS = 1000;      // a watchdog tick this late: the tab was busy, throttled or frozen
const EMPTY = Object.freeze([]);

export class Runtime {
  /**
   * { container, onFrame(rgb, t), onCompiled([{ id, ok, error?, params?, code }]), onFrameErrors([{ id, error }]),
   *   onStatus(loading | ready | warning | dead, detail?) }
   */
  constructor({ container = document.body, src = '/sandbox.html', onFrame, onCompiled, onFrameErrors, onStatus } = {}) {
    const noop = () => {};
    Object.assign(this, { container, src, onFrame: onFrame || noop, onCompiled: onCompiled || noop,
      onFrameErrors: onFrameErrors || noop, onStatus: onStatus || noop });
    // phase: idle → loading → init → ready (→ dead)
    Object.assign(this, { cathedral: null, iframe: null, phase: 'idle', layers: [], lookDirty: false, lookVersion: 0,
      frameLookVersion: -1, lastT: NaN, seq: 0, respawns: [], render_: null, stats: { fps: 0, ms: 0 }, _fpsCount: 0,
      _fpsSince: performance.now() });
    this.frameInFlight = null;      // this._frame while a frame request is out
    this._frame = { seq: 0, t: 0, sentAt: 0, look: 0 };     // reused: no garbage per frame
    this._frameMsg = { type: 'frame', seq: 0, t: 0 };
    this.waits = [];                // FIFO of non-frame replies we expect: { kind, since, seq? }
    this.lookQueue = [];            // per look sent: id → the layer's code, to tag `compiled` replies
    this._onMessage = (e) => this._message(e);
    window.addEventListener('message', this._onMessage);
    this._lastCheck = performance.now();
    this._watchdog = setInterval(() => this._check(), 200);
  }

  start(cathedral) {
    this.cathedral = cathedral;
    this._spawn();
  }

  /** layers: [{ id, title, code, groups, blend, level, params, clips? }] — sent on the next pump. */
  setLook(layers) {
    this.layers = layers.map((l) => ({ ...l }));
    this.lookDirty = true;
  }

  /** Ask for a fresh frame on the next pump even if nothing changed (e.g. after an export). */
  refresh() { this.lastT = NaN; }
  get ready() { return this.phase === 'ready'; }

  /** Once per animation frame: sends a pending look, then asks for time `t` if something changed (or `force`). */
  pump(t, force = false) {
    if (this.phase !== 'ready' || this.render_) return;
    if (this.lookDirty) this._sendLook();
    if (this.frameInFlight) return;
    if (!force && t === this.lastT && this.frameLookVersion === this.lookVersion) return;
    const f = this._frame;
    Object.assign(f, { seq: ++this.seq, t, sentAt: performance.now(), look: this.lookVersion });
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
    this._failRender('Export cancelled.');
    this._respawn(); // the sandbox is busy rendering: start over with a fresh one
  }

  destroy() {
    this.phase = 'dead';
    clearInterval(this._watchdog);
    window.removeEventListener('message', this._onMessage);
    this._failRender('Closed.');
    this._kill();
  }

  _spawn() {
    const f = document.createElement('iframe');
    const attrs = { sandbox: 'allow-scripts', title: 'Pattern sandbox', 'aria-hidden': 'true', tabindex: '-1' };
    for (const [k, v] of Object.entries(attrs)) f.setAttribute(k, v);
    f.className = 'sandbox-frame';
    f.src = this.src;
    Object.assign(this, { iframe: f, heard: false, phase: 'loading', frameInFlight: null,
      waits: [{ kind: 'load', since: performance.now() }] });
    this.onStatus('loading');
    this.container.append(f);
  }

  _kill() {
    if (this.iframe) {
      try { this.iframe.src = 'about:blank'; } catch { /* ignore */ }
      this.iframe.remove();
    }
    Object.assign(this, { iframe: null, frameInFlight: null, waits: [], lookQueue: [] });
  }

  _failRender(message) {
    const r = this.render_;
    this.render_ = null;
    if (r) r.reject(new Error(message));
  }

  _respawn() {
    const now = performance.now();
    this.respawns = this.respawns.filter((t) => now - t < 20000);
    this.respawns.push(now);
    this._kill();
    this._failRender('Export stopped: the pattern engine restarted.');
    if (this.respawns.length > 5) {
      this.phase = 'dead';
      this.onStatus('dead', 'The pattern engine keeps stopping. Reload the page to try again.');
      return;
    }
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
    this.lookVersion++;
    this.lookQueue.push(new Map(this.layers.map((l) => [l.id, l.code])));
    this.waits.push({ kind: 'look', since: performance.now() });
    this._post({
      type: 'look',
      layers: this.layers.map(({ id, title, code, groups, blend, level, params, clips, enabled }) => (
        { id, title, code, groups, blend, level, params, ...(clips ? { clips } : {}), enabled: enabled !== false })),
    });
  }

  _message(e) {
    if (!this.iframe || e.source !== this.iframe.contentWindow) return;
    const m = e.data;
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
    this.heard = true;
    this.deadTries = 0;
    const r = this.render_;
    switch (m.type) {
      case 'ready':
        if (this.phase === 'loading') this._sendInit();
        else if (this.phase === 'init') this._becomeReady();
        break;
      case 'compiled': {
        this._done('look');
        if (this.phase === 'init') this._becomeReady();
        const codes = this.lookQueue.shift() || new Map();
        this.onCompiled((Array.isArray(m.layers) ? m.layers : []).map((l) => ({ ...l, code: codes.get(l.id) })));
        break;
      }
      case 'frame': {
        const f = this.frameInFlight;
        if (!f || m.seq !== f.seq) break;
        this.frameInFlight = null;
        this.lastT = f.t;
        this.frameLookVersion = f.look;
        const now = performance.now();
        this._fpsCount++;
        if (now - this._fpsSince >= 1000) {
          this.stats.fps = (this._fpsCount * 1000) / (now - this._fpsSince);
          this._fpsCount = 0;
          this._fpsSince = now;
        }
        if (typeof m.ms === 'number') this.stats.ms = m.ms;
        if (m.rgb) this.onFrame(m.rgb, f.t);
        this.onFrameErrors(Array.isArray(m.errors) ? m.errors : EMPTY);
        break;
      }
      case 'progress': {
        if (!r || m.seq !== r.seq) break;
        const w = this.waits.find((x) => x.kind === 'render' && x.seq === m.seq);
        if (w) w.since = performance.now();
        if (r.onProgress) r.onProgress(m.done, r.frames);
        break;
      }
      case 'rendered': {
        this._done('render', m.seq);
        if (!r || m.seq !== r.seq) break;
        this.render_ = null;
        if (Array.isArray(m.errors) && m.errors.length) this.onFrameErrors(m.errors);
        if (m.channels instanceof Uint8Array) r.resolve(m.channels);
        else r.reject(new Error(m.error || 'The sandbox returned no channel data.'));
        break;
      }
      case 'error':
        if (r && (m.seq == null || m.seq === r.seq)) {
          this._done('render', r.seq);
          this._failRender(m.error || 'Render failed.');
        }
        this.onStatus('warning', m.error || 'The sandbox reported an error.');
        break;
      default:
        break;
    }
  }

  _done(kind, seq) {
    const i = this.waits.findIndex((w) => w.kind === kind && (seq == null || w.seq == null || w.seq === seq));
    if (i >= 0) this.waits.splice(i, 1);
  }

  _check() {
    const now = performance.now();
    const gap = now - this._lastCheck;
    this._lastCheck = now;
    if (this.phase === 'dead' || this.phase === 'idle') return;
    if (gap > FROZEN_GAP_MS) {
      // Replies may be queued behind this very tick: restart the clocks rather than give up.
      if (this.frameInFlight) this.frameInFlight.sentAt += gap;
      for (const w of this.waits) w.since += gap;
      return;
    }
    if (this.frameInFlight && now - this.frameInFlight.sentAt > FRAME_TIMEOUT_MS) { this._hang(); return; }
    for (const w of this.waits) {
      const age = now - w.since;
      if (w.kind === 'load' && age > LOAD_TIMEOUT_MS) {
        // No `ready` on load: try init anyway; if that fails too, the sandbox is broken.
        if (this.phase !== 'loading') return;
        this._sendInit();
        this.onStatus('warning', 'The pattern sandbox is slow to start.');
        return;
      }
      if (w.kind === 'init' && age > INIT_GRACE_MS) {
        // Sandbox did not answer init with ready: carry on, the look's `compiled` will tell.
        this.waits = this.waits.filter((x) => x !== w);
        this._becomeReady();
        return;
      }
      if ((w.kind === 'look' && age > FRAME_TIMEOUT_MS) || (w.kind === 'render' && age > RENDER_STALL_MS)) {
        this._hang();
        return;
      }
    }
  }

  /** The sandbox page stopped answering: rebuild it (and, if it never spoke at all, retry a few times). */
  _hang() {
    if (this.heard) {
      this.onStatus('warning', 'The pattern engine stopped answering, so it was restarted.');
      this._respawn();
      return;
    }
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
      this.lookDirty = true;
      this._spawn();
    }, 2500);
  }
}
