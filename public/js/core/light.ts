// Light (SPEC "Light and output", docs/LIGHT.md): the one place that knows how a colour value becomes light. Colours
// are sRGB-encoded, as their swatches; the LEDs' PWM is linear light, and the Falcon's own gamma is None, so this is
// the one curve between them. The settings' shape and defaults, the output transform (curve, balance, trims, floor,
// a linear cap) and each byte's light for the checks all live here; nothing else reads `gamma`.
import type { Scene } from './scene.ts';
import { tagMask } from './scene.ts';
import { isNum } from './stdlib.ts';

/** The light settings' defaults: each used wherever the stored settings (<STUDIO_DATA>/light.json, the Pi's
 * pi/light.json) leave it out. `controller` records the Falcon's own settings (its port brightness is the electrical
 * backstop: ports 5-32 at 80 %, the rose's 33-48 at 70 %); it is never applied here, so nothing dims twice. */
export type Light = { gamma: number, balance: [number, number, number], floor: number,
  trims: { tag: string, level: number }[], controller: { ports: string, brightness: number, gamma: string }[] };
export const LIGHT: Readonly<Light> = Object.freeze<Light>({
  gamma: 2.2,
  balance: [1, 1, 1],
  floor: 0,
  trims: [],
  controller: [
    { ports: '5-32', brightness: 0.8, gamma: 'None' },
    { ports: '33-48 (rose)', brightness: 0.7, gamma: 'None' },
  ],
});
/** Each setting's range, and how many trims and controller rows a record holds. */
export const LIGHT_LIMITS = Object.freeze({ gamma: [1, 3], floor: [0, 16], trims: 32, controller: 16, text: 40 });

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
  return { gamma: num(s.gamma, g0, g1, LIGHT.gamma),
    balance: LIGHT.balance.map((d, i) => num(b[i], 0, 1, d)) as Light['balance'],
    floor: Math.round(num(s.floor, f0, f1, LIGHT.floor)), trims: trims ?? [],
    controller: controller ?? LIGHT.controller.map((c) => ({ ...c })) };
}

/** Light settings ready for a scene: each LED's trim (the product of its groups' levels; null when none). */
export function prepareLight(scene: Scene, light: Light = LIGHT) {
  let trim: Float32Array | null = null;
  for (const { tag, level } of light.trims) {
    trim ??= new Float32Array(scene.count).fill(1);
    const mask = tagMask(scene, tag);
    for (let k = 0; k < scene.count; k++) if (mask[k]) trim[k] *= level;
  }
  return { gamma: light.gamma, balance: light.balance, floor: light.floor, trim };
}
export type PreparedLight = ReturnType<typeof prepareLight>;

/** One channel's output byte: its light (v^gamma × `gain`) rounded in float, so the curve wastes no codes; a lit
 * value (its own byte ≥ 1) with any light sends at least `floor`. */
function ledByte(v: number, gamma: number, gain: number, floor: number) {
  if (!(v > 0) || !(gain > 0)) return 0;
  const b = Math.round(255 * Math.min(1, (v < 1 ? v : 1) ** gamma * gain));
  return b < floor && v * 255 >= 0.5 ? floor : b;
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
