// The stdlib pattern code sees as globals (SPEC "Stdlib"), helpers the core shares, the look's palette (SPEC
// "Globals") and RUN, what the frame being rendered shares with pattern code. No imports but types.
import type { G } from './globals.ts';

/** A colour: [r, g, b] each 0..1; what patterns may give one as: an array, '#rrggbb' or a grey level. */
export type RGB = [number, number, number];
export type Colour = readonly number[] | string | number;

const PI = Math.PI;
export const TAU = Math.PI * 2;
export function clamp(v: number, lo = 0, hi = 1) { return v < lo ? lo : v > hi ? hi : v; }
function fract(x: number) { return x - Math.floor(x); }
function step(edge: number, x: number) { return x < edge ? 0 : 1; }

function smoothstep(e0: number, e1: number, x: number) {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function wave(x: number) { return 0.5 + 0.5 * Math.sin(TAU * x); }
function tri(x: number) { return 1 - Math.abs(2 * (x - Math.floor(x)) - 1); }
const saw = fract;

/** pulse(x, width): 1 at every whole number, easing to 0 at ±width (so it wraps). */
function pulse(x: number, width = 0.1) {
  if (!(width > 0)) return 0;
  const d = Math.abs(x - Math.round(x));
  if (d >= width) return 0;
  const k = 1 - d / width;
  return k * k * (3 - 2 * k);
}

// Hashing: stable 32-bit integer mixing (the murmur3 finaliser), the same on every platform.
function fmix(h: number) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
function bits(n: number) {
  n = +n;
  if (n === (n | 0)) return fmix(Math.imul(n | 0, 0x9e3779b1) ^ 0x7f4a7c15);
  F64[0] = n;
  return fmix(U32[0] ^ fmix(U32[1] ^ 0x632be5ab));
}
function combine(h: number, n: number) { return fmix(h ^ (bits(n) + 0x9e3779b9 + (h << 6) + (h >>> 2))); }
export function hash(n: number) { return bits(n) / 4294967296; }

function rand(a: number, b?: number, c?: number) {
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
function grad(h: number, x: number, y: number, z: number) { // one of Perlin's 12 edge gradients, dotted with (x, y, z)
  h &= 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function perlin3(x: number, y: number, z: number) {                // about -1..1, 0 on the integer lattice
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
function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
// Missing axes sit off the lattice so 1D/2D noise never pins to 0.5 at whole numbers.
const NOISE_Y = 0.3713, NOISE_Z = 0.6289;
// perlin3 is roughly ±1 but mostly within ±0.7; stretch so noise() uses the whole 0..1.
const NOISE_GAIN = 0.7;
function noise4(x: number, y: number, z: number, w?: number) {
  if (w === undefined) return perlin3(x, y, z);
  const w0 = Math.floor(w), s = fade(w - w0);
  // Two decorrelated 3D slices, blended smoothly along w.
  const a = perlin3(x + w0 * 31.416, y - w0 * 27.183, z + w0 * 14.142);
  const b = perlin3(x + (w0 + 1) * 31.416, y - (w0 + 1) * 27.183, z + (w0 + 1) * 14.142);
  return lerp(a, b, s);
}

function noise(x: number, y = NOISE_Y, z = NOISE_Z, w?: number) {
  return clamp(0.5 + NOISE_GAIN * noise4(+x, +y, +z, w));
}

/** fbm: octaves of noise at doubling frequency. */
function fbm(x: number, y = NOISE_Y, z = NOISE_Z, octaves = 4) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  const n = Math.max(1, Math.min(8, octaves | 0));
  for (let o = 0; o < n; o++) {
    sum += amp * perlin3(x * f + o * 17.17, y * f - o * 9.31, z * f + o * 5.73);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return clamp(0.5 + NOISE_GAIN * 1.45 * sum / norm);
}

const HEX_CACHE = new Map<string, RGB>();
export function hex(s: string): RGB {
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
function col(c: Colour): readonly number[] {
  if (typeof c === 'string') return hex(c);
  if (typeof c === 'number') return [c, c, c];
  return c;
}

function rgb(r: number, g?: number, b?: number): RGB { return g === undefined ? [r, r, r] : [r, g, b!]; }

function hsv(h: number, s = 1, v = 1): RGB {
  h = (h - Math.floor(h)) * 6;
  const i = Math.floor(h), f = h - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  switch (i % 6) {
    case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t];
    case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q];
  }
}

function hsl(h: number, s = 1, l = 0.5) {
  const v = l + s * Math.min(l, 1 - l);
  return hsv(h, v === 0 ? 0 : 2 * (1 - l / v), v);
}

function mix(a: Colour, b: Colour, t: number): number | RGB {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  a = col(a); b = col(b);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function scale(c: Colour, k: number): RGB { c = col(c); return [c[0] * k, c[1] * k, c[2] * k]; }
function add(a: Colour, b: Colour): RGB { a = col(a); b = col(b); return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

function gradient(t: number, stops: readonly Colour[]) {
  const n = stops ? stops.length : 0;
  if (n === 0) return [0, 0, 0];
  if (n === 1) return col(stops[0]).slice(0, 3);
  const f = clamp(t) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  return mix(stops[i], stops[i + 1], f - i);
}

/** Inigo Quilez's a + b·cos(2π(c·t + d)), per channel. */
type Channels = number | readonly number[];
function cosPalette(t: number, a: Channels, b: Channels, c: Channels, d: Channels): RGB {
  const out: RGB = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const ai = typeof a === 'number' ? a : a[i], bi = typeof b === 'number' ? b : b[i];
    const ci = typeof c === 'number' ? c : c[i], di = typeof d === 'number' ? d : d[i];
    out[i] = ai + bi * Math.cos(TAU * (ci * t + di));
  }
  return out;
}

function beat(t: number, bpm = 120) { const x = t * bpm / 60; return x - Math.floor(x); }

/** dist(x1, y1, z1, x2, y2, z2), or in 2D dist(x1, y1, x2, y2). */
function dist(x1: number, y1: number, z1: number, x2: number, y2?: number, z2?: number) {
  if (y2 === undefined) { const dx = z1 - x1, dy = x2 - y1; return Math.sqrt(dx * dx + dy * dy); }
  const dx = x2 - x1, dy = y2 - y1, dz = z2! - z1;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export const PALETTE_ROLES = Object.freeze(['low', 'body', 'accent', 'high'] as const);
export type PaletteRole = (typeof PALETTE_ROLES)[number];
/** A palette as a look holds it: '#rrggbb' lists by role. */
export type PaletteHex = { name?: string } & Partial<Record<PaletteRole, readonly string[]>>;
/** G.palette: frozen [r, g, b] lists by role, and `all` of them low to high. */
export type PaletteColours = { readonly name: string } & Readonly<Record<PaletteRole | 'all', Centres>>;
/** `chapel` from data/palettes.json: what a look without a palette plays in. */
export const DEFAULT_PALETTE: PaletteHex = Object.freeze({ name: 'chapel', low: ['#a30066', '#d40063'],
  body: ['#ff333c', '#fd7f40', '#fcae5c', '#fbd182'], accent: ['#2a39ff', '#2380ff', '#50b3ff'], high: ['#f9e5c4'] });
const MAX_PER_ROLE = 16;
const HEX6 = /^#[0-9a-f]{6}$/i;

function rgbOf(s: string) {
  const v = parseInt(s.slice(1), 16);
  return Object.freeze([((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]);
}

/** A palette ({ name?, low: ['#hex'], … }) as G.palette: frozen [r, g, b] lists by role, and `all` low to high. */
export function paletteColours(palette?: PaletteHex | null): PaletteColours | null {
  const src = palette && typeof palette === 'object' ? palette : DEFAULT_PALETTE;
  const out: Record<string, unknown> = { name: typeof src.name === 'string' ? src.name.slice(0, 64) : '' };
  const all: (readonly number[])[] = [];
  for (const role of PALETTE_ROLES) {
    const list = Array.isArray(src[role]) ? src[role].filter((c) => typeof c === 'string' && HEX6.test(c)) : [];
    all.push(...(out[role] = Object.freeze(list.slice(0, MAX_PER_ROLE).map(rgbOf))));
  }
  if (!all.length) return src === DEFAULT_PALETTE ? null : paletteColours(DEFAULT_PALETTE);
  out.all = Object.freeze(all);
  return Object.freeze(out) as PaletteColours;
}

/** Set by renderFrame for pal(), palette(), centres() and use(). */
export const RUN: { G: G | null, palette: PaletteColours, scene: { centresOf(tag: string): Centres } | null } = {
  G: null, palette: paletteColours(DEFAULT_PALETTE)!, scene: null };

function ramp(list: Centres, t: number): RGB {
  const n = list.length;
  if (n === 1 || !(t > 0)) return [list[0][0], list[0][1], list[0][2]];
  const f = (t < 1 ? t : 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f)), k = f - i, a = list[i], b = list[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** pal(role, t): t 0..1 across a role's colours (unknown or empty: body). */
export function pal(role: string, t = 0) {
  const p = RUN.palette;
  let list = p[role as PaletteRole];
  if (!list || !list.length) list = p.body.length ? p.body : p.all;
  return ramp(list, t);
}

export function palette(t: number) { return ramp(RUN.palette.all, t); }

/** centres(tag): [X, Y, Z] of each of the rig's groups tagged `tag` (frozen; [] before the first frame). */
export type Centres = readonly (readonly number[])[];
const NONE: Centres = Object.freeze([]);
function centres(tag: string) { return RUN.scene ? RUN.scene.centresOf(String(tag)) : NONE; }

/** Everything pattern code sees as globals. */
export const STDLIB = Object.freeze({
  PI, TAU, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  atan2: Math.atan2, abs: Math.abs, min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, sqrt: Math.sqrt, pow: Math.pow, exp: Math.exp, log: Math.log, hypot: Math.hypot, sign: Math.sign,
  clamp, fract, mix, step, smoothstep, wave, tri, saw, pulse, hash, rand, noise, fbm,
  hsv, hsl, rgb, hex, scale, add, gradient, cosPalette, pal, palette, centres, beat, dist,
});
export const STDLIB_NAMES = Object.freeze(Object.keys(STDLIB));
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
