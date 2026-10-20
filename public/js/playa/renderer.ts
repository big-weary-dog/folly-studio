// The Playa view (Viewer mode 'playa'): each frame's light goes to one RGBA16F texture (rgb; highlight in a) that
// every fixture samples by pixel index. The scene renders in HDR, then bloom and Mirage's tone map. Tiers trade
// bloom, spill lights, tube detail and pixel ratio; 'auto' starts by device and steps down while frames are slow.
import { isPhone, type Viewer } from '../viewer.ts';
import { camera, type Program, program } from '../viewer-gl.ts';
import { buildGeometry, cluster, type Geometry, playa } from './geometry.ts';
import { GLSL } from './glsl.ts';

const TIERS = [
  { name: 'full', dpr: 2, bloom: 2, levels: 5, spill: 16 },
  { name: 'lite', dpr: 1, bloom: 4, levels: 2, spill: 6, lite: 1 },
  { name: 'low', dpr: 1, bloom: 0, levels: 0, spill: 4, lite: 1 },
];
const ROW = 512;            // pixels a row in the light texture (the shaders' k & 511, k >> 9)
// Linear emission at full drive (Mirage's `emit`), the playa's share of the light, the bloom's threshold.
const K = { strip: 1.4, point: 2.2, cell: 1, beam: 0.05, shell: 0.75, line: 0.2, ground: 0.25, bloom: 0.4,
  venue: 0.6 };
const HAZE = [0.0033, 0.0048, 0.0116];       // glsl.ts HZ: the venue fades into it
const SPILL = 0.035, THRESHOLD = 1, SLOW_MS = 30;
const coarse = () => (matchMedia('(pointer: coarse)').matches ? 1 : 0);
type Shader = keyof typeof GLSL;
type Uniform = number | number[] | Float32Array;
type Uniforms = Record<string, Uniform>;
/** A float render target: its texture and framebuffer, with depth for the scene. */
type Target = { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number; depth: WebGLRenderbuffer | null };
/** The view's GL state: per rig (geometry, buffers, the light texture), per tier (spill lights), per size (targets). */
interface State {
  gl: WebGL2RenderingContext; v: Viewer; phone: boolean; tier: number; quality: string; samples: number[];
  dirty: boolean;
  progs: Partial<Record<Shader, Program>>; geo: Geometry; bufs: WebGLBuffer[]; nground: number; groundY: number;
  vao: Record<string, WebGLVertexArrayObject>; light: WebGLTexture; rows: number; staging: Float32Array;
  spill: ReturnType<typeof cluster> & { k: number; acc: Float32Array; lp: Float32Array; lc: Float32Array };
  size: string; scene: Target; levels: Target[];      // made at the first draw
}
export type Playa = ReturnType<typeof createPlaya>;

/** Throws when this browser cannot render to float textures: the Viewer stays on Points. */
export function createPlaya(v: Viewer) {
  const gl = v.gl;
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
    throw new Error('no float render targets');
  }
  const pl = { gl, v, phone: isPhone(), tier: coarse(), quality: 'auto', samples: [], bufs: [], levels: [],
    progs: {} } as unknown as State;    // setRig sets up the rest
  setRig(pl);
  return {
    get tier() { return TIERS[pl.tier].name; },
    draw: () => draw(pl),
    setRig: () => setRig(pl),
    light: () => { pl.dirty = true; },
    /** 'auto' | 'full' | 'lite' | 'low'. */
    setQuality(q: string) {
      pl.quality = q;
      pl.tier = q === 'auto' ? coarse() : Math.max(0, TIERS.findIndex((t) => t.name === q));
      tier(pl);
    },
    /** A drawn frame took `ms`, asked to drawn: under 'auto', a lower tier while frames are slow. */
    sample(ms: number) {
      if (pl.quality === 'auto' && pl.tier < TIERS.length - 1 && tooSlow(pl.samples, ms)) {
        pl.tier++;
        tier(pl);
      }
    },
  };
}

/** Auto's rule, on each drawn frame's ms: every 24 frames, whether their median took over 30 ms. */
export function tooSlow(samples: number[], ms: number) {
  if (ms > 250 || samples.push(ms) < 24) return false;     // a frame after a pause or a hidden tab says nothing
  samples.sort((a, b) => a - b);
  const slow = samples[12] > SLOW_MS;
  samples.length = 0;
  return slow;
}

function texture(gl: WebGL2RenderingContext, w: number, h: number, format: number, filter: number) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
  for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, filter);
  for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
  return t;
}

/** A float render target, with depth if asked: { tex, fb, w, h, depth }. */
function target(gl: WebGL2RenderingContext, w: number, h: number, withDepth = false): Target {
  const tex = texture(gl, w, h, gl.RGBA16F, gl.LINEAR), fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let depth = null;
  if (withDepth) {
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth = gl.createRenderbuffer());
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  }
  return { tex, fb, w, h, depth };
}

// The rig's geometry into buffers (no render hints: every pixel a point), and a light texture for its pixels.
function setRig(pl: State) {
  const { gl, v } = pl, b = v.bounds!, rig = v.rig!, n = v.count;
  const gy = (rig.structure?.ground as { y?: number } | undefined)?.y ?? b.min[1];
  for (const x of pl.bufs) gl.deleteBuffer(x);
  for (const x of Object.values(pl.vao || {})) gl.deleteVertexArray(x);
  gl.deleteTexture(pl.light);
  const shape = rig.fixtures?.length ? rig : { fixtures: [{ kind: 'points' as const, start: 0, count: n }] };
  const g = pl.geo = buildGeometry(shape, v.positions!, n, v.toView, gy);
  const buffer = (target: number, data: Float32Array | Uint32Array) => {
    gl.bindBuffer(target, pl.bufs[pl.bufs.push(gl.createBuffer()) - 1]);
    gl.bufferData(target, data, gl.STATIC_DRAW);
  };
  const vao = (data: Float32Array, layout: number[], index?: Uint32Array) => {
    const a = gl.createVertexArray(), stride = 4 * layout.reduce((t, k) => t + k, 0);
    gl.bindVertexArray(a);
    buffer(gl.ARRAY_BUFFER, data);
    layout.reduce((off, k, i) => {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, k, gl.FLOAT, false, stride, off);
      return off + 4 * k;
    }, 0);
    if (index) buffer(gl.ELEMENT_ARRAY_BUFFER, index);
    return a;
  };
  // A ribbon is a quad of 4 vertices (plain triangles: instancing costs a software renderer dearly).
  const quads = new Uint32Array(6 * g.nstrip).map((_, i) => 4 * Math.floor(i / 6) + [0, 1, 2, 1, 3, 2][i % 6]);
  const ground = playa((b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2);   // its edge lost in the haze
  pl.vao = { strip: vao(g.strip, [4, 4, 4, 4], quads), point: vao(g.point, [4, 1]), cell: vao(g.cell, [4, 4]),
    beam: vao(g.beam, [4, 4]), shell: vao(g.shell, [4, 4]), line: vao(g.line, [3]),
    ground: vao(ground.pos, [2], ground.index) };
  pl.nground = ground.index.length;
  gl.bindVertexArray(null);
  pl.rows = Math.ceil(n / ROW) || 1;
  pl.light = texture(gl, ROW, pl.rows, gl.RGBA16F, gl.NEAREST);
  pl.staging = new Float32Array(ROW * pl.rows * 4);
  pl.groundY = gy;
  tier(pl, true);
}

function tier(pl: State, fresh = false) {
  const t = TIERS[pl.tier], { v } = pl;
  if (fresh || pl.spill.k !== t.spill) {
    pl.spill = { k: t.spill, ...cluster(pl.geo.spill, v.count, t.spill), acc: new Float32Array(7 * t.spill),
      lp: new Float32Array(64), lc: new Float32Array(48) };
  }
  Object.assign(pl, { size: '', dirty: true, samples: [] });    // targets are remade at the next draw
  v.setPixelRatio(t.dpr);
  v.onRender?.(v.mode, t.name);
  v.invalidate();
}

// Colours are sRGB (as the swatches show them); light adds linearly, so each is decoded before it lights anything.
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// Light (linear) × the flash guard's gain into the texture, and the spill lights summed from it: each sits where its
// pixels' light is, or at their middle while they are dark.
function upload(pl: State) {
  const { gl, v, staging: L, spill: { acc, of, centre, lp, lc, n: lights } } = pl, gain = v.options.gain;
  const { weight: w, spill: pos } = pl.geo, rgb = v.colors!, hiMask = v.hiMask!;
  acc.fill(0);
  for (let i = 0; i < v.count; i++) {
    const c = 7 * of[i], hi = hiMask[i] ? 1 : 0;
    const share = w[i] * (v.hiActive && !hi ? v.hiDim : 1);  // as the shaders dim
    let e = 0;
    for (let a = 0; a < 3; a++) {
      const x = L[4 * i + a] = linear(rgb[3 * i + a]) * gain;
      acc[c + a] += x * share;
      e += x * share;
    }
    L[4 * i + 3] = hi;
    for (let a = 0; a < 3; a++) acc[c + 3 + a] += pos[3 * i + a] * e;
    acc[c + 6] += e;
  }
  gl.bindTexture(gl.TEXTURE_2D, pl.light);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROW, pl.rows, gl.RGBA, gl.FLOAT, L);
  for (let c = 0; c < lights; c++) {
    const e = acc[7 * c + 6];
    for (let a = 0; a < 4; a++) lp[4 * c + a] = e > 1e-4 && a < 3 ? acc[7 * c + 3 + a] / e : centre[4 * c + a];
    for (let a = 0; a < 3; a++) lc[3 * c + a] = acc[7 * c + a] * SPILL;
  }
  pl.dirty = false;
}

function use(pl: State, name: Shader, extra: Uniforms = {}) {
  const { gl, v } = pl, s = pl.spill;
  const { p, u } = pl.progs[name] ||= program(gl, ...GLSL[name] as [string, string]);    // on first use
  gl.useProgram(p);
  const set: Uniforms = { uVP: v.viewProj, uE: v._eyeV, uHi: v.hiActive ? 1 : 0, uD: v.hiDim, uW: v.hiTint,
    uG: 0.006 + v.options.ghost * 0.12, 'uLP[0]': s.lp, 'uLC[0]': s.lc, ...extra };
  for (const [k, x] of Object.entries(set)) {
    if (!u[k]) continue;
    if (typeof x === 'number') gl.uniform1f(u[k], x);
    else if (x.length === 16) gl.uniformMatrix4fv(u[k], false, x);
    else gl[`uniform${x.length === 2 ? 2 : x.length % 3 ? 4 : 3}fv`](u[k], x);    // vec2, vec3[], vec4[]
  }
  for (const [k, x] of [['uL', 0], ['uT', 0], ['uS', 0], ['uB', 1], ['uN', s.n]] as const) {
    if (u[k]) gl.uniform1i(u[k], x);
  }
}

function screen(pl: State, name: Shader, to: Target | null, from: Target, extra: Uniforms) {
  const { gl, v } = pl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.fb : null);
  gl.viewport(0, 0, to ? to.w : v.canvas.width, to ? to.h : v.canvas.height);
  use(pl, name, extra);
  gl.bindTexture(gl.TEXTURE_2D, from.tex);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function draw(pl: State) {
  const { gl, v, geo: g, vao } = pl, W = v.canvas.width, H = v.canvas.height, t = TIERS[pl.tier];
  const { vfov, Hf } = camera(v), px = Hf / (2 * Math.tan(vfov / 2)), strip = t.lite ? 'stripLite' : 'strip';
  if (pl.size !== `${W}x${H}`) {
    for (const x of [pl.scene, ...pl.levels]) if (x) { gl.deleteTexture(x.tex); gl.deleteFramebuffer(x.fb); }
    if (pl.scene) gl.deleteRenderbuffer(pl.scene.depth);
    pl.size = `${W}x${H}`;
    pl.scene = target(gl, W, H, true);
    pl.levels = [];
    for (let w = W / t.bloom, h = H / t.bloom; pl.levels.length < t.levels && h >= 2; w /= 2, h /= 2) {
      pl.levels.push(target(gl, Math.ceil(w), Math.ceil(h)));
    }
  }
  if (pl.dirty) upload(pl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, pl.scene.fb);
  gl.viewport(0, 0, W, H);
  gl.depthMask(true);
  gl.colorMask(true, true, true, true);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pl.light);
  const pass = (name: Shader, kind: string, mode: number, n: number, extra: Uniforms) => {
    if (!n) return;
    use(pl, name, extra);
    gl.bindVertexArray(vao[kind]);
    if (vao[kind] === vao.strip || vao[kind] === vao.ground) gl.drawElements(mode, n, gl.UNSIGNED_INT, 0);
    else gl.drawArrays(mode, 0, n);
  };
  // The solid things first (alpha 1: the sky shows where it stays 0), hiding what is behind them: the playa, tubes
  // and glass. Then light adds up over them: scaffold, floods, globes.
  pass('ground', 'ground', gl.TRIANGLES, pl.nground, { uK: K.ground, uY: pl.groundY });
  if (v.venueOn && v.venue) v.venue.draw(v.viewProj, v._eyeV, K.venue, HAZE, true);
  pass(strip, 'strip', gl.TRIANGLES, 6 * g.nstrip, { uK: K.strip, uPx: 1 / px });
  pass('cell', 'cell', gl.TRIANGLES, g.ncell, { uK: K.cell });
  gl.depthMask(false);
  gl.colorMask(true, true, true, false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  pass('line', 'line', gl.LINES, t.lite && pl.phone ? 0 : g.nline, { uK: K.line });   // phones: no scaffold
  pass('flood', 'beam', gl.TRIANGLES, g.nbeam, { uK: K.beam, uSo: 0 });
  pass('flood', 'shell', gl.TRIANGLES, g.nshell, { uK: K.shell, uSo: 1 });
  pass('point', 'point', gl.POINTS, g.npoint, { uK: K.point, uPs: px });
  gl.bindVertexArray(null);
  gl.colorMask(true, true, true, true);
  gl.disable(gl.DEPTH_TEST);
  // Bloom: down the chain keeping what is over the threshold, then up, each level adding the one below it.
  const L = pl.levels;
  gl.disable(gl.BLEND);
  L.forEach((l, i) => screen(pl, 'down', l, L[i - 1] || pl.scene, { uK: i ? 0 : THRESHOLD,
    uH: [1 / (L[i - 1] || pl.scene).w, 1 / (L[i - 1] || pl.scene).h] }));
  gl.enable(gl.BLEND);
  for (let i = L.length - 2; i >= 0; i--) screen(pl, 'up', L[i], L[i + 1], { uH: [0.5 / L[i].w, 0.5 / L[i].h] });
  gl.disable(gl.BLEND);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, (L[0] || pl.scene).tex);   // no bloom: uK is 0
  gl.activeTexture(gl.TEXTURE0);
  screen(pl, 'out', null, pl.scene, { uK: L.length ? K.bloom : 0, uV: v._view, uP: v._proj });
}
