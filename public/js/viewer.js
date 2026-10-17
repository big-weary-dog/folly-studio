// The Gothic Folly's LEDs as glowing points, in raw WebGL2. World space is the cathedral's metres
// (SPEC "Ground rules"): x depth (front −x), y up, z left→right from the playa, so positions go to
// the GPU untouched. The camera orbits a target as td/common/view_camera.py does:
//   eye = target + (−flat·cos A, d·sin E, +flat·sin A),  flat = d·cos E   (Angle 0: the playa side)
// viewer-gl.js draws; viewer-input.js turns pointer and keys into camera moves.

import { draw, initGL, upload } from './viewer-gl.js';
import { bindInput } from './viewer-input.js';

const DEG = Math.PI / 180;
const EYE_HEIGHT = 1.7;      // folly_view's default Eye Height for Eyelock views
const MIN_EYE_Y = 0.25;      // keep the camera above the playa
const MAX_ELEV = 89;
const TWEEN_S = 0.9;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a, b, t) => a + (b - a) * t;
/** The camera's forward, right and up vectors for an angle and elevation in degrees. */
function basis(angle, elevation) {
  const a = angle * DEG, e = elevation * DEG;
  const fwd = [Math.cos(e) * Math.cos(a), -Math.sin(e), -Math.cos(e) * Math.sin(a)];
  const right = [Math.sin(a), 0, Math.cos(a)];
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0]]; // right × forward
  return { fwd, right, up };
}

export class Viewer {
  /** new Viewer(canvas, { views, defaultView, onError(msg) }) */
  constructor(canvas, { views = {}, defaultView = 'front', onError } = {}) {
    Object.assign(this, { canvas, views, onError: onError || (() => {}), count: 0, positions: null, colors: null,
      hiMask: null, tween: null, inertia: null, dirty: true, pointers: new Map(), drag: null, raf: 0, last: 0,
      destroyed: false, ok: false, center: [1, 0, -0.4], _eyeV: [0, 0, 0], _up: [0, 1, 0] });
    this.defaultView = defaultView === 'fit' || views[defaultView] ? defaultView : Object.keys(views)[0] || null;
    this.options = { ghost: 0.14, size: 0.42, gain: 1 };
    this.cam = { target: [0.9, 9.3, -0.4], distance: 42, angle: 25, elevation: 12, fov: 45 };
    this.viewProj = new Float32Array(16);
    this._proj = new Float32Array(16);
    this._view = new Float32Array(16);
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    // Touch devices get a lower pixel-ratio cap: the glow hides it and the battery thanks us.
    this.dprCap = matchMedia('(pointer: coarse)').matches ? 1.5 : 2;
    this._tick = (t) => this._loop(t);

    bindInput(this);
    initGL(this);
    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(canvas);
    this._resize();
    if (this.defaultView) this.setView(this.defaultView, { animate: false });
    this.invalidate();
  }

  /** Draw on the next animation frame. Nothing runs while the picture is still. */
  invalidate() {
    this.dirty = true;
    if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame(this._tick);
  }

  setCathedral(cathedral) {
    this.count = cathedral.count;
    this.positions = new Float32Array(cathedral.pixels.pos);
    this.colors = new Float32Array(this.count * 3);
    this.hiMask = new Uint8Array(this.count);
    const b = cathedral.bounds;
    this.bounds = b;
    this.center = [(b.min[0] + b.max[0]) / 2, 0, (b.min[2] + b.max[2]) / 2];
    if (cathedral.views) this.views = cathedral.views;
    if (this.defaultView !== 'fit' && !this.views[this.defaultView]) this.defaultView = 'fit';
    this.setView(this.defaultView, { animate: false });
    if (this.ok) upload(this);
    this.invalidate();
  }

  /** rgb: Float32Array(count × 3), 0..1 */
  setColors(rgb) {
    const n = this.count * 3;
    if (!this.colors || !rgb || rgb.length < n) return;
    this.colors = rgb;                    // transferred to us by the sandbox: keep it, no copy
    if (this.ok) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, rgb, 0, n);
    }
    this.invalidate();
  }

  /** mask: Uint8Array(count) with 1 for highlighted LEDs, or null for none. */
  setHighlight(mask) {
    if (!this.hiMask) return;
    this.hiActive = !!mask;
    if (mask) {
      for (let i = 0; i < this.count; i++) this.hiMask[i] = mask[i] ? 255 : 0;
    } else this.hiMask.fill(0);
    if (this.ok) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.hiBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.hiMask);
    }
    this.invalidate();
  }

  setOption(key, value) {
    this.options[key] = value;
    this.invalidate();
  }

  /** Go to a named view (or a view object with Target/Distance/Angle/Elevation/Fov/Eyelock). */
  setView(nameOrView, { animate = true } = {}) {
    const named = typeof nameOrView === 'string';
    const v = nameOrView === 'fit' ? this._fitView() : named ? this.views[nameOrView] : nameOrView;
    if (!v) return;
    const to = viewToCam(v);
    this._current(named ? nameOrView : null);
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

  /** A view that frames the whole cathedral in this canvas: every bounding-box corner inside. */
  _fitView(angle = 28, elevation = 9, fov = 50) {
    const b = this.bounds;
    if (!b) return null;
    const target = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const aspect = this.canvas.width / Math.max(1, this.canvas.height) || 16 / 9;
    const tanV = Math.tan(this._vfovFor(fov) / 2), tanH = tanV * aspect;
    const { fwd, right, up } = basis(angle, elevation);
    // Every LED inside the frame (tighter than the bounding box's corners).
    const P = this.positions;
    let d = 5;
    for (let i = 0, n = P ? P.length : 0; i < n; i += 3) {
      const ox = P[i] - target[0], oy = P[i + 1] - target[1], oz = P[i + 2] - target[2];
      const of = ox * fwd[0] + oy * fwd[1] + oz * fwd[2];
      const or = ox * right[0] + oz * right[2];
      const ou = ox * up[0] + oy * up[1] + oz * up[2];
      d = Math.max(d, Math.abs(or) / tanH - of, Math.abs(ou) / tanV - of);
    }
    return { Target: target, Distance: d * 1.06, Angle: angle, Elevation: elevation, Fov: fov, Eyelock: false };
  }

  _current(name) {
    if (name === this.currentView) return;
    this.currentView = name;
    if (this.onViewChange) this.onViewChange(name);
  }

  resetView() { this.setView(this.defaultView || 'fit'); }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    for (const [type, fn, opts] of this._listeners) this.canvas.removeEventListener(type, fn, opts);
    const ext = this.gl && this.gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const hgt = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== hgt) {
      this.canvas.width = w;
      this.canvas.height = hgt;
    }
    this.dpr = dpr;
    if (this.currentView === 'fit' && !this.drag) this.setView('fit', { animate: false });
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

  _vfov() { return this._vfovFor(this.cam.fov); }

  _vfovFor(fov) {
    // Fov is horizontal (views.json). On a very wide canvas that would crop the spires, so
    // past 16:9 the frame keeps the 16:9 height and simply shows more to the sides.
    const aspect = Math.min(16 / 9, this.canvas.width / Math.max(1, this.canvas.height));
    const h = clamp(fov, 10, 120) * DEG;
    return clamp(2 * Math.atan(Math.tan(h / 2) / aspect), 10 * DEG, 115 * DEG);
  }

  _clampCam() {
    const c = this.cam;
    c.distance = clamp(c.distance, 1.5, 260);
    const minE = Math.asin(clamp((MIN_EYE_Y - c.target[1]) / c.distance, -1, 1)) / DEG;
    c.elevation = clamp(c.elevation, Math.max(-60, minE), MAX_ELEV);
    c.target[1] = clamp(c.target[1], -2, 40);
  }

  /** The camera moved by hand: it is on no named view now. */
  _moved() {
    this._clampCam();
    this._current(null);
    this.invalidate();
  }

  _rotate(dxPx, dyPx) {
    this.cam.angle -= dxPx * 0.32;
    this.cam.elevation += dyPx * 0.32;
    this._moved();
  }

  _pan(dxPx, dyPx) {
    const c = this.cam;
    const mpp = (2 * c.distance * Math.tan(this._vfov() / 2)) / Math.max(1, this.canvas.clientHeight);
    const { right, up } = basis(c.angle, c.elevation);
    for (let i = 0; i < 3; i++) c.target[i] += (-right[i] * dxPx + up[i] * dyPx) * mpp;
    this._moved();
  }

  _zoom(factor) {
    this.cam.distance *= factor;
    this._moved();
  }

  _loop(now) {
    this.raf = 0;
    if (this.destroyed) return;
    // After an idle spell the first step is one ordinary frame, not the whole gap.
    const dt = this.last && now - this.last < 100 ? (now - this.last) / 1000 : 1 / 60;
    this.last = now;

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / TWEEN_S);
      const k = ease(tw.t);
      const f = tw.from, to = tw.to, c = this.cam;        // update in place: no garbage per frame
      for (let i = 0; i < 3; i++) c.target[i] = lerp(f.target[i], to.target[i], k);
      c.distance = Math.exp(lerp(Math.log(f.distance), Math.log(to.distance), k));
      c.angle = lerp(f.angle, to.angle, k);
      c.elevation = lerp(f.elevation, to.elevation, k);
      c.fov = lerp(f.fov, to.fov, k);
      if (tw.t >= 1) { this.tween = null; this._clampCam(); }
      this.dirty = true;
    } else if (this.inertia) {
      const ine = this.inertia;
      this._rotate(ine.vx, ine.vy);
      const decay = Math.pow(0.04, dt);
      ine.vx *= decay; ine.vy *= decay;
      if (Math.hypot(ine.vx, ine.vy) < 0.05) this.inertia = null;
    }

    if (this.dirty && this.ok) {
      this.dirty = false;
      draw(this);
    }
    if (this.tween || this.inertia) this.invalidate();
  }

  _settleTween() {
    // Interrupting a glide: keep where the camera is now (cam was updated in place).
    this.tween = null;
    this.cam.target = [...this.cam.target];
    this._clampCam();
  }
}

/** Views from views.json → orbit state. Eyelock views stand at eye height. */
export function viewToCam(v) {
  const target = [...(v.Target || [0.9, 9.3, -0.4])];
  const d = v.Distance ?? 40, angle = v.Angle ?? 0, fov = v.Fov ?? 45;
  if (v.Eyelock) {
    const dy = EYE_HEIGHT - target[1];
    const flat = Math.sqrt(Math.max(d * d - dy * dy, 0.25));
    return { target, distance: Math.hypot(flat, dy), angle, elevation: Math.atan2(dy, flat) / DEG, fov };
  }
  return { target, distance: d, angle, elevation: v.Elevation ?? 0, fov };
}
