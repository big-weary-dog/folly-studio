// The stdlib: what pattern code sees as globals (SPEC "Stdlib"), plus helpers the core shares.

const PI = Math.PI;
export const TAU = Math.PI * 2;
/** clamp(v, lo = 0, hi = 1): v held inside [lo, hi]. */
export function clamp(v, lo = 0, hi = 1) { return v < lo ? lo : v > hi ? hi : v; }
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

// Hashing: stable, platform-independent 32-bit integer mixing (the murmur3 finaliser).
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
export function hash(n) { return bits(n) / 4294967296; }

/** rand(a, b?, c?): a stable pseudo-random 0..1 from one to three numbers. */
function rand(a, b, c) {
  let h = bits(a);
  if (b !== undefined) h = combine(h, b);
  if (c !== undefined) h = combine(h, c);
  return h / 4294967296;
}

// Gradient noise: Perlin's improved noise, with a fixed, seeded permutation table.
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

const HEX_CACHE = new Map();
/** hex('#rrggbb' or '#rgb'): a colour [r, g, b] 0..1. */
export function hex(s) {
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
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
