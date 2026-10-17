// The viewer's WebGL2 side: shaders, matrices, buffers and the draw. Pure functions over a Viewer
// (viewer.js), which owns the state; nothing here allocates per frame.

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
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2]
        + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

const POINT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
layout(location = 2) in float aHi;
uniform mat4 uViewProj;
uniform float uScale;      // device px per metre at distance 1
uniform float uSize;       // sprite diameter, metres
uniform vec2 uPx;          // min, max sprite size in device px
uniform float uGhost, uHiActive, uGain;
out vec3 vColor, vGhost;
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
in vec3 vColor, vGhost;
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

/** Set up WebGL2 on v.canvas: programs and buffers (v.ok says whether it worked). */
export function initGL(v) {
  const gl = v.canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false,
    powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) {
    v.ok = false;
    v.onError('This browser has no WebGL2, so the 3D preview is off. The patterns still run.');
    return;
  }
  v.gl = gl;
  try {
    v.points = program(gl, POINT_VS, POINT_FS);
    v.grid = program(gl, GRID_VS, GRID_FS);
    v.sky = program(gl, SKY_VS, SKY_FS);
  } catch (err) {
    v.ok = false;
    v.onError(err.message);
    return;
  }
  const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  v.maxPoint = range ? range[1] : 64;
  Object.assign(v, { posBuf: gl.createBuffer(), colorBuf: gl.createBuffer(), hiBuf: gl.createBuffer(),
    gridBuf: gl.createBuffer(), vao: gl.createVertexArray(), gridVao: gl.createVertexArray(),
    skyVao: gl.createVertexArray(), ok: true });
  if (v.positions) upload(v);
  buildGrid(v);
}

/** Hand the LED positions, colours and highlight mask to the GPU. */
export function upload(v) {
  const gl = v.gl;
  gl.bindVertexArray(v.vao);
  const attrs = [[v.posBuf, v.positions, gl.STATIC_DRAW, 3, gl.FLOAT],
    [v.colorBuf, v.colors, gl.DYNAMIC_DRAW, 3, gl.FLOAT], [v.hiBuf, v.hiMask, gl.DYNAMIC_DRAW, 1, gl.UNSIGNED_BYTE]];
  attrs.forEach(([buf, data, usage, size, type], i) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, size, type, type === gl.UNSIGNED_BYTE, 0, 0);
  });
  gl.bindVertexArray(null);
  buildGrid(v);
}

/** The ground grid round the cathedral's footprint. */
export function buildGrid(v) {
  if (!v.ok) return;
  const gl = v.gl;
  const c = v.center;
  const cx = Math.round(c[0] / 2) * 2, cz = Math.round(c[2] / 2) * 2;
  const R = 60, step = 2;
  const data = [];
  for (let i = -R; i <= R; i += step) {
    const major = i % 10 === 0 ? 1 : 0;
    data.push(cx + i, 0, cz - R, major, cx + i, 0, cz + R, major);
    data.push(cx - R, 0, cz + i, major, cx + R, 0, cz + i, major);
  }
  v.gridCount = data.length / 4;
  gl.bindVertexArray(v.gridVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, v.gridBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
  gl.bindVertexArray(null);
}

/** One frame: sky, grid, then the LEDs as additive sprites. */
export function draw(v) {
  const gl = v.gl;
  const W = v.canvas.width, H = v.canvas.height;
  gl.viewport(0, 0, W, H);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  // sky
  gl.useProgram(v.sky.p);
  gl.bindVertexArray(v.skyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  const vfov = v._vfov();
  perspective(v._proj, vfov, W / H, 0.05, 600);
  lookAt(v._view, v._eye(), v.cam.target, v._up);
  multiply(v.viewProj, v._proj, v._view);

  // ground grid
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(v.grid.p);
  gl.uniformMatrix4fv(v.grid.u.uViewProj, false, v.viewProj);
  gl.uniform3fv(v.grid.u.uCenter, v.center);
  gl.bindVertexArray(v.gridVao);
  gl.drawArrays(gl.LINES, 0, v.gridCount);

  // LEDs, additive
  if (v.count) {
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(v.points.p);
    const u = v.points.u;
    gl.uniformMatrix4fv(u.uViewProj, false, v.viewProj);
    gl.uniform1f(u.uScale, H / (2 * Math.tan(vfov / 2)));
    gl.uniform1f(u.uSize, v.options.size);
    const dpr = v.dpr || 1;
    gl.uniform2f(u.uPx, 2.5 * dpr, Math.min(v.maxPoint, 180 * dpr));
    gl.uniform1f(u.uGhost, v.options.ghost);
    gl.uniform1f(u.uHiActive, v.hiActive ? 1 : 0);
    gl.uniform1f(u.uGain, v.options.gain);
    gl.bindVertexArray(v.vao);
    gl.drawArrays(gl.POINTS, 0, v.count);
  }
  gl.bindVertexArray(null);
}
