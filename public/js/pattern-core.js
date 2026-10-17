// pattern-core.js: Folly Studio's pattern runtime.
//
// Pure ES module: no DOM, no imports, no globals touched. It runs in two places:
//   - inlined into sandbox.html (the server swaps /*@CORE@*/ for this file), the only place
//     untrusted pattern code ever runs in the app;
//   - in the Node tests, on our own library patterns.
//
// Pieces (see studio/SPEC.md):
//   STDLIB                        what pattern code sees as globals
//   compilePattern(code)          -> { pixel, frame, params }
//   prepareScene(cathedral)       cathedral.json -> typed arrays
//   prepareLayer(scene, layer, compiled)
//   renderFrame(scene, prepared, t, out?) -> { rgb, errors }
//   toChannels(scene, rgb, out?, { gamma, brightness }) -> Uint8Array(40800)
//   layerEnvelope(clips, t), normalizeClips(clips), lookDuration(look)   the timeline

// ---------------------------------------------------------------------------------------------
// Stdlib
// ---------------------------------------------------------------------------------------------

const PI = Math.PI;
const TAU = Math.PI * 2;

/** clamp(v, lo = 0, hi = 1): v held inside [lo, hi]. */
function clamp(v, lo = 0, hi = 1) { return v < lo ? lo : v > hi ? hi : v; }

/** fract(x): the fractional part, always 0..1 (fract(-0.25) = 0.75). */
function fract(x) { return x - Math.floor(x); }

/** step(edge, x): 0 below edge, 1 from edge on. */
function step(edge, x) { return x < edge ? 0 : 1; }

/** smoothstep(e0, e1, x): 0 at e0 easing to 1 at e1 (Hermite), clamped. */
function smoothstep(e0, e1, x) {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** wave(x): ½ + ½·sin(2πx), a smooth 0..1 wave with period 1 (0.5 at x = 0). */
function wave(x) { return 0.5 + 0.5 * Math.sin(TAU * x); }

/** tri(x): triangle wave, 0 at whole numbers, 1 halfway between. */
function tri(x) { return 1 - Math.abs(2 * (x - Math.floor(x)) - 1); }

/** saw(x): sawtooth ramp 0 -> 1 each period (= fract). */
function saw(x) { return x - Math.floor(x); }

/** pulse(x, width = 0.1): 1 at every whole number, easing to 0 at ±width (so it wraps). */
function pulse(x, width = 0.1) {
  if (!(width > 0)) return 0;
  const d = Math.abs(x - Math.round(x));
  if (d >= width) return 0;
  const k = 1 - d / width;
  return k * k * (3 - 2 * k);
}

// --- hashing: stable, platform-independent 32-bit integer mixing (murmur3 finaliser) --------

function fmix(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
function bits(n) {
  n = +n;
  if (n === (n | 0)) return fmix(Math.imul(n | 0, 0x9e3779b1) ^ 0x7f4a7c15);
  F64[0] = n;
  return fmix(U32[0] ^ fmix(U32[1] ^ 0x632be5ab));
}
function combine(h, n) { return fmix(h ^ (bits(n) + 0x9e3779b9 + (h << 6) + (h >>> 2))); }

/** hash(n): a stable pseudo-random 0..1 for any number (same n, same answer, everywhere). */
function hash(n) { return bits(n) / 4294967296; }

/** rand(a, b?, c?): a stable pseudo-random 0..1 from one to three numbers. */
function rand(a, b, c) {
  let h = bits(a);
  if (b !== undefined) h = combine(h, b);
  if (c !== undefined) h = combine(h, c);
  return h / 4294967296;
}

// --- gradient noise: Perlin's improved noise, with a fixed, seeded permutation table --------

const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 0x2545f491;                       // xorshift32 shuffle: the same table everywhere
  for (let i = 255; i > 0; i--) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    const j = (s >>> 0) % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
function grad(h, x, y, z) {               // one of Perlin's 12 edge gradients, dotted with (x, y, z)
  h &= 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
function lerp(a, b, t) { return a + (b - a) * t; }
function perlin3(x, y, z) {                // about -1..1, 0 on the integer lattice
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const X = fx & 255, Y = fy & 255, Z = fz & 255;
  x -= fx; y -= fy; z -= fz;
  const u = x * x * x * (x * (x * 6 - 15) + 10);
  const v = y * y * y * (y * (y * 6 - 15) + 10);
  const w = z * z * z * (z * (z * 6 - 15) + 10);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  const x1 = x - 1, y1 = y - 1, z1 = z - 1;
  return lerp(
    lerp(lerp(grad(PERM[AA], x, y, z), grad(PERM[BA], x1, y, z), u),
         lerp(grad(PERM[AB], x, y1, z), grad(PERM[BB], x1, y1, z), u), v),
    lerp(lerp(grad(PERM[AA + 1], x, y, z1), grad(PERM[BA + 1], x1, y, z1), u),
         lerp(grad(PERM[AB + 1], x, y1, z1), grad(PERM[BB + 1], x1, y1, z1), u), v),
    w);
}
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
// Missing axes sit off the lattice so 1D/2D noise never pins to 0.5 at whole numbers.
const NOISE_Y = 0.3713, NOISE_Z = 0.6289;
// perlin3 is roughly ±1 but mostly within ±0.7; stretch so noise() uses the whole 0..1.
const NOISE_GAIN = 0.7;
function noise4(x, y, z, w) {
  if (w === undefined) return perlin3(x, y, z);
  const w0 = Math.floor(w), s = fade(w - w0);
  // Two decorrelated 3D slices, blended smoothly along w.
  const a = perlin3(x + w0 * 31.416, y - w0 * 27.183, z + w0 * 14.142);
  const b = perlin3(x + (w0 + 1) * 31.416, y - (w0 + 1) * 27.183, z + (w0 + 1) * 14.142);
  return lerp(a, b, s);
}

/** noise(x, y?, z?, w?): smooth gradient noise, 0..1 (about 0.5 on average), period-free. */
function noise(x, y = NOISE_Y, z = NOISE_Z, w) {
  return clamp(0.5 + NOISE_GAIN * noise4(+x, +y, +z, w));
}

/** fbm(x, y, z, octaves = 4): fractal noise (octaves of noise at doubling frequency), 0..1. */
function fbm(x, y = NOISE_Y, z = NOISE_Z, octaves = 4) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  const n = Math.max(1, Math.min(8, octaves | 0));
  for (let o = 0; o < n; o++) {
    sum += amp * perlin3(x * f + o * 17.17, y * f - o * 9.31, z * f + o * 5.73);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return clamp(0.5 + NOISE_GAIN * 1.45 * sum / norm);
}

// --- colour ------------------------------------------------------------------------------

const HEX_CACHE = new Map();
/** hex('#rrggbb' or '#rgb'): a colour [r, g, b] 0..1. */
function hex(s) {
  let c = HEX_CACHE.get(s);
  if (!c) {
    let h = String(s).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`hex(): not a colour: ${JSON.stringify(s)}`);
    const v = parseInt(h, 16);
    c = [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
    if (HEX_CACHE.size < 1024) HEX_CACHE.set(s, c);
  }
  return [c[0], c[1], c[2]];
}
function col(c) {
  if (typeof c === 'string') return hex(c);
  if (typeof c === 'number') return [c, c, c];
  return c;
}

/** rgb(r, g, b): a colour from three 0..1 numbers (rgb(v) is grey v). */
function rgb(r, g, b) { return g === undefined ? [r, r, r] : [r, g, b]; }

/** hsv(h, s = 1, v = 1): hue 0..1 (wraps; 0 red, 1/3 green, 2/3 blue), saturation, value. */
function hsv(h, s = 1, v = 1) {
  h = (h - Math.floor(h)) * 6;
  const i = Math.floor(h), f = h - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  switch (i % 6) {
    case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t];
    case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q];
  }
}

/** hsl(h, s = 1, l = 0.5): hue 0..1 (wraps), saturation, lightness (0.5 = full colour). */
function hsl(h, s = 1, l = 0.5) {
  const v = l + s * Math.min(l, 1 - l);
  return hsv(h, v === 0 ? 0 : 2 * (1 - l / v), v);
}

/** mix(a, b, t): a -> b by t; numbers or colours (arrays or '#hex'). */
function mix(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  a = col(a); b = col(b);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** scale(c, k): colour c times k (k = 0.5 is half as bright). */
function scale(c, k) { c = col(c); return [c[0] * k, c[1] * k, c[2] * k]; }

/** add(c1, c2): two colours summed, as light sums. */
function add(c1, c2) { c1 = col(c1); c2 = col(c2); return [c1[0] + c2[0], c1[1] + c2[1], c1[2] + c2[2]]; }

/** gradient(t, [c0, c1, ...]): t 0..1 across evenly spaced colour stops (arrays or '#hex'). */
function gradient(t, stops) {
  const n = stops ? stops.length : 0;
  if (n === 0) return [0, 0, 0];
  if (n === 1) return col(stops[0]).slice(0, 3);
  const f = clamp(t) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  return mix(stops[i], stops[i + 1], f - i);
}

/** cosPalette(t, a, b, c, d): Inigo Quilez's a + b·cos(2π(c·t + d)), per channel (arrays or numbers). */
function cosPalette(t, a, b, c, d) {
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const ai = typeof a === 'number' ? a : a[i], bi = typeof b === 'number' ? b : b[i];
    const ci = typeof c === 'number' ? c : c[i], di = typeof d === 'number' ? d : d[i];
    out[i] = ai + bi * Math.cos(TAU * (ci * t + di));
  }
  return out;
}

// --- time and space ----------------------------------------------------------------------

/** beat(t, bpm = 120): phase 0..1 through the current beat (0 on the beat). */
function beat(t, bpm = 120) { const x = t * bpm / 60; return x - Math.floor(x); }

/** dist(x1, y1, z1, x2, y2, z2): straight-line distance (dist(x1, y1, x2, y2) in 2D). */
function dist(x1, y1, z1, x2, y2, z2) {
  if (y2 === undefined) { const dx = z1 - x1, dy = x2 - y1; return Math.sqrt(dx * dx + dy * dy); }
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Everything pattern code sees as globals. */
export const STDLIB = Object.freeze({
  // Constants and Math (the usual meanings).
  PI, TAU,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
  atan: Math.atan, atan2: Math.atan2, abs: Math.abs, min: Math.min, max: Math.max,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt, pow: Math.pow,
  exp: Math.exp, log: Math.log, hypot: Math.hypot, sign: Math.sign,
  // Shaping.
  clamp, fract, mix, step, smoothstep, wave, tri, saw, pulse,
  // Randomness and noise.
  hash, rand, noise, fbm,
  // Colour.
  hsv, hsl, rgb, hex, scale, add, gradient, cosPalette,
  // Time and space.
  beat, dist,
});
export const STDLIB_NAMES = Object.freeze(Object.keys(STDLIB));

// ---------------------------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------------------------

// Browser/worker globals hidden from pattern code as undefined locals. Defence in depth only:
// the sandboxed, network-less iframe is the real boundary.
const SHADOWED = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'self', 'window',
  'globalThis', 'document', 'parent', 'top', 'opener', 'frames', 'postMessage', 'location',
  'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'Worker', 'SharedWorker',
  'BroadcastChannel', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask',
];
const PRELUDE =
  '"use strict";\n' +
  `const { ${STDLIB_NAMES.join(', ')} } = __stdlib;\n` +
  `const ${SHADOWED.map((n) => `${n} = undefined`).join(', ')};\n` +
  'return (function () {\n';
const EPILOGUE =
  '\n;return { pixel: typeof pixel === "function" ? pixel : undefined,' +
  ' frame: typeof frame === "function" ? frame : undefined,' +
  ' params: typeof params === "undefined" ? undefined : params };\n})();';

// Where pattern line 1 lands in the generated function, learnt once from a probe so runtime
// errors can say "line N" in V8 and Firefox alike.
let lineOffset;
const STACK_LINE = /(?:<anonymous>|> (?:Function|eval)):(\d+):\d+/;
function patternLine(err) {
  if (lineOffset === undefined) {
    lineOffset = null;
    try {
      new Function('__stdlib', PRELUDE + 'throw new Error("probe");' + EPILOGUE)(STDLIB);
    } catch (e) {
      const m = STACK_LINE.exec(String(e && e.stack));
      if (m) lineOffset = +m[1] - 1;
    }
  }
  const m = lineOffset === null ? null : STACK_LINE.exec(String(err && err.stack));
  const line = m ? +m[1] - lineOffset : 0;
  return line > 0 ? line : 0;
}

/** A pattern error as one line: "TypeError: … (line 12)". */
export function describeError(err) {
  if (err === undefined || err === null) return 'Error';
  if (typeof err !== 'object') return String(err);
  const name = err.name || 'Error';
  const msg = err.message ? `${name}: ${err.message}` : name;
  const line = patternLine(err);
  return line ? `${msg} (line ${line})` : msg;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function toHexString(c) {
  const h = (v) => Math.round(clamp(+v || 0) * 255).toString(16).padStart(2, '0');
  return '#' + h(c[0]) + h(c[1]) + h(c[2]);
}

/** A pattern's `params` as a JSON-safe schema: { name: { type, value, min?, max?, step?, label? } }. */
export function normalizeParams(raw) {
  const out = {};
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('params must be an object of { value, ... }');
  for (const key of Object.keys(raw)) {
    let d = raw[key];
    if (typeof d === 'number') d = { value: d };
    else if (typeof d === 'boolean') d = { value: d, type: 'toggle' };
    else if (typeof d === 'string') d = { value: d, type: 'color' };
    if (!d || typeof d !== 'object') throw new Error(`param "${key}" must be { value, ... }`);
    let type = String(d.type || '').toLowerCase();
    if (type === 'colour') type = 'color';
    if (type === 'bool' || type === 'boolean' || type === 'checkbox') type = 'toggle';
    if (!type || type === 'range' || type === 'slider') {
      type = typeof d.value === 'boolean' ? 'toggle'
        : typeof d.value === 'string' || Array.isArray(d.value) ? 'color' : 'number';
    }
    let p;
    if (type === 'color') {
      const c = Array.isArray(d.value) ? d.value : hex(d.value === undefined ? '#ffffff' : d.value);
      p = { type, value: toHexString(c) };
    } else if (type === 'toggle') {
      p = { type, value: !!d.value };
    } else if (type === 'number') {
      const value = d.value === undefined ? 0 : +d.value;
      if (!Number.isFinite(value)) throw new Error(`param "${key}": value must be a number`);
      p = { type, value, min: isNum(d.min) ? d.min : Math.min(0, value), max: isNum(d.max) ? d.max : Math.max(1, value) };
      if (isNum(d.step) && d.step > 0) p.step = d.step;
    } else {
      throw new Error(`param "${key}": unknown type "${d.type}" (number, toggle or color)`);
    }
    if (typeof d.label === 'string') p.label = d.label;
    out[key] = p;
  }
  return out;
}

/**
 * Compile pattern source (a plain script defining `pixel`, optionally `params` and `frame`).
 * The stdlib is in scope as locals. Throws Error with a readable message on a syntax error,
 * an exception in the top-level code, bad params, or no `pixel` function.
 */
export function compilePattern(code) {
  if (typeof code !== 'string' || !code.trim()) throw new Error('pattern is empty: define function pixel(p, t, P)');
  // Patterns are plain scripts, but forgive `export function pixel` and the like (same lines).
  code = code.replace(/^([ \t]*)export[ \t]+(?=(?:async[ \t]+)?function\b|const\b|let\b|var\b|class\b)/gm, '$1');
  // Parse the code on its own first: clean syntax messages, and the code cannot close our wrapper.
  try {
    new Function('"use strict";\n' + code);
  } catch (e) {
    throw new Error(`Syntax error: ${e && e.message ? e.message : e}`);
  }
  let factory;
  try {
    factory = new Function('__stdlib', PRELUDE + code + EPILOGUE);
  } catch (e) {
    throw new Error(`Syntax error: ${e && e.message ? e.message : e}`);
  }
  let made;
  try {
    made = factory(STDLIB);
  } catch (e) {
    throw new Error(`Error while loading the pattern: ${describeError(e)}`);
  }
  if (!made || typeof made.pixel !== 'function') throw new Error('pattern defines no function pixel(p, t, P)');
  return { pixel: made.pixel, frame: made.frame, params: normalizeParams(made.params) };
}

// ---------------------------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------------------------

/** cathedral.json -> a scene of typed arrays (CSV order), shared by every layer. */
export function prepareScene(cathedral) {
  if (!cathedral || !cathedral.pixels) throw new Error('prepareScene: not a cathedral.json');
  const N = cathedral.count | 0;
  const px = cathedral.pixels;
  for (const k of ['zone', 'strand', 'universe', 'channel', 'row']) {
    if (!px[k] || px[k].length !== N) throw new Error(`prepareScene: pixels.${k} must have ${N} entries`);
  }
  if (!px.pos || px.pos.length !== N * 3) throw new Error(`prepareScene: pixels.pos must have ${N * 3} entries`);
  const lo = cathedral.bounds.min, hi = cathedral.bounds.max;
  const span = [0, 1, 2].map((i) => (hi[i] - lo[i]) || 1);
  const cpu = cathedral.channelsPerUniverse || 510;
  const zones = cathedral.zones.slice();
  const zoneIndex = new Map(zones.map((z, i) => [z, i]));
  const petalOfZone = zones.map((z) => { const m = /^rose-petal-(\d+)$/.exec(z); return m ? +m[1] - 1 : -1; });
  const strands = cathedral.strands || [];

  const s = {
    count: N,
    channelsPerUniverse: cpu,
    universes: cathedral.universes,
    frameChannels: cathedral.universes * cpu,
    bounds: { min: lo.slice(), max: hi.slice() },
    zones, zoneIndex, strands,
    groups: cathedral.groups || [],
    groupById: new Map((cathedral.groups || []).map((g) => [g.id, g])),
    groupCache: new Map(),
    X: new Float64Array(N), Y: new Float64Array(N), Z: new Float64Array(N),
    x: new Float64Array(N), y: new Float64Array(N), z: new Float64Array(N),
    zone: Int32Array.from(px.zone), strand: Int32Array.from(px.strand), row: Int32Array.from(px.row),
    petal: new Int32Array(N),
    u: new Float64Array(N), i: new Int32Array(N), n: new Int32Array(N),
    seed: new Float64Array(N),
    addr: new Int32Array(N),
  };
  for (let k = 0; k < N; k++) {
    const X = px.pos[3 * k], Y = px.pos[3 * k + 1], Z = px.pos[3 * k + 2];
    s.X[k] = X; s.Y[k] = Y; s.Z[k] = Z;
    s.x[k] = (X - lo[0]) / span[0]; s.y[k] = (Y - lo[1]) / span[1]; s.z[k] = (Z - lo[2]) / span[2];
    s.petal[k] = petalOfZone[s.zone[k]] ?? -1;
    s.seed[k] = hash(k * 7919 + 13);
    s.addr[k] = (px.universe[k] - 1) * cpu + (px.channel[k] - 1);
    s.n[k] = 1;
  }
  for (const st of strands) {
    const n = st.count | 0;
    for (let j = 0; j < n; j++) {
      const k = st.start + j;
      s.i[k] = j; s.n[k] = n; s.u[k] = n > 1 ? j / (n - 1) : 0;
    }
  }
  return s;
}

function groupMembers(scene, g, seen = new Set()) {
  let cached = scene.groupCache.get(g.id);
  if (cached) return cached;
  if (seen.has(g.id)) return new Int32Array(0);
  seen.add(g.id);
  const N = scene.count;
  const mask = new Uint8Array(N);
  const zoneSet = new Set((g.zones || []).map((z) => (typeof z === 'number' ? z : scene.zoneIndex.get(z))));
  const strandSet = new Set(g.strands || []);
  const rows = g.rows && g.rows.length ? new Set(g.rows) : null;
  if (zoneSet.size || strandSet.size) {
    for (let k = 0; k < N; k++) {
      if ((zoneSet.has(scene.zone[k]) || strandSet.has(scene.strand[k])) && (!rows || rows.has(scene.row[k]))) mask[k] = 1;
    }
  } else {
    // A group with no zones or strands of its own is the union of its children.
    for (const child of scene.groups) {
      if (child.parent === g.id) for (const k of groupMembers(scene, child, seen)) mask[k] = 1;
    }
  }
  cached = maskToIndex(mask);
  scene.groupCache.set(g.id, cached);
  return cached;
}

function maskToIndex(mask) {
  let m = 0;
  for (let k = 0; k < mask.length; k++) m += mask[k];
  const out = new Int32Array(m);
  for (let k = 0, j = 0; k < mask.length; k++) if (mask[k]) out[j++] = k;
  return out;
}

/** Pixel indices (ascending, unique) in the union of the groups `ids`. Unknown ids throw. */
export function pixelsForGroups(scene, ids) {
  const list = ids === undefined || ids === null ? ['cathedral'] : Array.isArray(ids) ? ids : [ids];
  if (list.length === 1) {
    const g = scene.groupById.get(list[0]);
    if (!g) throw new Error(`unknown group "${list[0]}"`);
    return groupMembers(scene, g).slice();
  }
  const mask = new Uint8Array(scene.count);
  for (const id of list) {
    const g = scene.groupById.get(id);
    if (!g) throw new Error(`unknown group "${id}"`);
    for (const k of groupMembers(scene, g)) mask[k] = 1;
  }
  return maskToIndex(mask);
}

// ---------------------------------------------------------------------------------------------
// Timeline: a look lasts `duration` seconds; a layer with clips is lit only inside them
// ---------------------------------------------------------------------------------------------

export const DEFAULT_DURATION = 30;
export const MIN_DURATION = 1;
export const MAX_DURATION = 600;
export const MAX_CLIPS = 32;

/** A look's length in seconds: `look.duration` held to 1..600, else 30. */
export function lookDuration(look) {
  const d = look && look.duration;
  return isNum(d) ? clamp(d, MIN_DURATION, MAX_DURATION) : DEFAULT_DURATION;
}

/**
 * Clips as the renderer uses them: [{ start, end, fadeIn, fadeOut }] with finite numbers,
 * end > start, fades ≥ 0, sorted by start, at most MAX_CLIPS, a clip that overlaps the one
 * before it dropped. null when there are none (the layer is always on).
 */
export function normalizeClips(clips) {
  if (!Array.isArray(clips) || !clips.length) return null;
  const list = [];
  for (const c of clips) {
    if (!c || typeof c !== 'object') continue;
    const start = +c.start, end = +c.end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) continue;
    const fadeIn = +c.fadeIn > 0 && Number.isFinite(+c.fadeIn) ? +c.fadeIn : 0;
    const fadeOut = +c.fadeOut > 0 && Number.isFinite(+c.fadeOut) ? +c.fadeOut : 0;
    list.push({ start, end, fadeIn, fadeOut });
  }
  list.sort((a, b) => a.start - b.start);
  const out = [];
  for (const c of list) {
    if (out.length >= MAX_CLIPS) break;
    if (out.length && c.start < out[out.length - 1].end) continue;
    out.push(c);
  }
  return out.length ? out : null;
}

/**
 * How much of a layer shows at time t (0..1): 1 with no clips; inside a clip [start, end)
 * it ramps linearly 0 → 1 over fadeIn and 1 → 0 over fadeOut (the two shrink in proportion
 * when they add up to more than the clip); 0 outside every clip. Allocation-free.
 */
export function layerEnvelope(clips, t) {
  if (!clips || !clips.length) return 1;
  let best = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const start = c.start, end = c.end;
    if (!(t >= start && t < end)) continue;
    let fi = c.fadeIn > 0 ? c.fadeIn : 0, fo = c.fadeOut > 0 ? c.fadeOut : 0;
    const len = end - start;
    if (fi + fo > len) { const k = len / (fi + fo); fi *= k; fo *= k; }
    let v = 1;
    if (fi > 0 && t < start + fi) v = (t - start) / fi;
    if (fo > 0 && t > end - fo) { const w = (end - t) / fo; if (w < v) v = w; }
    if (v > best) best = v;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------

export const BLENDS = Object.freeze(['add', 'over', 'max', 'multiply']);

/** Current values P from a schema and a layer's overrides (colours become [r, g, b]). */
export function resolveParams(schema, overrides) {
  const P = {};
  const o = overrides && typeof overrides === 'object' ? overrides : {};
  for (const key of Object.keys(schema || {})) {
    const d = schema[key];
    const has = Object.prototype.hasOwnProperty.call(o, key) && o[key] !== null && o[key] !== undefined;
    const v = has ? o[key] : d.value;
    if (d.type === 'color') {
      let c;
      if (Array.isArray(v) && v.length >= 3) c = [+v[0] || 0, +v[1] || 0, +v[2] || 0];
      else { try { c = hex(v); } catch { c = hex(d.value); } }
      P[key] = c;
    } else if (d.type === 'toggle') {
      P[key] = !!v;
    } else {
      const n = +v;
      P[key] = Number.isFinite(n) ? n : d.value;
    }
  }
  return P;
}

function makePixel() {
  return {
    x: 0, y: 0, z: 0, X: 0, Y: 0, Z: 0, lx: 0, ly: 0, lz: 0, a: 0, r: 0,
    u: 0, i: 0, n: 1, zone: '', zi: 0, strand: 0, row: 0, petal: -1, k: 0, seed: 0,
  };
}

/**
 * A layer ready to render: its pixels (from `groups`, default the whole cathedral), their
 * lx/ly/lz (0..1 across this layer's own bounds; 0.5 on a flat axis), a/r round the centre of
 * its pixels in the façade (z–y) plane, its param values and its clips (normalizeClips).
 */
export function prepareLayer(scene, layer, compiled) {
  if (!compiled || typeof compiled.pixel !== 'function') throw new Error('prepareLayer: layer is not compiled');
  const groups = layer && layer.groups && (Array.isArray(layer.groups) ? layer.groups.length : true) ? layer.groups : ['cathedral'];
  const idx = pixelsForGroups(scene, groups);
  const m = idx.length;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let j = 0; j < m; j++) {
    const k = idx[j];
    const X = scene.X[k], Y = scene.Y[k], Z = scene.Z[k];
    if (X < x0) x0 = X; if (X > x1) x1 = X;
    if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
  }
  const norm = (v, lo, hi) => (hi - lo > 1e-6 ? (v - lo) / (hi - lo) : 0.5);
  const cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const lx = new Float64Array(m), ly = new Float64Array(m), lz = new Float64Array(m);
  const a = new Float64Array(m), r = new Float64Array(m);
  let rmax = 0;
  for (let j = 0; j < m; j++) {
    const k = idx[j];
    lx[j] = norm(scene.X[k], x0, x1); ly[j] = norm(scene.Y[k], y0, y1); lz[j] = norm(scene.Z[k], z0, z1);
    // Seen from the playa (at -x, looking toward +x) up is +y and the viewer's right is +z, so
    // atan2(dz, dy) runs clockwise from 12 o'clock: 3 o'clock (+z) is a = 0.25.
    const dz = scene.Z[k] - cz, dy = scene.Y[k] - cy;
    const ang = Math.atan2(dz, dy) / TAU;
    a[j] = ang < 0 ? ang + 1 : ang;
    r[j] = Math.sqrt(dz * dz + dy * dy);
    if (r[j] > rmax) rmax = r[j];
  }
  if (rmax > 0) for (let j = 0; j < m; j++) r[j] /= rmax;
  const level = layer && isNum(layer.level) ? clamp(layer.level) : 1;
  const blend = layer && BLENDS.includes(layer.blend) ? layer.blend : 'add';
  return {
    id: layer && layer.id !== undefined ? layer.id : null,
    idx, lx, ly, lz, a, r,
    bounds: { min: [x0, y0, z0], max: [x1, y1, z1] },
    pixel: compiled.pixel, frame: compiled.frame || null,
    schema: compiled.params || {},
    P: resolveParams(compiled.params, layer && layer.params),
    blend, level,
    clips: normalizeClips(layer && layer.clips),
    enabled: !(layer && layer.enabled === false),
    p: makePixel(),
    buf: new Float64Array(m * 4),
  };
}

// Runs one layer into its own rgba buffer. Returns an error string, or null.
function runLayer(S, L, t) {
  const idx = L.idx, m = idx.length, buf = L.buf, p = L.p, P = L.P, fn = L.pixel;
  const zones = S.zones;
  let j = 0;
  try {
    if (L.frame) L.frame(t, P);
    for (; j < m; j++) {
      const k = idx[j];
      p.x = S.x[k]; p.y = S.y[k]; p.z = S.z[k];
      p.X = S.X[k]; p.Y = S.Y[k]; p.Z = S.Z[k];
      p.lx = L.lx[j]; p.ly = L.ly[j]; p.lz = L.lz[j];
      p.a = L.a[j]; p.r = L.r[j];
      p.u = S.u[k]; p.i = S.i[k]; p.n = S.n[k];
      const zi = S.zone[k];
      p.zi = zi; p.zone = zones[zi]; p.strand = S.strand[k];
      p.row = S.row[k]; p.petal = S.petal[k];
      p.k = k; p.seed = S.seed[k];
      let c = fn(p, t, P);
      let r, g, b, al;
      if (c === undefined || c === null) { r = g = b = al = 0; }
      else {
        if (typeof c === 'number') { r = g = b = c; al = 1; }
        else {
          if (typeof c === 'string') c = hex(c);
          r = +c[0]; g = +c[1]; b = +c[2];
          al = c.length > 3 && c[3] !== undefined ? +c[3] : 1;
        }
        if (r !== r || g !== g || b !== b || al !== al) {
          return `pixel() returned ${Array.isArray(c) ? `[${Array.from(c).slice(0, 4).join(', ')}]` : String(c)} (NaN) at LED ${k}`;
        }
      }
      const o = 4 * j;
      buf[o] = r < 0 ? 0 : r > 1 ? 1 : r;
      buf[o + 1] = g < 0 ? 0 : g > 1 ? 1 : g;
      buf[o + 2] = b < 0 ? 0 : b > 1 ? 1 : b;
      buf[o + 3] = al < 0 ? 0 : al > 1 ? 1 : al;
    }
  } catch (e) {
    return describeError(e);
  }
  return null;
}

/**
 * Render every prepared layer at time t (seconds), bottom (index 0) to top, into a
 * Float32Array(count × 3) of linear 0..1 RGB. A layer that throws or returns NaN adds nothing
 * this frame and is reported once in `errors` as { id, error }. A layer's clips scale its
 * level (layerEnvelope); outside them it does not run at all (no frame(), no pixel()). `t`
 * stays show time, so motion carries on across a cut.
 */
export function renderFrame(scene, layers, t, out) {
  const N = scene.count;
  const rgb = out && out.length >= N * 3 ? out : new Float32Array(N * 3);
  rgb.fill(0, 0, N * 3);
  const errors = [];
  const list = layers || [];
  for (let n = 0; n < list.length; n++) {
    const L = list[n];
    if (!L || !L.pixel || !L.enabled || !(L.level > 0)) continue;
    const level = L.clips ? L.level * layerEnvelope(L.clips, t) : L.level;
    if (!(level > 0)) continue;
    const err = runLayer(scene, L, t);
    if (err) { errors.push({ id: L.id, error: err }); continue; }
    const idx = L.idx, m = idx.length, buf = L.buf;
    switch (L.blend) {
      case 'over':
        for (let j = 0; j < m; j++) {
          const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level, ia = 1 - a;
          rgb[o] = rgb[o] * ia + buf[q] * a;
          rgb[o + 1] = rgb[o + 1] * ia + buf[q + 1] * a;
          rgb[o + 2] = rgb[o + 2] * ia + buf[q + 2] * a;
        }
        break;
      case 'max':
        for (let j = 0; j < m; j++) {
          const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level;
          const r = buf[q] * a, g = buf[q + 1] * a, b = buf[q + 2] * a;
          if (r > rgb[o]) rgb[o] = r;
          if (g > rgb[o + 1]) rgb[o + 1] = g;
          if (b > rgb[o + 2]) rgb[o + 2] = b;
        }
        break;
      case 'multiply':
        for (let j = 0; j < m; j++) {
          const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level, ia = 1 - a;
          rgb[o] *= ia + buf[q] * a;
          rgb[o + 1] *= ia + buf[q + 1] * a;
          rgb[o + 2] *= ia + buf[q + 2] * a;
        }
        break;
      default: // add
        for (let j = 0; j < m; j++) {
          const o = 3 * idx[j], q = 4 * j, a = buf[q + 3] * level;
          rgb[o] += buf[q] * a;
          rgb[o + 1] += buf[q + 1] * a;
          rgb[o + 2] += buf[q + 2] * a;
        }
    }
  }
  for (let i = 0; i < N * 3; i++) {
    const v = rgb[i];
    if (!(v > 0)) rgb[i] = 0; else if (v > 1) rgb[i] = 1;
  }
  return { rgb, errors };
}

// ---------------------------------------------------------------------------------------------
// DMX
// ---------------------------------------------------------------------------------------------

/**
 * A frame of DMX: Uint8Array(universes × channelsPerUniverse), each LED's R, G, B at
 * (universe − 1) × 510 + (channel − 1). Brightness scales, then gamma bends (v ** gamma),
 * then values round to 0..255. Channels no LED uses stay 0.
 */
export function toChannels(scene, rgb, out, opts) {
  if (out && !ArrayBuffer.isView(out) && opts === undefined) { opts = out; out = undefined; }
  const gamma = opts && isNum(opts.gamma) && opts.gamma > 0 ? opts.gamma : 1;
  const brightness = opts && isNum(opts.brightness) ? Math.max(0, opts.brightness) : 1;
  const size = scene.frameChannels;
  const ch = out && out.length >= size ? out : new Uint8Array(size);
  ch.fill(0, 0, size);
  const addr = scene.addr, N = scene.count;
  for (let k = 0; k < N; k++) {
    const base = addr[k];
    if (base < 0 || base + 2 >= size) continue;
    for (let c = 0; c < 3; c++) {
      let v = rgb[3 * k + c] * brightness;
      v = v > 0 ? (v < 1 ? v : 1) : 0;
      if (gamma !== 1) v = Math.pow(v, gamma);
      ch[base + c] = Math.round(v * 255);
    }
  }
  return ch;
}
