// A look's live controls on the Pi: the macros it offers (globals.live, else its faders), its tempo and its palette
// (SPEC-liveplay "The engine's state"), set in place on the prepared look (SPEC "Globals"), each eased to its target
// over SLEW seconds so a push never steps, and the palette blended (palette.ts). bpm keeps the beat's phase; a name
// the look automates is released from its lane at the first push. Tap tempo sets bpm and the downbeat together. A
// released control glides back to its default, the look's own value.
import { prepareLook, type PreparedLook, type PreparedLayer, type Scene } from '../../public/js/pattern-core.ts';
import type { PaletteColours } from '../../public/js/core/stdlib.ts';
import { paletteBlend, paletteHexNamed, paletteNamed, PALETTE_NAMES } from './palette.ts';
import type { Control, SettingValue } from './protocol.ts';
import { liveSettings } from './settings.ts';
import { DEFAULT_PALETTE } from '../../public/js/core/stdlib.ts';
import type { PiLook } from './library.ts';

export type { Control };
export const SLEW = 0.05;            // seconds a control takes to reach a pushed value
export const BPM = { min: 40, max: 240 };
const TAP_GAP_MS = 2000, TAPS = 8;
type Num = Extract<Control, { kind: 'macro' | 'bpm' }>;
type Pal = Extract<Control, { kind: 'palette' }>;

const num = (name: string, min: number, max: number, value: number, kind: Num['kind']): Num =>
  ({ name, kind, min, max, value, default: value, held: false });

/** The controls a look offers, in its order, with their current values on `L`, then its palette. */
export function controlsOf(look: PiLook, L: PreparedLook): Control[] {
  const macros = L.g.macros, live = look.globals?.live ?? macros.filter((m) => !m.mod).map((m) => m.name);
  const out: Control[] = [];
  for (const name of live) {
    if (name === 'bpm') out.push(num(name, BPM.min, BPM.max, L.bpm, 'bpm'));
    else {
      const m = macros.find((x) => x.name === name);
      if (m) out.push(num(name, m.min, m.max, m.value, 'macro'));
    }
  }
  const own = PALETTE_NAMES.includes(L.palette.name) ? L.palette.name : '';
  out.push({ name: 'palette', kind: 'palette', min: 0, max: 0, value: own, default: own, held: false });
  return out;
}

/** The live side of a playing look: set(name, v) a target, step(t, dt) eases toward them, tap(t, ms) the tempo. */
export function liveLook(look: PiLook, previous?: PreparedLook, layers: PreparedLayer[] = [], scene?: Scene) {
  let L = prepareLook(look, previous);
  let automation = { ...look.automation };
  const controls = controlsOf(look, L), targets = new Map<string, number>(), ownPalette = L.palette;
  const settings = liveSettings(look, layers, scene);
  controls.splice(controls.length - 1, 0, ...settings.controls);
  const byName = new Map(controls.map((c) => [c.name, c]));
  // The tempo, offered or not: tapping moves it either way, and Jukebox brings it back.
  const tempo = (byName.get('bpm') as Num | undefined) ?? num('bpm', BPM.min, BPM.max, L.bpm, 'bpm');
  const pal = byName.get('palette') as Pal;
  const knob = (name: string) => (name === 'bpm' ? tempo : byName.get(name) as Num | undefined);
  let taps: number[] = [], blend: ReturnType<typeof paletteBlend> | null = null;

  const read = (c: Num) => (c.kind === 'bpm' ? L.bpm : L.g.macros.find((m) => m.name === c.name)!.value);

  /** Writes v to the look for show time t, the frame about to render: the beat and paces go on from there. */
  function write(c: Num, v: number, at: number) {
    if (c.kind === 'bpm') {
      const phase = (at - L.beat0) * L.bpm / 60;
      L.bpm = v;
      L.beat0 = at - phase * 60 / v;
    } else {
      const m = L.g.macros.find((x) => x.name === c.name)!;
      L.repace(c.name, m.value, v, at);
      m.value = v;
    }
    c.value = v;
  }

  /** A pushed name the look automates or modulates leaves its lane or its mod, starting from its value now; what
   * it paces goes on unbroken. */
  function unlane(name: string, t: number) {
    const moved = L.g.macros.find((m) => m.name === name)?.mod;
    if (!(name in automation) && !moved) return;
    const now = L.normAt(name, t), c = knob(name)!, value = c.min + now * (c.max - c.min);
    const { [name]: _, ...rest } = automation;
    automation = rest;
    const macros = Object.fromEntries(L.g.macros.map((m) => [m.name, { value: m.value, min: m.min, max: m.max,
      ...m.mod && m.name !== name ? { mod: m.mod } : {} }]));
    const next = prepareLook({ ...look, globals: { ...look.globals, macros }, automation }, L);
    Object.assign(next, { bpm: L.bpm, beat0: L.beat0, palette: L.palette });
    for (const n of Object.keys(macros)) {
      next.paceOffset.set(n, (next.paceOffset.get(n) ?? 0) + L.paceAt(n, t) - next.paceAt(n, t));
    }
    L = next;
    write(c, value, t);
  }

  /** Blends to palette `name` ('' or the default: the look's own); false for one there is not. */
  function palette(name: string) {
    const to: PaletteColours | null = name === '' || name === pal.default ? ownPalette : paletteNamed(name);
    if (!to) return false;
    blend = paletteBlend(L.palette, to);
    L.palette = blend.palette;
    pal.value = name === '' ? pal.default : name;
    pal.held = pal.value !== pal.default;
    settings.palette(name === '' || name === pal.default ? look.globals?.palette ?? DEFAULT_PALETTE
      : paletteHexNamed(name)!);
    return true;
  }

  return {
    get look() { return L; },
    /** The look's automation as it plays: a pushed name has left it. */
    get automation() { return automation; },
    controls,
    get settingsRevision() { return settings.revision; },
    layers: settings.layers,
    set(name: string, v: SettingValue, t: number) {
      if (settings.has(name)) return settings.set(name, v);
      const c = byName.get(name);
      if (!c || c.kind !== 'macro' && c.kind !== 'bpm' || typeof v !== 'number' || !Number.isFinite(v)) return false;
      unlane(name, t);
      targets.set(name, Math.min(c.max, Math.max(c.min, v)));
      c.held = true;
      return true;
    },
    palette,
    /** The palette picked, as a look holds it; null while it is the look's own. */
    paletteHex: () => (pal.held ? paletteHexNamed(pal.value) : null),
    /** Lets a control go: it glides (or blends) back to its default. */
    release(name: string, t: number) {
      if (settings.has(name)) return settings.release(name);
      const c = name === 'bpm' ? tempo : byName.get(name);
      if (!c) return false;
      if (c.kind === 'palette') return palette(c.default);
      if (c.kind !== 'macro' && c.kind !== 'bpm') return false;
      unlane(name, t);
      targets.set(name, c.default);
      c.held = false;
      return true;
    },
    /** Every held control let go (entering Jukebox). */
    releaseAll(t: number) {
      for (const c of [...controls, tempo]) if (c.held) this.release(c.name, t);
    },
    /** Each control a step of dt seconds toward its target, and the palette's blend. */
    step(t: number, dt: number) {
      settings.step(dt);
      for (const [name, target] of targets) {
        const c = knob(name)!, cur = read(c), most = (c.max - c.min) * dt / SLEW;
        const v = Math.abs(target - cur) <= most ? target : cur + Math.sign(target - cur) * most;
        if (v !== cur) write(c, v, t);
        if (v === target) targets.delete(name);
      }
      if (blend) {
        const done = blend.step(dt);
        if (done) { L.palette = done; blend = null; }
      }
    },
    /** A tap at show time t (clock ms): the downbeat now, and from 2+ taps in a row the tempo between them. */
    tap(t: number, ms: number) {
      if (taps.length && ms - taps[taps.length - 1]! > TAP_GAP_MS) taps = [];
      taps.push(ms);
      if (taps.length > TAPS) taps.shift();
      if (taps.length >= 2) {
        const bpm = 60000 * (taps.length - 1) / (taps[taps.length - 1]! - taps[0]!);
        L.bpm = Math.round(Math.min(BPM.max, Math.max(BPM.min, bpm)) * 10) / 10;
        targets.delete('bpm');
        tempo.value = L.bpm;
        tempo.held = true;
      }
      L.beat0 = t;
      return L.bpm;
    },
    /** Show time wrapped back by `duration`: the beat carries on rather than restarting. */
    wrapped(duration: number) { L.beat0 -= duration; },
    values: () => Object.fromEntries(controls.flatMap((c) =>
      (c.kind === 'macro' || c.kind === 'bpm' ? [[c.name, read(c)]] : []))),
  };
}
export type LiveLook = ReturnType<typeof liveLook>;
