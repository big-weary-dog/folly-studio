// Light (SPEC "Light and output", docs/LIGHT.md): the one place that knows how a colour value becomes light. Colours
// are sRGB-encoded, as their swatches; the LEDs' PWM is linear light, and the Falcon's own gamma is None, so this is
// the one curve between them. The settings' shape and defaults, the output transform (curve, balance, trims, floor,
// a linear cap), each byte's light for the checks and the previews' light and screen encode all live here; nothing
// else reads `gamma`.
import type { Scene } from './scene.ts';
import { tagMask } from './scene.ts';
import { isNum } from './stdlib.ts';

/** The light settings' defaults: each used wherever the stored settings (<STUDIO_DATA>/light.json, the Pi's
 * pi/light.json) leave it out. `controller` records the Falcon's own settings (its port brightness is the electrical
 * backstop: ports 5-32 at 80 %, the rose's 33-48 at 70 %); it is never applied here, so nothing dims twice. */
export type Light = { gamma: number, balance: [number, number, number], floor: number,
  trims: { tag: string, level: number }[], controller: { ports: string, brightness: number, gamma: string }[],
  calibration: Calibration, preview: Preview };
/** How the real LEDs look, to draw them so: each colour's light at full (`white`, as a photo of a full white shows
 * it), the LEDs' response to their PWM (`response`: light^response; above 1 darker mid-tones) and how saturated their
 * colours are against the screen's (`saturation`, in light, about the luminance). Only the previews read it. */
export type Calibration = { white: [number, number, number], response: number, saturation: number };
/** The previews' display: where full drive sits on the screen, Playa's bloom, the light left outside a highlight
 * and outside a focus (a layer's groups being picked). */
export type Preview = { exposure: number, bloom: number, highlight: number, focus: number };
export const LIGHT: Readonly<Light> = Object.freeze<Light>({
  gamma: 2.2,
  balance: [1, 1, 1],
  floor: 0,
  trims: [],
  controller: [
    { ports: '5-32', brightness: 0.8, gamma: 'None' },
    { ports: '33-48 (rose)', brightness: 0.7, gamma: 'None' },
  ],
  calibration: { white: [1, 1, 1], response: 1, saturation: 1 },
  preview: { exposure: 0.85, bloom: 0.4, highlight: 0.22, focus: 0.05 },
});
/** Each setting's range, and how many trims and controller rows a record holds. */
export const LIGHT_LIMITS = Object.freeze({ gamma: [1, 3], floor: [0, 16], trims: 32, controller: 16, text: 40,
  exposure: [0.1, 2], white: [0, 2], response: [0.5, 2], saturation: [0, 2] });

const num = (v: unknown, lo: number, hi: number, d: number) => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : d);
const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, LIGHT_LIMITS.text) : '');

/** Light settings from untrusted JSON: each field bounded, its default where missing or not the right kind. */
export function lightOf(o?: unknown): Light {
  const s = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : null);
  const b = list(s.balance, 3) ?? [], [g0, g1] = LIGHT_LIMITS.gamma, [f0, f1] = LIGHT_LIMITS.floor;
  const trims = list(s.trims, LIGHT_LIMITS.trims)?.filter((t) => text(t?.tag))
    .map((t) => ({ tag: text(t.tag), level: num(t.level, 0, 1, 1) }));
  const controller = list(s.controller, LIGHT_LIMITS.controller)?.filter((c) => c && typeof c === 'object')
    .map((c) => ({ ports: text(c.ports), brightness: num(c.brightness, 0, 1, 1), gamma: text(c.gamma) }));
  const p = (s.preview && typeof s.preview === 'object' ? s.preview : {}) as Record<string, unknown>, P = LIGHT.preview;
  const [e0, e1] = LIGHT_LIMITS.exposure, share = (k: keyof Preview) => num(p[k], 0, 1, P[k]);
  const preview = { exposure: num(p.exposure, e0, e1, P.exposure), bloom: share('bloom'),
    highlight: share('highlight'), focus: share('focus') };
  const c = (s.calibration && typeof s.calibration === 'object' ? s.calibration : {}) as Record<string, unknown>;
  const C = LIGHT.calibration, w = list(c.white, 3) ?? [], L = LIGHT_LIMITS;
  const calibration = { white: C.white.map((d, i) => num(w[i], L.white[0], L.white[1], d)) as Calibration['white'],
    response: num(c.response, L.response[0], L.response[1], C.response),
    saturation: num(c.saturation, L.saturation[0], L.saturation[1], C.saturation) };
  return { gamma: num(s.gamma, g0, g1, LIGHT.gamma), calibration, preview,
    balance: LIGHT.balance.map((d, i) => num(b[i], 0, 1, d)) as Light['balance'],
    floor: Math.round(num(s.floor, f0, f1, LIGHT.floor)), trims: trims ?? [],
    controller: controller ?? LIGHT.controller.map((c) => ({ ...c })) };
}

/** The engine's light: what adds light (the add blend, blur) adds it as `v^2.2`, the swatches' own curve, never the
 * settings' gamma, which corrects only the output. Tabled with linear steps (within 1e-5 of the curve): the engine
 * adds per LED, per layer, each frame. Below 0 it mirrors, so a negative value still takes light away. */
const MIX_GAMMA = 2.2;
const STEPS = 1024, DEC = new Float64Array(STEPS + 2), ENC = new Float64Array(STEPS + 2);
for (let i = 0; i < STEPS + 2; i++) {
  const x = Math.min(1, i / STEPS);
  DEC[i] = x ** MIX_GAMMA; ENC[i] = x ** (2 / MIX_GAMMA);   // ENC by √light, where the curve is gentle
}
/** A colour value's light. */
export function toLight(v: number): number {
  if (!(v > 0)) return v < 0 ? -toLight(-v) : 0;
  if (v >= 1) return v ** MIX_GAMMA;
  const x = v * STEPS, i = x | 0;
  return DEC[i] + (DEC[i + 1] - DEC[i]) * (x - i);
}
/** Light's colour value. */
export function toValue(l: number): number {
  if (!(l > 0)) return l < 0 ? -toValue(-l) : 0;
  if (l >= 1 || l < 1 / STEPS ** 2) return l ** (1 / MIX_GAMMA);   // the first step bends too much to table
  const x = Math.sqrt(l) * STEPS, i = x | 0;
  return ENC[i] + (ENC[i + 1] - ENC[i]) * (x - i);
}
/** Two colour values' light, summed: a value. */
export const addLight = (a: number, b: number) => (a === 0 ? b : b === 0 ? a : toValue(toLight(a) + toLight(b)));

/** Light settings ready for a scene: each LED's trim (the product of its groups' levels; null when none). */
export function prepareLight(scene: Scene, light: Light = LIGHT) {
  let trim: Float32Array | null = null;
  for (const { tag, level } of light.trims) {
    trim ??= new Float32Array(scene.count).fill(1);
    const mask = tagMask(scene, tag);
    for (let k = 0; k < scene.count; k++) if (mask[k]) trim[k] *= level;
  }
  return { gamma: light.gamma, balance: light.balance, floor: light.floor, trim, cap: NaN, curves: [] as Curve[] };
}
export type PreparedLight = ReturnType<typeof prepareLight>;

/** One channel's output byte: its light (v^gamma × `gain`) rounded in float, so the curve wastes no codes; a lit
 * value (its own byte ≥ 1) with any light sends at least `floor`. */
function ledByte(v: number, gamma: number, gain: number, floor: number) {
  if (!(v > 0) || !(gain > 0)) return 0;
  const b = Math.round(255 * Math.min(1, (v < 1 ? v : 1) ** gamma * gain));
  return b < floor && v * 255 >= 0.5 ? floor : b;
}

// The curve as a table, exact: for each byte the least value that sends it (bisecting ledByte itself, to adjacent
// doubles), and the byte at each of 4,096 even steps to start from. A table is built for a cap held two frames
// running: a fade moves it every frame, and building costs more than a frame of pow. Trims (a gain per LED) use pow.
type Curve = { cap: number, least: Float64Array, start: Uint8Array };
const STARTS = 4096, CURVES = 6;

function curve(gamma: number, cap: number, gain: number, floor: number): Curve {
  const least = new Float64Array(257).fill(Infinity), start = new Uint8Array(STARTS + 1);
  least[0] = -Infinity;
  for (let b = 1, top = ledByte(1, gamma, gain, floor); b <= top; b++) {
    let lo = 0, hi = 1;                                    // ledByte(lo) < b ≤ ledByte(hi)
    for (let mid = 0.5; mid > lo && mid < hi; mid = (lo + hi) / 2) {
      if (ledByte(mid, gamma, gain, floor) >= b) hi = mid; else lo = mid;
    }
    least[b] = hi;
  }
  for (let i = 0; i <= STARTS; i++) start[i] = ledByte(i / STARTS, gamma, gain, floor);
  return { cap, least, start };
}

/** ledByte by its table. */
function byteOf(T: Curve, v: number) {
  if (!(v > 0)) return 0;
  if (v >= 1) return T.start[STARTS];
  let b = T.start[(v * STARTS) | 0];
  while (v >= T.least[b + 1]) b++;
  return b;
}

/** Where `cap`'s tables (r, g, b) start in light.curves, built (the oldest dropped) when the cap was the last
 * frame's too; −1: none. */
function curvesAt(light: PreparedLight, cap: number) {
  const { gamma, balance, floor, curves } = light, steady = cap === light.cap;
  light.cap = cap;
  for (let i = 0; i < curves.length; i += 3) if (curves[i].cap === cap) return i;
  if (!steady || light.trim) return -1;
  if (curves.length >= CURVES) curves.splice(0, 3);
  for (let c = 0; c < 3; c++) curves.push(curve(gamma, cap, cap * balance[c], floor));
  return curves.length - 3;
}

/** What value `v` (encoded, 0..1) sends, white before balance, at full output: the curve, for showing it. */
export const lightByte = (v: number, light: Light) => ledByte(v, light.gamma, 1, light.floor);

/** A frame of DMX as the LEDs get it: each value through the output transform (prepareLight), × `cap` (the master,
 * blackout and fade, or Export's Brightness: linear, after the curve, so it never shifts a hue). */
export function ledChannels(scene: Scene, rgb: ArrayLike<number>, light: PreparedLight, out?: Uint8Array | null,
  cap = 1) {
  const size = scene.frameChannels;
  const ch = out && out.length >= size ? out : new Uint8Array(size);
  ch.fill(0, 0, size);
  const addr = scene.addr, N = scene.count, order = scene.order, { gamma, balance, floor, trim } = light;
  const at = curvesAt(light, cap);
  if (at >= 0) {
    const T0 = light.curves[at], T1 = light.curves[at + 1], T2 = light.curves[at + 2];
    const o0 = order[0], o1 = order[1], o2 = order[2];
    for (let k = 0; k < N; k++) {
      const base = addr[k];
      if (base < 0 || base + 2 >= size) continue;
      ch[base + o0] = byteOf(T0, rgb[3 * k]); ch[base + o1] = byteOf(T1, rgb[3 * k + 1]);
      ch[base + o2] = byteOf(T2, rgb[3 * k + 2]);
    }
    return ch;
  }
  for (let k = 0; k < N; k++) {
    const base = addr[k];
    if (base < 0 || base + 2 >= size) continue;
    const g = cap * (trim ? trim[k] : 1);
    for (let c = 0; c < 3; c++) ch[base + order[c]] = ledByte(rgb[3 * k + c], gamma, g * balance[c], floor);
  }
  return ch;
}

/** The light each encoded byte gives on the LEDs at full output (0..1 of full, per colour r, g, b: 256 each): what
 * the bake checks and the flash guard measure, so they judge what the LEDs show, not the colour values. */
export function ledLight(light: Light = LIGHT) {
  const t = new Float32Array(768);
  for (let c = 0; c < 3; c++) {
    for (let v = 0; v < 256; v++) t[256 * c + v] = ledByte(v / 255, light.gamma, light.balance[c], light.floor) / 255;
  }
  return t;
}

/** The light a view shows for value `v` (0..1 of the screen's white): the LEDs' own at full output, v^gamma, not
 * quantised but off where they round to off, and at least the floor, through the calibration's response, × the
 * exposure. Trims stay out (the views draw the rig whole). */
export function shownLight(v: number, light: Light) {
  const { gamma, floor, calibration: { response } } = light;
  if (!ledByte(v, gamma, 1, floor)) return 0;
  const lit = Math.min(1, v ** (gamma * response));
  return (floor ? Math.max(lit, (floor / 255) ** response) : lit) * light.preview.exposure;
}

/** A frame's light for the views, once, before either draws: shownLight × each colour's balance and calibrated
 * white, the calibration's saturation about the luminance, × `gain` (the flash guard's dim, the Live master: linear,
 * as the Pi's), × `dim` on each LED that `mask` leaves out (0 there; null: none). */
export function previewChannels(rgb: ArrayLike<number>, light: Light, out: Float32Array, gain = 1,
  mask: ArrayLike<number> | null = null, dim = 1) {
  const { white, response, saturation: s } = light.calibration, b = light.balance;
  const w0 = white[0] * b[0] ** response, w1 = white[1] * b[1] ** response, w2 = white[2] * b[2] ** response;
  for (let k = 0, n = out.length / 3; k < n; k++) {
    const g = mask && !mask[k] ? gain * dim : gain, c = 3 * k;
    if (!(g > 0)) { out[c] = out[c + 1] = out[c + 2] = 0; continue; }
    let r = shownLight(rgb[c], light) * w0, gr = shownLight(rgb[c + 1], light) * w1;
    let bl = shownLight(rgb[c + 2], light) * w2;
    if (s !== 1) {
      const y = 0.2126 * r + 0.7152 * gr + 0.0722 * bl;
      r = Math.max(0, y + s * (r - y)); gr = Math.max(0, y + s * (gr - y)); bl = Math.max(0, y + s * (bl - y));
    }
    out[c] = r * g; out[c + 1] = gr * g; out[c + 2] = bl * g;
  }
  return out;
}

/** Light (0..1) to the screen's sRGB code (0..1), as the views' shaders do (`ENCODE`): Ian Taylor's fit of the
 * sRGB curve, within a quarter of a code of it, since a software renderer's pow is slow. */
export function encode(x: number) {
  const c = Math.min(1, Math.max(0, x)), s1 = Math.sqrt(c), s2 = Math.sqrt(s1);
  return c < 0.0031308 ? 12.92 * c : 0.662 * s1 + 0.684 * s2 - 0.3236 * Math.sqrt(s2) - 0.02254 * c;
}
/** The views' one screen encode, GLSL: as `encode`. */
export const ENCODE = `vec3 encode(vec3 c) {
  c = clamp(c, 0., 1.);
  vec3 s1 = sqrt(c), s2 = sqrt(s1);
  return mix(12.92 * c, .662 * s1 + .684 * s2 - .3236 * sqrt(s2) - .02254 * c, step(.0031308, c));
}
`;
