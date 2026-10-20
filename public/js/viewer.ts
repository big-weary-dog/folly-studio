// The rig's LEDs in WebGL2, drawn only when something changed: as glowing points (viewer-gl.ts), or on Mirage's
// night playa (playa/, loaded on first use). World space is the view frame (x front → back, y up, z left → right,
// metres): the rig's axes map onto it (SPEC "Rig"). The camera orbits a target as td/common/view_camera.py:
//   eye = target + (−flat·cos A, d·sin E, +flat·sin A),  flat = d·cos E   (Angle 0: the playa side)
// Its input: viewer-input.ts.
import type { Rig } from '../../shared/schemas/rig.ts';
import type { Playa } from './playa/renderer.ts';
import type { Venue, VenueGL } from './playa/venue.ts';
import { draw, initGL, type Program, upload } from './viewer-gl.ts';
import { bindInput, type Drag } from './viewer-input.ts';

/** A camera as td/config/views.json and a rig's `views` give it. */
export type View = { Target?: number[]; Distance?: number; Angle?: number; Elevation?: number; Fov?: number;
  Eyelock?: boolean };
type Cam = { target: number[]; distance: number; angle: number; elevation: number; fov: number };

const DEG = Math.PI / 180;
const EYE_HEIGHT = 1.7;      // folly_view's default Eye Height for Eyelock views
const MIN_EYE_Y = 0.25;      // keep the camera above the playa
const MAX_ELEV = 89;
const TWEEN_S = 0.9;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** A phone: a touch screen under the Studio's narrow width, where the preview draws its lightest. */
export const isPhone = () => matchMedia('(pointer: coarse) and (max-width: 899px)').matches;
/** Forward, right and up for an angle and elevation in degrees. */
function basis(angle: number, elevation: number) {
  const a = angle * DEG, e = elevation * DEG;
  const fwd = [Math.cos(e) * Math.cos(a), -Math.sin(e), -Math.cos(e) * Math.sin(a)];
  const right = [Math.sin(a), 0, Math.cos(a)];
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0]]; // right × forward
  return { fwd, right, up };
}

export class Viewer {
  canvas!: HTMLCanvasElement; views!: Record<string, View>; onError!: (message: string) => void;
  rig: Rig | null = null; count = 0; positions: Float32Array | null = null; colors: Float32Array | null = null;
  hiMask: Uint8Array | null = null; hiActive = false; bounds?: { min: number[]; max: number[] }; toView = frameOf();
  center = [1, 0, -0.4]; mode: 'playa' | 'points' = 'points'; playa: Playa | null = null; quality = 'auto';
  dirty = true; raf = 0; last = 0; _asked = 0; destroyed = false; ok = false; dpr = 1; frozen = false;
  drag: Drag | null = null; unbind: () => void;
  venueData: Venue | null = null; venue: VenueGL | null = null; venueOn = true; _venueAsk = 0;
  tween: { from: Cam; to: Cam; t: number } | null = null; inertia: { vx: number; vy: number } | null = null;
  defaultView: string | null; currentView?: string | null;
  onViewChange?: (name: string | null) => void; onRender?: (mode: 'playa' | 'points', tier?: string) => void;
  // insetTop: CSS px at the top kept clear for buttons over the view; views frame the rest.
  options = { ghost: 0.14, size: 0.42, gain: 1, insetTop: 0 };
  cam: Cam = { target: [0.9, 9.3, -0.4], distance: 42, angle: 25, elevation: 12, fov: 45 };
  viewProj = new Float32Array(16); _proj = new Float32Array(16); _view = new Float32Array(16);
  _eyeV = [0, 0, 0]; _up = [0, 1, 0];
  reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // Touch devices get a lower pixel-ratio cap, phones the lowest: the glow hides it and the battery thanks us.
  deviceDpr = isPhone() ? 1 : matchMedia('(pointer: coarse)').matches ? 1.5 : 2; dprCap = this.deviceDpr;
  _tick = (t: number) => this._loop(t);
  resizeObserver: ResizeObserver;
  // Set by initGL (viewer-gl.ts).
  gl!: WebGL2RenderingContext; points!: Program; grid!: Program; sky!: Program; maxPoint!: number; gridCount!: number;
  posBuf!: WebGLBuffer; colorBuf!: WebGLBuffer; hiBuf!: WebGLBuffer; gridBuf!: WebGLBuffer;
  vao!: WebGLVertexArrayObject; gridVao!: WebGLVertexArrayObject; skyVao!: WebGLVertexArrayObject;

  constructor(canvas: HTMLCanvasElement, { views = {}, defaultView = 'front', onError = () => {} }: { views?:
    Record<string, View>; defaultView?: string; onError?: (message: string) => void } = {}) {
    Object.assign(this, { canvas, views, onError });
    this.defaultView = defaultView === 'fit' || views[defaultView] ? defaultView : Object.keys(views)[0] || null;
    this.unbind = bindInput(this);
    initGL(this);
    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(canvas);
    this._resize();
    if (this.defaultView) this.setView(this.defaultView, { animate: false });
  }

  /** Draw on the next animation frame. */
  invalidate() {
    this.dirty = true;
    if (!this.raf && !this.destroyed && !this.frozen) {
      this.raf = requestAnimationFrame(this._tick);
      this._asked = performance.now();
    }
  }

  /** Frozen, nothing draws (orbits and colours wait) until thawed: a bug report's pause (SPEC "Bug reports"). */
  freeze(on: boolean) {
    this.frozen = on;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
    if (!on) this.invalidate();
  }

  /** The view drawn now and read in the same task (the drawing buffer is not kept past it), as a JPEG data URL at
   * most `width` px wide; null when it cannot be read. */
  snapshot(width = 960) {
    if (!this.ok || this.destroyed) return null;
    try {
      this.dirty = true;
      const playa = this.mode === 'playa' && this.playa;
      if (playa) playa.draw(); else draw(this);
      this.dirty = false;
      const c = this.canvas, k = Math.min(1, width / c.width), out = document.createElement('canvas');
      out.width = Math.round(c.width * k);
      out.height = Math.round(c.height * k);
      out.getContext('2d')?.drawImage(c, 0, 0, out.width, out.height);
      return out.toDataURL('image/jpeg', 0.8);
    } catch {
      return null;
    }
  }

  /** The installation (SPEC "Rig"): its pixels, bounds, views, axes and, for the Playa view, render hints. */
  setRig(rig: Rig) {
    const T = this.toView = frameOf(rig.axes), n = this.count = rig.count, pos = rig.pixels.pos;
    this.rig = rig;
    this.positions = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) this.positions.set(T(pos, 3 * i), 3 * i);
    this.colors = new Float32Array(n * 3);
    this.hiMask = new Uint8Array(n);
    const [a, c] = [T(rig.bounds.min), T(rig.bounds.max)];
    const b = this.bounds = { min: a.map((x, i) => Math.min(x, c[i])), max: a.map((x, i) => Math.max(x, c[i])) };
    this.center = [(b.min[0] + b.max[0]) / 2, 0, (b.min[2] + b.max[2]) / 2];
    if (rig.views) {
      this.views = Object.fromEntries(Object.entries(rig.views as Record<string, View>).map(([k, w]) => [k, { ...w,
        Target: w.Target && T(w.Target) }]));
    }
    if (this.defaultView !== 'fit' && !(this.defaultView && this.views[this.defaultView])) this.defaultView = 'fit';
    this.setView(this.defaultView, { animate: false });
    if (this.ok) upload(this);
    this.playa?.setRig();
    if (this.venueData) void this._venue();
    this.invalidate();
  }

  /** Props round the rig (SPEC "Venue"): scenery, never LEDs, shown when they name this rig; null for none. */
  async setVenue(venue: Venue | null) {
    this.venueData = venue;
    await this._venue();
  }

  showVenue(on: boolean) {
    this.venueOn = on;
    this.invalidate();
  }

  async _venue() {
    const d = this.venueData, ask = ++this._venueAsk;
    this.venue?.destroy();
    this.venue = null;
    if (d && this.ok && d.rig === this.rig?.name) {
      const { createVenue, venueMesh } = await import('./playa/venue.ts');     // on first use
      if (this.destroyed || ask !== this._venueAsk) return;                    // a newer ask builds it
      this.venue = createVenue(this.gl, venueMesh(d, this.toView));
    }
    this.invalidate();
  }

  /** 'playa' (playa/ loads on first use; Points if it cannot run here) or 'points'. Resolves to the mode shown. */
  async setMode(mode: string) {
    this.mode = mode === 'playa' && this.rig && this.ok ? 'playa' : 'points';
    try {
      if (this.mode === 'playa') this.playa ||= (await import('./playa/renderer.ts')).createPlaya(this);
      if (this.mode === 'playa') this.playa?.setQuality(this.quality);
    } catch {
      this.mode = 'points';
    }
    if (this.mode === 'points') {
      this.setPixelRatio(this.deviceDpr);
      if (this.ok && this.colors) upload(this);
      this.onRender?.('points');
    }
    this.invalidate();
    return this.mode;
  }

  /** The Playa view's quality: 'auto' (by device, then by measured frame time), 'full', 'lite' or 'low'. */
  setQuality(q: string) {
    this.quality = q;
    this.playa?.setQuality(q);
  }

  /** At most this many device pixels per CSS pixel (never past the device's cap). */
  setPixelRatio(cap: number) {
    this.dprCap = Math.min(cap, this.deviceDpr);
    this._resize();
  }

  /** rgb: count × 3, 0..1, transferred to us by the sandbox: kept, not copied. */
  setColors(rgb: Float32Array) {
    if (!this.colors || !rgb || rgb.length < this.count * 3) return;
    this.colors = rgb;
    this._buffer(this.colorBuf, rgb, this.count * 3);
  }

  /** mask: 1 per highlighted LED, or null. */
  setHighlight(mask: Uint8Array | null) {
    if (!this.hiMask) return;
    this.hiActive = !!mask;
    for (let i = 0; i < this.count; i++) this.hiMask[i] = mask?.[i] ? 255 : 0;
    this._buffer(this.hiBuf, this.hiMask, this.count);
  }

  _buffer(buf: WebGLBuffer, data: Float32Array | Uint8Array, n: number) {
    if (this.mode === 'playa' && this.playa) this.playa.light();
    else if (this.ok) {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buf);
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, data, 0, n);
    }
    this.invalidate();
  }

  setOption(key: keyof Viewer['options'], value: number) {
    if (this.options[key] === value) return;
    this.options[key] = value;
    if (key === 'gain') this.playa?.light();
    if (key === 'insetTop') this._refit();
    this.invalidate();
  }

  _frameH() {
    return Math.max(1, this.canvas.height - Math.round(this.options.insetTop * this.dpr));
  }

  /** A named view, or a views.json view object. */
  setView(nameOrView: string | View | null, { animate = true } = {}) {
    const named = typeof nameOrView === 'string';
    const v = nameOrView === 'fit' ? this._fitView() : named ? this.views[nameOrView] : nameOrView;
    if (!v) return;
    const to = viewToCam(v);
    if ((named ? nameOrView : null) !== this.currentView) {
      this.currentView = named ? nameOrView : null;
      this.onViewChange?.(this.currentView);
    }
    this.inertia = null;
    if (!animate || this.reduced.matches) {
      this.cam = to;
      this.tween = null;
      this._clampCam();
    } else {
      const from = { ...this.cam, target: [...this.cam.target] };
      to.angle = from.angle + (((to.angle - from.angle) % 360) + 540) % 360 - 180;
      this.cam = { ...from, target: [...from.target] };
      this.tween = { from, to, t: 0 };
    }
    this.invalidate();
  }

  /** On "fit", frame the cathedral again (after a resize or a new inset). */
  _refit() { if (this.currentView === 'fit' && !this.drag) this.setView('fit', { animate: false }); }

  /** A view with every LED inside this canvas. */
  _fitView(angle = 28, elevation = 9, fov = 50): View | null {
    const b = this.bounds, P = this.positions;
    if (!b || !P) return null;
    const target = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2);
    const tanV = Math.tan(this._vfov(fov) / 2), tanH = tanV * (this.canvas.width / this._frameH() || 16 / 9);
    const { fwd, right, up } = basis(angle, elevation);
    let d = 5;
    for (let i = 0; i < P.length; i += 3) {
      const ox = P[i] - target[0], oy = P[i + 1] - target[1], oz = P[i + 2] - target[2];
      const of = ox * fwd[0] + oy * fwd[1] + oz * fwd[2];
      const or = ox * right[0] + oz * right[2];
      const ou = ox * up[0] + oy * up[1] + oz * up[2];
      d = Math.max(d, Math.abs(or) / tanH - of, Math.abs(ou) / tanV - of);
    }
    return { Target: target, Distance: d * 1.06, Angle: angle, Elevation: elevation, Fov: fov, Eyelock: false };
  }

  resetView() { this.setView(this.defaultView || 'fit'); }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.unbind();
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }

  _resize() {
    const dpr = this.dpr = Math.min(window.devicePixelRatio || 1, this.dprCap), c = this.canvas;
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), hgt = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== hgt) Object.assign(c, { width: w, height: hgt }); // a resize clears it
    this._refit();
    this.invalidate();
  }

  _eye(cam = this.cam, out = this._eyeV) {
    const a = cam.angle * DEG, e = clamp(cam.elevation, -MAX_ELEV, MAX_ELEV) * DEG;
    const flat = cam.distance * Math.cos(e);
    out[0] = cam.target[0] - flat * Math.cos(a);
    out[1] = cam.target[1] + cam.distance * Math.sin(e);
    out[2] = cam.target[2] + flat * Math.sin(a);
    return out;
  }

  /** The vertical field of view (radians) for a horizontal Fov in degrees; past 16:9 it keeps 16:9's height. */
  _vfov(fov = this.cam.fov) {
    const aspect = Math.min(16 / 9, this.canvas.width / this._frameH());
    return clamp(2 * Math.atan(Math.tan(clamp(fov, 10, 120) * DEG / 2) / aspect), 10 * DEG, 115 * DEG);
  }

  _clampCam() {
    const c = this.cam;
    c.distance = clamp(c.distance, 1.5, 260);
    const minE = Math.asin(clamp((MIN_EYE_Y - c.target[1]) / c.distance, -1, 1)) / DEG;
    c.elevation = clamp(c.elevation, Math.max(-60, minE), MAX_ELEV);
    c.target[1] = clamp(c.target[1], -2, 40);
  }

  _moved() {
    this._clampCam();
    if (this.currentView !== null) { this.currentView = null; this.onViewChange?.(null); }
    this.invalidate();
  }

  _rotate(dxPx: number, dyPx: number) {
    this.cam.angle -= dxPx * 0.32;
    this.cam.elevation += dyPx * 0.32;
    this._moved();
  }

  _pan(dxPx: number, dyPx: number) {
    const c = this.cam;
    const mpp = (2 * c.distance * Math.tan(this._vfov() / 2)) / (this._frameH() / this.dpr);
    const { right, up } = basis(c.angle, c.elevation);
    for (let i = 0; i < 3; i++) c.target[i] += (-right[i] * dxPx + up[i] * dyPx) * mpp;
    this._moved();
  }

  _zoom(factor: number) {
    this.cam.distance *= factor;
    this._moved();
  }

  _loop(now: number) {
    this.raf = 0;
    if (this.destroyed || this.frozen) return;
    // After an idle spell the first step is one ordinary frame, not the whole gap.
    const dt = this.last && now - this.last < 100 ? (now - this.last) / 1000 : 1 / 60;
    this.last = now;
    const tw = this.tween, ine = this.inertia;
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / TWEEN_S);
      const k = ease(tw.t), f = tw.from, to = tw.to, c = this.cam;        // in place: no garbage per frame
      for (let i = 0; i < 3; i++) c.target[i] = lerp(f.target[i], to.target[i], k);
      c.distance = Math.exp(lerp(Math.log(f.distance), Math.log(to.distance), k));
      c.angle = lerp(f.angle, to.angle, k);
      c.elevation = lerp(f.elevation, to.elevation, k);
      c.fov = lerp(f.fov, to.fov, k);
      if (tw.t >= 1) { this.tween = null; this._clampCam(); }
      this.dirty = true;
    } else if (ine) {
      this._rotate(ine.vx, ine.vy);
      const decay = Math.pow(0.04, dt);
      ine.vx *= decay; ine.vy *= decay;
      if (Math.hypot(ine.vx, ine.vy) < 0.05) this.inertia = null;
    }
    if (this.dirty && this.ok) {
      this.dirty = false;
      const playa = this.mode === 'playa' && this.playa;
      if (playa) playa.draw(); else draw(this);
      if (playa) playa.sample(performance.now() - this._asked);   // asked to drawn: the GPU's backlog shows here
    }
    if (this.tween || this.inertia) this.invalidate();
  }
}

/** The rig's axes ({ up: '+y', front: '-x', right: '+z' }) → (p, offset) → [x, y, z] in the view frame. */
export function frameOf(axes: Partial<Record<'up' | 'front' | 'right', string>> = {}) {
  const ax = (s: string | undefined, d: number[], m = /^([+-]?)([xyz])$/.exec(s || '')) => (m
    ? ['xyz'.indexOf(m[2]), m[1] === '-' ? -1 : 1] : d);
  const f = ax(axes.front, [0, -1]), map = [[f[0], -f[1]], ax(axes.up, [1, 1]), ax(axes.right, [2, 1])];
  const m = new Set(map.map((a) => a[0])).size === 3 ? map : [[0, 1], [1, 1], [2, 1]];
  return (p: ArrayLike<number>, o = 0) => m.map(([i, sign]) => sign * p[o + i]);
}

/** Views from views.json → orbit state. Eyelock views stand at eye height. */
function viewToCam(v: View): Cam {
  const target = [...(v.Target || [0.9, 9.3, -0.4])];
  const d = v.Distance ?? 40, angle = v.Angle ?? 0, fov = v.Fov ?? 45;
  if (v.Eyelock) {
    const dy = EYE_HEIGHT - target[1];
    const flat = Math.sqrt(Math.max(d * d - dy * dy, 0.25));
    return { target, distance: Math.hypot(flat, dy), angle, elevation: Math.atan2(dy, flat) / DEG, fov };
  }
  return { target, distance: d, angle, elevation: v.Elevation ?? 0, fov };
}
