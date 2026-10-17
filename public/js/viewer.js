// viewer.js — the Gothic Folly's LEDs as glowing points, in raw WebGL2.
//
// World space is the cathedral's own metres (SPEC "Ground rules"): x depth (front −x),
// y height, z left→right facing the portal from the playa. With y up and a right-handed
// look-at, a camera on the playa side (−x) looking toward +x sees +z on its right, so
// positions go to the GPU untouched.
//
// The camera orbits a target the same way td/common/view_camera.py does:
//   eye = target + (−flat·cos A, d·sin E, +flat·sin A),  flat = d·cos E
// (Angle 0 stands in front on the playa side, 90 on the cathedral's right; Fov is horizontal.)

const DEG = Math.PI / 180;
const EYE_HEIGHT = 1.7;      // folly_view's default Eye Height for Eyelock views
const MIN_EYE_Y = 0.25;      // keep the camera above the playa
const MAX_ELEV = 89;
const TWEEN_S = 0.9;

// ---- tiny column-major mat4 --------------------------------------------------------------

function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect; out[5] = f;
  out[10] = (far + near) * nf; out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

function lookAt(out, eye, at, up) {
  let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

function multiply(out, a, b) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a, b, t) => a + (b - a) * t;

// ---- shaders -----------------------------------------------------------------------------

const POINT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
layout(location = 2) in float aHi;
uniform mat4 uViewProj;
uniform float uScale;      // device px per metre at distance 1
uniform float uSize;       // sprite diameter, metres
uniform vec2 uPx;          // min, max sprite size in device px
uniform float uGhost;
uniform float uHiActive;
uniform float uGain;
out vec3 vColor;
out vec3 vGhost;
out float vHi;
void main() {
  vec4 p = uViewProj * vec4(aPos, 1.0);
  gl_Position = p;
  float px = uSize * uScale / max(p.w, 0.05);
  gl_PointSize = clamp(px, uPx.x, uPx.y);
  // Far away, keep a minimum sprite but dim it so the energy stays about right.
  float k = clamp(px / uPx.x, 0.35, 1.0);
  float hi = aHi * uHiActive;
  float sel = mix(1.0, mix(0.22, 1.0, aHi), uHiActive);
  vColor = aColor * uGain * k * sel;
  vGhost = mix(vec3(0.32, 0.40, 0.62) * uGhost * sel, vec3(0.0), hi) * k;
  vHi = hi * k;
}`;

const POINT_FS = `#version 300 es
precision mediump float;
in vec3 vColor;
in vec3 vGhost;
in float vHi;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 16.0);
  float halo = exp(-r2 * 4.5) * (1.0 - r2);
  float r = sqrt(r2);
  float ring = smoothstep(0.16, 0.26, r) * (1.0 - smoothstep(0.30, 0.44, r));
  vec3 c = vColor * (core * 0.95 + halo * 0.20)
         + vGhost * exp(-r2 * 40.0)
         + vec3(1.0, 0.70, 0.30) * ring * vHi * 0.55;
  outColor = vec4(c, 1.0);
}`;

const GRID_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in float aMajor;
uniform mat4 uViewProj;
out vec3 vPos;
out float vMajor;
void main() {
  vPos = aPos;
  vMajor = aMajor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const GRID_FS = `#version 300 es
precision mediump float;
in vec3 vPos;
in float vMajor;
uniform vec3 uCenter;
out vec4 outColor;
void main() {
  float d = length(vPos.xz - uCenter.xz);
  float f = 1.0 - smoothstep(8.0, 46.0, d);
  vec3 c = mix(vec3(0.30, 0.38, 0.62), vec3(0.42, 0.50, 0.80), vMajor);
  outColor = vec4(c, (0.10 + 0.10 * vMajor) * f);
}`;

const SKY_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p * 0.5;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const SKY_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 top = vec3(0.016, 0.022, 0.050);
  vec3 low = vec3(0.040, 0.052, 0.105);
  float g = smoothstep(0.0, 1.0, vUv.y);
  vec3 c = mix(low, top, g);
  float v = 1.0 - 0.35 * length(vUv - vec2(0.5, 0.55));
  outColor = vec4(c * v, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('Shader compile failed: ' + log);
  }
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Shader link failed: ' + gl.getProgramInfoLog(p));
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

// ---- the viewer --------------------------------------------------------------------------

export class Viewer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ views?: object, defaultView?: string, onError?: (msg) => void }} opts
   */
  constructor(canvas, { views = {}, defaultView = 'front', onError } = {}) {
    this.canvas = canvas;
    this.views = views;
    this.defaultView = defaultView === 'fit' || views[defaultView] ? defaultView : Object.keys(views)[0] || null;
    this.onError = onError || (() => {});
    this.options = { ghost: 0.14, size: 0.42, gain: 1 };
    this.count = 0;
    this.positions = null;
    this.colors = null;
    this.hiMask = null;
    this.cam = { target: [0.9, 9.3, -0.4], distance: 42, angle: 25, elevation: 12, fov: 45 };
    this.tween = null;
    this.inertia = null;
    this.dirty = true;
    this.pointers = new Map();
    this.drag = null;
    this.raf = 0;
    this.last = 0;
    this.destroyed = false;
    this.ok = false;
    this.viewProj = new Float32Array(16);
    this._proj = new Float32Array(16);
    this._view = new Float32Array(16);
    this._eyeV = [0, 0, 0];
    this._up = [0, 1, 0];
    this.center = [1, 0, -0.4];
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    // Touch devices get a lower pixel-ratio cap: the glow hides it and the battery thanks us.
    this.dprCap = matchMedia('(pointer: coarse)').matches ? 1.5 : 2;
    this._tick = (t) => this._loop(t);

    this._bind();
    this._initGL();
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

  // -- public API --------------------------------------------------------------------------

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
    if (this.ok) this._upload();
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
    const v = nameOrView === 'fit' ? this._fitView() : typeof nameOrView === 'string' ? this.views[nameOrView] : nameOrView;
    if (!v) return;
    const to = viewToCam(v);
    this._current(typeof nameOrView === 'string' ? nameOrView : null);
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
    const a = angle * DEG, e = elevation * DEG;
    const fwd = [Math.cos(e) * Math.cos(a), -Math.sin(e), -Math.cos(e) * Math.sin(a)];
    const right = [Math.sin(a), 0, Math.cos(a)];
    const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
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

  // -- GL setup ----------------------------------------------------------------------------

  _initGL() {
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) {
      this.ok = false;
      this.onError('This browser has no WebGL2, so the 3D preview is off. The patterns still run.');
      return;
    }
    this.gl = gl;
    try {
      this.points = program(gl, POINT_VS, POINT_FS);
      this.grid = program(gl, GRID_VS, GRID_FS);
      this.sky = program(gl, SKY_VS, SKY_FS);
    } catch (err) {
      this.ok = false;
      this.onError(err.message);
      return;
    }
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    this.maxPoint = range ? range[1] : 64;
    this.posBuf = gl.createBuffer();
    this.colorBuf = gl.createBuffer();
    this.hiBuf = gl.createBuffer();
    this.vao = gl.createVertexArray();
    this.gridVao = gl.createVertexArray();
    this.gridBuf = gl.createBuffer();
    this.skyVao = gl.createVertexArray();
    this.ok = true;
    if (this.positions) this._upload();
    this._buildGrid();
  }

  _upload() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.colors, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hiBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.hiMask, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.bindVertexArray(null);
    this._buildGrid();
  }

  _buildGrid() {
    if (!this.ok) return;
    const gl = this.gl;
    const c = this.center;
    const cx = Math.round(c[0] / 2) * 2, cz = Math.round(c[2] / 2) * 2;
    const R = 60, step = 2;
    const data = [];
    for (let i = -R; i <= R; i += step) {
      const major = i % 10 === 0 ? 1 : 0;
      data.push(cx + i, 0, cz - R, major, cx + i, 0, cz + R, major);
      data.push(cx - R, 0, cz + i, major, cx + R, 0, cz + i, major);
    }
    this.gridCount = data.length / 4;
    gl.bindVertexArray(this.gridVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
    gl.bindVertexArray(null);
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

  // -- camera ------------------------------------------------------------------------------

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

  _rotate(dxPx, dyPx) {
    const k = 0.32;
    this.cam.angle -= dxPx * k;
    this.cam.elevation += dyPx * k;
    this._clampCam();
    this._current(null);
    this.invalidate();
  }

  _pan(dxPx, dyPx) {
    const c = this.cam;
    const cssH = Math.max(1, this.canvas.clientHeight);
    const mpp = (2 * c.distance * Math.tan(this._vfov() / 2)) / cssH;
    const a = c.angle * DEG, e = c.elevation * DEG;
    const right = [Math.sin(a), 0, Math.cos(a)];
    // camera up = right × forward, forward points from eye to target
    const fwd = [Math.cos(e) * Math.cos(a), -Math.sin(e), -Math.cos(e) * Math.sin(a)];
    const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    for (let i = 0; i < 3; i++) c.target[i] += (-right[i] * dxPx + up[i] * dyPx) * mpp;
    this._clampCam();
    this._current(null);
    this.invalidate();
  }

  _zoom(factor) {
    this.cam.distance *= factor;
    this._clampCam();
    this._current(null);
    this.invalidate();
  }

  // -- input -------------------------------------------------------------------------------

  _bind() {
    const c = this.canvas;
    const L = this._listeners = [];
    const on = (type, fn, opts) => { c.addEventListener(type, fn, opts); L.push([type, fn, opts]); };

    on('contextmenu', (e) => e.preventDefault());
    on('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button > 2) return;
      c.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.tween = null;
      this.inertia = null;
      if (this.pointers.size === 1) {
        const pan = e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey || e.metaKey;
        this.drag = { mode: pan ? 'pan' : 'rotate', vx: 0, vy: 0, t: performance.now() };
      } else if (this.pointers.size === 2) {
        this.drag = { mode: 'pinch', ...this._pinchState() };
      }
    });
    on('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p || !this.drag) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.drag.mode === 'pinch') {
        if (this.pointers.size < 2) return;
        const s = this._pinchState();
        if (s.dist > 0 && this.drag.dist > 0) this._zoom(this.drag.dist / s.dist);
        this._pan(s.mx - this.drag.mx, s.my - this.drag.my);
        Object.assign(this.drag, s);
      } else if (this.drag.mode === 'rotate') {
        const now = performance.now();
        const dt = Math.max(1, now - this.drag.t);
        this.drag.vx = lerp(this.drag.vx, dx / dt, 0.5);
        this.drag.vy = lerp(this.drag.vy, dy / dt, 0.5);
        this.drag.t = now;
        this._rotate(dx, dy);
      } else {
        this._pan(dx, dy);
      }
    });
    const release = (e) => {
      if (!this.pointers.delete(e.pointerId)) return;
      if (this.pointers.size === 0) {
        const d = this.drag;
        if (d && d.mode === 'rotate' && !this.reduced.matches && performance.now() - d.t < 80) {
          const speed = Math.hypot(d.vx, d.vy);
          if (speed > 0.05) this.inertia = { vx: d.vx * 16, vy: d.vy * 16 };
        }
        this.drag = null;
      } else if (this.pointers.size === 1) {
        this.drag = { mode: 'rotate', vx: 0, vy: 0, t: performance.now() };
      }
    };
    on('pointerup', release);
    on('pointercancel', release);
    on('lostpointercapture', release);
    on('wheel', (e) => {
      e.preventDefault();
      if (this.tween) this._settleTween();
      this.tween = null;
      this.inertia = null;
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
      this._zoom(Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0012)));
    }, { passive: false });
    on('dblclick', (e) => { e.preventDefault(); this.resetView(); });
    on('keydown', (e) => {
      const step = e.shiftKey ? 40 : 15;
      let used = true;
      switch (e.key) {
        case 'ArrowLeft': e.altKey ? this._pan(-step, 0) : this._rotate(-step, 0); break;
        case 'ArrowRight': e.altKey ? this._pan(step, 0) : this._rotate(step, 0); break;
        case 'ArrowUp': e.altKey ? this._pan(0, -step) : this._rotate(0, -step); break;
        case 'ArrowDown': e.altKey ? this._pan(0, step) : this._rotate(0, step); break;
        case '+': case '=': this._zoom(0.88); break;
        case '-': case '_': this._zoom(1 / 0.88); break;
        case 'Home': case '0': this.resetView(); break;
        default: used = false;
      }
      if (used) { e.preventDefault(); this.tween = null; }
    });
    on('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; });
    on('webglcontextrestored', () => { this._initGL(); this.invalidate(); });
  }

  _pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  // -- frame loop ----------------------------------------------------------------------------

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
      this._draw();
    }
    if (this.tween || this.inertia) this.invalidate();
  }

  _settleTween() {
    // Interrupting a glide: keep where the camera is now (cam was updated in place).
    this.tween = null;
    this.cam.target = [...this.cam.target];
    this._clampCam();
  }

  _draw() {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // sky
    gl.useProgram(this.sky.p);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const vfov = this._vfov();
    perspective(this._proj, vfov, W / H, 0.05, 600);
    lookAt(this._view, this._eye(), this.cam.target, this._up);
    multiply(this.viewProj, this._proj, this._view);

    // ground grid
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.grid.p);
    gl.uniformMatrix4fv(this.grid.u.uViewProj, false, this.viewProj);
    gl.uniform3fv(this.grid.u.uCenter, this.center);
    gl.bindVertexArray(this.gridVao);
    gl.drawArrays(gl.LINES, 0, this.gridCount);

    // LEDs, additive
    if (this.count) {
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.points.p);
      const u = this.points.u;
      gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
      gl.uniform1f(u.uScale, H / (2 * Math.tan(vfov / 2)));
      gl.uniform1f(u.uSize, this.options.size);
      const dpr = this.dpr || 1;
      gl.uniform2f(u.uPx, 2.5 * dpr, Math.min(this.maxPoint, 180 * dpr));
      gl.uniform1f(u.uGhost, this.options.ghost);
      gl.uniform1f(u.uHiActive, this.hiActive ? 1 : 0);
      gl.uniform1f(u.uGain, this.options.gain);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.POINTS, 0, this.count);
    }
    gl.bindVertexArray(null);
  }

  /** Average brightness of the last drawn frame's LED colours (for tests and the idle hint). */
  litFraction() {
    if (!this.colors) return 0;
    let lit = 0;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      if (this.colors[j] + this.colors[j + 1] + this.colors[j + 2] > 0.02) lit++;
    }
    return lit / Math.max(1, this.count);
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
